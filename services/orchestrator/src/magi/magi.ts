import path from 'path';
import type { ModelType } from '../config';
import { Model } from '../config';
import { logger } from '../logger';
import { ConduitClient } from './conduit-client';
import { ToolUser } from './tool-user';
import { MagiName } from '../types/magi-types';
import { MagiErrorHandler } from './error-handler';
import { ShortTermMemory } from './short-term-memory';
import type { MagiTool } from 'src/mcp';
export { MagiName };

/**
 * Interface for the configuration of a single Magi persona.
 */
interface MagiConfig {
  model: ModelType;
  personalitySource: string;
  setNewGoalPrompt: string;
  executeGoalPrompt: string;
  options: {
    temperature: number;
  };
}

export type AgenticTool = { name: string; parameters: Record<string, unknown>};

export interface AgenticResponse {
  tool: AgenticTool;
}

interface HistoryEntry {
  action: AgenticTool;
  observation: string;
  timestamp: Date;
  stepDescription: string;
}

interface AgenticLoopState {
  currentTopic: string;
  synthesis: string;
  goal: string;
  executionHistory: HistoryEntry[];
  warnings: string[];
  prohibitedTools: string[];
}

interface GoalObject {
  description?: string;
  task?: string;
  objective?: string;
  [key: string]: unknown;
}

/**
 * Configuration for each Magi persona.
 */
const MAX_STEPS = 12;

export const PERSONAS_CONFIG: Record<MagiName, MagiConfig> = {
  [MagiName.Balthazar]: {
    model: Model.Llama,
    personalitySource: path.resolve(__dirname, 'personalities', 'Balthazar.md'),
    // This one should set the goal
    setNewGoalPrompt: `
GOAL INSTRUCTIONS:
Your goal must begin with one of these keywords: ANSWER, READ, SEARCH, or ASK.
Choose the first applicable goal by following this progression:
1. If you have enough information to provide a direct respond to the user's message you must ANSWER the user.
2. If YOUR LATEST FINDINGS are <SEARCH_RESULTS>, you must READ content from the most relevant URL.
3. If you are missing essential information that can be found on the web, your goal should be to SEARCH for the missing info
`,
    // this one should execute on the goal    
    executeGoalPrompt: ``,
    options: { temperature: 0.4 },
  },
  [MagiName.Melchior]: {
    model: Model.Gemma,
    personalitySource: path.resolve(__dirname, 'personalities', 'Melchior.md'),
    setNewGoalPrompt: `
GOAL INSTRUCTIONS:
Your goal must begin with one of these keywords: ANSWER, STORE-PERSONAL-DATA, RETRIEVE-PERSONAL-DATA, or ASK.
Choose the first applicable goal by following this progression:
1. If you have been provided with personal information from the user and you have not stored it yet, you must STORE-PERSONAL-DATA.
2. If you have enough information to provide a direct respond to the user's message you must ANSWER the user.
3. If you are missing information that can be found in their personal data, your goal should be to RETRIEVE-PERSONAL-DATA with the missing info.
`,
    executeGoalPrompt: ``,
    options: { temperature: 0.6 },
  },
  [MagiName.Caspar]: {
    model: Model.Qwen,
    personalitySource: path.resolve(__dirname, 'personalities', 'Caspar.md'),
    setNewGoalPrompt: `
GOAL INSTRUCTIONS:
Your goal must begin with one of these keywords: ANSWER, ACCESS-SMART-HOME, or ASK.
Choose the first applicable goal by following this progression:
1. If you have enough information to provide a direct respond to the user's message you must ANSWER the user.
2. If you are missing information that can be found in by accessing their smart home devices, your goal should be to ACCESS-SMART-HOME for the missing info.
3. If you need to make a change to the user's smart home devices, your goal should be to ACCESS-SMART-HOME with the change you want to make.
    `,
    executeGoalPrompt:  ``,
    options: { temperature: 0.5 },
  },
};

/**
 * The Magi class represents a single AI persona within the Magi system.
 * It uses composition to communicate through a ConduitClient.
 */
export class Magi {
  private personalityPrompt: string = '';
  private status: 'available' | 'busy' | 'offline' = 'offline';
  private readonly toolUser: ToolUser;
  private toolsList: MagiTool[] = [];
  private readonly conduit: ConduitClient;
  private readonly shortTermMemory: ShortTermMemory;
  
  constructor(public name: MagiName, private readonly config: MagiConfig) {
    this.conduit = new ConduitClient(name);
    this.toolUser = new ToolUser(this);
    this.shortTermMemory = new ShortTermMemory(this);
  }

  /**
   * Initialize the Magi
   */
  async initialize(prompt: string): Promise<void> {
    this.personalityPrompt = prompt;
    this.toolsList = await this.toolUser.getAvailableTools();
  }

  /**
   * Retrieves the cached personality prompt.
   * @throws If the prompt has not been loaded yet.
   */
  withPersonality(systemInstructionsPrompt: string): string {
    if (!this.personalityPrompt) {
      const err = new Error(`Attempted to access personality for ${this.name}, but it has not been cached.`);
      logger.error('Prompt retrieval error', err);
      throw err;
    }
    return `${this.personalityPrompt}\n\n${systemInstructionsPrompt}`;
  }

  public getStatus(): 'available' | 'busy' | 'offline' {
    return this.status;
  }

  /**
   * Contacts the Magi persona through the Magi Conduit to get a response.
   * @param userPrompt - The user's question or the content of a debate turn.
   * @returns The AI's response text.
   */
  async contact(userPrompt: string): Promise<string> {
    const currentTopic = await this.shortTermMemory.determineTopic(userPrompt);
    const workingMemory = await this.shortTermMemory.summarize(currentTopic);
    const promptWithContext = workingMemory + '\n' + userPrompt;
    const response = await this.executeWithStatusManagement(async () => 
      this.conduit.contact(promptWithContext, this.withPersonality(''), this.config.model, this.config.options)
    );
    
    // Store the interaction in short-term memory
    try {
      this.shortTermMemory.remember('user', userPrompt);
      this.shortTermMemory.remember(this.name, response);
    } catch (memoryError) {
      logger.warn(`Failed to store memory for ${this.name}: ${memoryError}`);
      // Continue execution - memory failure shouldn't break the response
    }
    
    return response;
  }

  async contactSimple(userPrompt: string, systemPrompt?: string): Promise<string> {
    return this.executeWithStatusManagement(async () => 
      this.conduit.contact(userPrompt, systemPrompt ?? '', this.config.model, this.config.options)
    );
  }

  public forget(): void {
    this.shortTermMemory.forget();
  }

  /**
   * Safely extracts a goal string from the response object
   */
  private extractGoalString(goal: string | GoalObject): string {
    if (typeof goal === 'string') {
      return goal;
    }
    
    if (typeof goal === 'object' && goal != null) {
      const goalObj = goal;
      
      // Check for action-based goal objects like {"answer": "..."}
      const actionKeys = ['answer', 'search', 'extract', 'ask'];
      for (const actionKey of actionKeys) {
        if (goalObj[actionKey] !== undefined) {
          return actionKey.toUpperCase();
        }
      }
      
      // Fall back to standard properties
      return goalObj.description ?? goalObj.task ?? goalObj.objective ?? JSON.stringify(goal);
    }
    
    return "Continue with current objective";
  }


  /**
   * Extracts the most recent observation from the execution history
   */
  private async extractLatestObservation(loopState: AgenticLoopState): Promise<string> {
    if (loopState.executionHistory.length === 0) {
      return "";
    }

    const latestEntry = loopState.executionHistory[loopState.executionHistory.length - 1];
    const observation = latestEntry.observation;
    
    // Add length limits and summarization
    const MAX_OBSERVATION_LENGTH = 10000;
    if (observation.length > MAX_OBSERVATION_LENGTH) {
      logger.warn(`${this.name} observation is too long (${observation.length} chars), summarizing...`);
      const summaryPrompt = `INSTRUCTIONS:
Summarize the following text in a few sentences and only respond with the summary.
${loopState.currentTopic ? `If the text has nothing to do with ${loopState.currentTopic} then do not include it.` : ''}
TEXT TO SUMMARIZE:\n${observation}`;
      const summary = await this.contactSimple(summaryPrompt, 'You are a summarization assistant.');
      return `[Summarized]: ${summary}`;
    }

    return observation;
  }

  /**
   * Generates synthesis based on current state and observations
   */
  private async generateSynthesis(
    newUserMessage: string,
    workingMemory: string,
    loopState: AgenticLoopState,
    observation: string
  ): Promise<string> {
    const systemInstructionsPrompt = `You are an expert at synthesizing information you've gathered. You are currently focusing on the user's message`;
    const { synthesis, currentTopic, goal, prohibitedTools } = loopState;
    const availableTools = this.toolsList.filter(tool => !prohibitedTools.includes(tool.name));
    const synthesisPrompt = `
${workingMemory ? `CONTEXT:\n${workingMemory}\n` : ''}
USER'S MESSAGE:\n"${newUserMessage}"
${synthesis ? `\nCONTEXT:\nWhat you know so far:\n${synthesis}` : ''}
${currentTopic ? `\nCURRENT TOPIC:\n${currentTopic}` : ''}
${goal ? `\nPREVIOUS GOAL:\n${goal}\n` : ''}${observation ? `\nYOUR LATEST FINDINGS:\n${observation}` : ''}
YOUR CAPABILITIES:\n${availableTools.map(t => `- ${t.name} tool: ${t.description}`).join('\n')}\n
SYNTHESIS INSTRUCTIONS:
To determine your next step, you must follow this procedure:
${observation
  ? `Review YOUR LATEST FINDINGS to see what you have already accomplished. Do not repeat actions you've already taken.`
  : 'To determine your next step, first answer the following questions based on the user\'s message and the information you currently have. **Do not use your own general knowledge; only use the conversation history and previous tool outputs.**'}

1.  User's Objective: Based on the user's message, what is their primary goal? Sharing information, requesting information? Both?
2.  If requesting information, do you have what you need to fully achieve this objective?
3.  Next Requisite Action:
    If information is missing, what is the single most direct action you can take to get it?
    If responding to a statement, is there anything you should do with the information provided (check your capabilities)?

If you cannot get the data you need - it is acceptable to answer that you do not know - never make up information.
Combine your answers into a concise synthesis that explains your reasoning for your next goal.

Only respond in properly formatted JSON:
\`\`\`json
{
  "synthesis": "<SYNTHESIS>",
}
\`\`\``.trim();
    
    const synthesisResponse = await this.conduit.contactForJSON(synthesisPrompt, systemInstructionsPrompt, this.config.model, this.config.options);
    return synthesisResponse.synthesis;
  }

  /**
   * Determines the next goal based on current state and synthesis
   */
  private async determineNextGoal(
    newUserMessage: string,
    loopState: AgenticLoopState,
    observation: string,
    completedSteps: string[]
  ): Promise<string | GoalObject> {
    const { currentTopic, synthesis, goal, prohibitedTools } = loopState;
    const canAskQuestions = !prohibitedTools.includes('ask-user');
    const systemInstructionsPrompt = `You are a pragmatic expert at creating next steps.`;
    const goalPrompt = `
USER'S MESSAGE:\n"${newUserMessage}"\n
${currentTopic ? `\nCURRENT TOPIC:\n${currentTopic}` : ''}
${goal ? `\nPREVIOUS GOAL:\n${goal}\n` : ''}${observation ? `\nYOUR LATEST FINDINGS:\n${observation}` : ''}${completedSteps.length > 0 ? `\n\nCOMPLETED STEPS:\n${completedSteps.join(',\n')}` : ''}${completedSteps.length > 0 ? '\n\nAVOID REPETITION: Only take actions that you have not yet completed.\n' : ''}

YOUR CONCLUSION: (your goal must be based on this)
${synthesis}\n
${this.config.setNewGoalPrompt}\n
${canAskQuestions ? '4. If you are missing essential information that only the user has, your goal should be to ASK the user.' : ''}
FORMAT:
\`\`\`json
{
  "goal": "<GOAL> in order to ...",
}
\`\`\``.trim();

    const goalResponse = await this.conduit.contactForJSON(goalPrompt, systemInstructionsPrompt, this.config.model, this.config.options);
    return goalResponse.goal;
  }

  /**
   * Synthesizes current state and updates goals based on latest observation
   */
  private async synthesizeState(
    loopState: AgenticLoopState, 
    workingMemory: string,
    newUserMessage: string
  ): Promise<void> {
    const observation = await this.extractLatestObservation(loopState);
    const completedSteps = loopState.executionHistory.map(entry => entry.stepDescription);

    try {
      await this.executeWithStatusManagement(async () => {
        loopState.synthesis = await this.generateSynthesis(newUserMessage, workingMemory, loopState, observation);
        const newGoal = await this.determineNextGoal(newUserMessage, loopState, observation, completedSteps);
        loopState.goal = this.extractGoalString(newGoal);
      });

      logger.debug(`${this.name} state update - synthesis: ${loopState.synthesis}, goal: ${loopState.goal}`);
    } catch (jsonError) {
      logger.error(`${this.name} failed to get JSON response for state synthesis:`, jsonError);
      // Continue with previous state rather than breaking the loop
      logger.warn(`${this.name} continuing with previous goal: ${loopState.goal}`);
    }
  }

  /**
   * Checks if an action is repetitive based on recent execution history
   */
  private isRepetitiveAction(executionHistory: HistoryEntry[], toolName: string): boolean {
    const recentActions = executionHistory.slice(-2); // Last 2 actions (will be 3 total with current)
    return recentActions.length === 2 && recentActions.every(entry => entry.action.name === toolName);
  }

  /**
   * Adds warning to synthesis if repetitive action is detected
   */
  private addRepetitiveActionWarning(loopState: AgenticLoopState, toolName: string): void {
    logger.warn(`${this.name} detected repetitive use of ${toolName} - forcing progression`);
    loopState.warnings.push(`You have used the '${toolName}' tool three times in a row. You MUST use a different tool or provide a final answer now. Use any tool that is not '${toolName}'.`);
  }

  /**
   * Filters tools based on the goal type and prohibited tools
   */
  private getToolForGoal(goal: string, prohibitedTools: string[] = []): MagiTool[] {
    logger.debug(`${this.name} filtering tools for goal: ${goal}, prohibited: [${prohibitedTools.join(', ')}]`);
    
    const goalType = goal.trim() ? goal.toUpperCase().split(' ')[0] : '';
    const toolMapping: Record<string, string> = {
      'ANSWER': 'answer-user',
      'ASK': 'ask-user', 
      'SEARCH': 'search-web',
      'READ': 'read-page',
      'RETRIEVE-PERSONAL-DATA': 'personal-data',
      'STORE-PERSONAL-DATA': 'personal-data'
    };

    return this.toolsList.filter(tool => {
      if (prohibitedTools.includes(tool.name)) {
        logger.debug(`Tool ${tool.name} is prohibited, skipping`);
        return false;
      }

      if (!goalType) {
        return true;
      }

      const expectedTool = toolMapping[goalType];
      if (expectedTool) {
        const matches = tool.name === expectedTool;
        if (matches) logger.debug(`Tool ${tool.name} matches goal type ${goalType}`);
        return matches;
      }

      return !['ask-user', 'answer-user'].includes(tool.name);
    });
  }

  /**
   * Decides next action and executes it, returning result and whether to continue loop
   */
  private async decideNextAction(
    loopState: AgenticLoopState,
    workingMemory: string,
    userMessage: string,
    actionHistory: string[]
  ): Promise<{ response?: string; shouldBreak: boolean }> {
    const { synthesis, goal, prohibitedTools } = loopState;
    const observation = await this.extractLatestObservation(loopState);
    const actionsTaken = actionHistory.join(' → ');
    const warnings = loopState.warnings.join('\n');
    if (warnings) {
        loopState.warnings = []; // Clear warnings after use
    }

    const systemPrompt = `You're action oriented and an expert at specifying tool use when it comes to the goal: ${goal}.`;
    const reasonPrompt = `
${workingMemory ? `CONTEXT:\n${workingMemory}\n` : ''}
${synthesis ? `WHAT YOU KNOW:\n${synthesis}\n` : ''}
USER MESSAGE:\n"${userMessage}"\n
${actionsTaken ? `ACTIONS TAKEN:\n${actionsTaken}\n` : ''}${warnings ? `IMPORTANT WARNINGS:\n${warnings}\n` : ''}${ observation ? `\nDATA TO PROCESS:\n${observation}\n` : ''}
INSTRUCTIONS:\nRespond with how you would use available tools to achieve your goal.\n
AVAILABLE TOOLS:\n${this.getToolForGoal(goal, prohibitedTools).map(t => t.toString())}\n
YOUR CURRENT GOAL:\n${goal}\n
Format your response as JSON only:
\`\`\`json
{
 "tool": { "name": "<TOOL_NAME>", "parameters": { "<TOOL_PARAMETER_NAME>": "<TOOL_PARAMETER_VALUE>" } }
}
\`\`\`
`.trim();

    let agenticResponse: AgenticResponse;
    try {
      agenticResponse = await this.executeWithStatusManagement(async () => {
          const { model, options } = this.config;
          return this.conduit.contactForJSON(reasonPrompt, systemPrompt, model, options);
      });
    } catch (jsonError) {
      logger.error(`${this.name} failed to get JSON response for action decision:`, jsonError);
      return { response: "Sorry, I encountered an error processing my response and had to stop.", shouldBreak: true };
    }
    
    const tool = agenticResponse.tool;

    if (tool) {
      return await this.handleToolResponse(tool, loopState, userMessage, actionHistory);
    } else {
      logger.error(`Invalid response from agentic loop, no tool supplied:\n${JSON.stringify(agenticResponse)}`);
      return { response: "Sorry, I received an invalid response and had to stop.", shouldBreak: true };
    }
  }

  /**
   * Initialize the agentic loop with memory context and initial state
   */
  private async initializeAgenticLoop(userMessage: string, prohibitedTools: string[]): Promise<{
    workingMemory: string;
    loopState: AgenticLoopState;
    actionHistory: string[];
  }> {
    const currentTopic = await this.shortTermMemory.determineTopic(userMessage);
    const workingMemory = await this.shortTermMemory.summarize(currentTopic);
    const loopState: AgenticLoopState = {
      currentTopic: currentTopic ? currentTopic.trim() : userMessage,
      synthesis: "",
      goal: "",
      executionHistory: [],
      warnings: [],
      prohibitedTools: prohibitedTools,
    };
    const actionHistory: string[] = [];
    
    return { workingMemory, loopState, actionHistory };
  }

  /**
   * Execute the main agentic loop with synthesis and action phases
   */
  private async executeAgenticLoop(
    loopState: AgenticLoopState,
    workingMemory: string,
    actionHistory: string[],
    userMessage: string
  ): Promise<string | null> {
    for (let step = 1; step < MAX_STEPS; step++) {
      // PHASE 1: SYNTHESIZE STATE
      await this.synthesizeState(loopState, workingMemory,userMessage);

      // PHASE 2: DECIDE ACTION
      const actionResult = await this.decideNextAction(loopState, workingMemory, userMessage, actionHistory);
      if (actionResult.shouldBreak) {
        return actionResult.response ?? '';
      }
    }
    return null;
  }

  /**
   * Generate fallback response when loop completes without final answer
   */
  private generateFallbackResponse(loopState: AgenticLoopState): string {
    logger.warn(`${this.name} agentic loop completed ${MAX_STEPS - 1} steps without reaching final answer`);
    return `Sorry, I seem to have gotten stuck in a loop. Here is what I found:\n${loopState.synthesis}`;
  }

  /**
   * Store interaction in short-term memory with proper error handling
   */
  private async storeInteractionMemory(
    userMessage: string,
    synthesis: string,
    response: string
  ): Promise<void> {
    if (response) {
      try {
        this.shortTermMemory.remember('user', userMessage);
        this.shortTermMemory.remember(this.name, synthesis + '\n' + response);
      } catch (memoryError) {
        logger.warn(`Failed to store agentic memory for ${this.name}: ${memoryError}`);
      }
    }
  }

  public async contactAsAgent(userMessage: string, prohibitedTools: string[] = []): Promise<string> {
    let response = '';
    try {
      logger.info(`${this.name} beginning agentic loop...`);

      const { workingMemory, loopState, actionHistory } = await this.initializeAgenticLoop(userMessage, prohibitedTools);

      response = await this.executeAgenticLoop(loopState, workingMemory, actionHistory, userMessage) ?? 
                 this.generateFallbackResponse(loopState);

      await this.storeInteractionMemory(userMessage, loopState.synthesis, response);
    } catch (error) {
      logger.error(`ERROR: ${error}`);
      throw MagiErrorHandler.createContextualError(error, {
        magiName: this.name,
        operation: 'agentic loop'
      });
    }

    const finalResponse = await this.makeTTSReady(response);
    logger.debug(`\n🤖🔊\n${finalResponse}`);
    return finalResponse;
  }
  
  private async makeTTSReady(text: string): Promise<string> {
    const systemPrompt = `ROLE & GOAL
You are a direct transcription and vocalization engine. Your sole function is to take a TEXT PASSAGE and convert it verbatim into a SPOKEN SCRIPT for a Text-to-Speech (TTS) engine. Your output must preserve the original text's structure and intent, simply making it readable for a voice synthesizer.
`;

    const userPrompt = `
INSTRUCTIONS
Receive the TEXT PASSAGE.
Convert it directly into a SPOKEN SCRIPT.
The script must be ready for immediate TTS playback.
Preserve the original meaning and all data points without adding, removing, or changing the core message.

CORE RULES
CRITICAL RULE: DO NOT ANSWER OR RESPOND. Your task is to convert, not to have a conversation. Treat the TEXT PASSAGE as raw data to be transformed. If the passage is a question, convert the question. Do not answer it.
Expand Abbreviations: Write out all abbreviations in full. e.g. becomes for example. est. becomes estimated.
Verbalize All Numbers & Symbols: Convert all digits and symbols into words. $5.2M becomes five point two million dollars. 25% becomes twenty-five percent. Eris-1 becomes Eris one.
Clarify URLs & Jargon: Spell out URLs and special characters. project-status.com/v2 becomes project dash status dot com slash v two.

EXAMPLES

Example 1:
TEXT PASSAGE: Analysis complete: Plan A is 15% cheaper (~$2k savings) but takes 3 wks longer. See details at results.com/plan-a.
SPOKEN SCRIPT: The analysis is complete. Plan A is fifteen percent cheaper, with approximately two thousand dollars in savings, but it will take three weeks longer. See the details at results dot com slash plan a.

Example 2:
TEXT PASSAGE: Q2 report: Revenue at $1.8M (+7% QoQ). Key issue: supply chain delays, i.e., component shortages.
SPOKEN SCRIPT: The second quarter report shows revenue at one point eight million dollars, a seven percent increase quarter-over-quarter. The key issue is supply chain delays; that is, component shortages.

Example 3:
TEXT PASSAGE: Weather alert for zip 94063: High winds expected ~8 PM. Wind speed: 30-40 mph. Source: noaa.gov.
SPOKEN SCRIPT: There is a weather alert for the nine four zero six three zip code. High winds are expected at approximately eight P M, with wind speeds between thirty and forty miles per hour. The source is N O A A dot gov.

Example 4:
TEXT PASSAGE: Can you confirm the project ETA is still 9/1?
SPOKEN SCRIPT: Can you confirm the project E T A is still September first?

YOUR TASK:
Now, rewrite the following TEXT PASSAGE into a spoken script. Only respond with the spoken script itself.

TEXT PASSAGE:\n${text}

SPOKEN SCRIPT:\n`

    return await this.conduit.contact(userPrompt, this.withPersonality(systemPrompt), this.config.model, this.config.options)
  }
  
  /**
   * Handles tool response execution using a switch statement
   */
  private async handleToolResponse(
    tool: AgenticTool,
    loopState: AgenticLoopState,
    userMessage: string,
    actionHistory: string[]
  ): Promise<{ response?: string; shouldBreak: boolean }> {
    switch (tool.name) {
      case 'ask-user': {
        const response = tool.parameters.question as string;
        logger.info(`${this.name} has a clarifying question: "${response}"`);
        return { response, shouldBreak: true };
      }


      case 'answer-user': {
        return { response: tool.parameters.answer as string, shouldBreak: true };
      }

      default: {
        const toolResponse = await this.toolUser.executeAgenticTool(tool, userMessage);
        
        // Check for repetitive actions before adding to history
        if (this.isRepetitiveAction(loopState.executionHistory, tool.name)) {
          this.addRepetitiveActionWarning(loopState, tool.name);
        }
        
        // Create structured history entry
        const stepDescription = `${tool.name}: ${JSON.stringify(tool.parameters)}`;
        const historyEntry: HistoryEntry = {
          action: tool,
          observation: toolResponse,
          timestamp: new Date(),
          stepDescription
        };
        
        loopState.executionHistory.push(historyEntry);
        
        // Add action to legacy action history (still used for action tracking)
        actionHistory.push(tool.name);
        
        return { shouldBreak: false };
      }
    }
  }

  /**
   * Executes a contact operation with proper status management
   */
  private async executeWithStatusManagement<T>(operation: () => Promise<T>): Promise<T> {
    this.status = 'busy';
    
    try {
      const result = await operation();
      this.status = 'available';
      return result;
    } catch (error) {
      this.status = 'available';
      throw error;
    }
  }
}

// Create and export the three Magi instances
export const balthazar = new Magi(MagiName.Balthazar, PERSONAS_CONFIG.Balthazar);
export const melchior = new Magi(MagiName.Melchior, PERSONAS_CONFIG.Melchior);
export const caspar = new Magi(MagiName.Caspar, PERSONAS_CONFIG.Caspar);

// Export all Magi instances in a single object for easy iteration
export const allMagi = {
  [MagiName.Balthazar]: balthazar,
  [MagiName.Melchior]: melchior,
  [MagiName.Caspar]: caspar,
}; 