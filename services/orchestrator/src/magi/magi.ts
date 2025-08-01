import path from 'path';
import { Model, ModelType } from '../config';
import { logger } from '../logger';
import { ConduitClient } from './conduit-client';
import { ToolUser } from './tool-user';
import { MagiName } from '../types/magi-types';
import { EXCLUDED_TOOL_PARAMS, TOOL_REGISTRY } from '../mcp/tools/tool-registry';
import { MagiErrorHandler } from './error-handler';
import { ShortTermMemory } from './short-term-memory';
import { McpToolInfo } from 'src/mcp';
export { MagiName };

const OBSERVATION_START_DELIMITER = '<<<OBSERVATION_START>>>';
const OBSERVATION_END_DELIMITER = '<<<OBSERVATION_END>>>';

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
  thought: string;
  action: {
    tool: AgenticTool;
  }
}

interface AgenticLoopState {
  currentTopic: string;
  synthesis: string;
  goal: string;
  history: string;
  warnings: string[];
  originalUserMessage: string;
  completedSteps: string[];
}

interface StateUpdateResponse {
  synthesis: string;
  goal: string | GoalObject;
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
* Think about YOUR LATEST FINDINGS and "What you know so far", and synthesize it in reference to the CURRENT TOPIC.

GOAL INSTRUCTIONS:
Your goal must be 1 of these keywords: ANSWER, EXTRACT, ASK, or SEARCH.
Choose the first applicable goal by following this progression:
1. If you have enough information to provide a direct respond to the user's original message you must ANSWER the user.
2. If YOUR LATEST FINDINGS are <SEARCH_RESULTS>, you must EXTRACT web content from the most relevant URL.
3. If you are missing essential information that can be found on the web, your goal should be to SEARCH for the missing info
4. If you are missing essential information that only the user has, your goal should be to ASK the user.`,
    // this one should execute on the goal    
    executeGoalPrompt: `
* ANSWER: Use your answer-user to respond with a synthesis of WHAT YOU KNOW and FINDINGS.
* SEARCH: Use your tavily-search tool with a relevant search query
* EXTRACT: Use your tavily-extract tool to view the web page content for the URLs (3 max)
* ASK: Use your ask-user tool to gather any necessary context that is needed to respond to the user's original message.
`,
    options: { temperature: 0.4 },
  },
  [MagiName.Melchior]: {
    model: Model.Gemma,
    personalitySource: path.resolve(__dirname, 'personalities', 'Melchior.md'),
    setNewGoalPrompt: `
1. Update your synthesis based on the latest findings.
2. Evaluate your current goal:
   - Is it still relevant to the user?
   - Have you learned something that changes what you should focus on?
   - Are you getting stuck in a loop or pursuing an unproductive path?
3. Define your next goal:
   - If current goal is still valid: Continue with the logical next step
   - If current goal is complete: Move to the next phase or provide final answer
   - If current goal is no longer relevant: Pivot to what the user actually needs
   - If the user's message reveals personal preferences, emotional states, personal details, or other information relevant to your role, you should save this information using your tool(s). Consider choosing a category that will make it easy to find this data in the future.
   - If the user asks a question about their personal information, your plan should first retrieve the data using your tool(s).`,
    executeGoalPrompt: `1. Use Available Tools: Leverage your unique capabilities and data access to gather relevant information
2. Ask User: Only if the query is too vague or you need specific personal data that your tools could not provide.
3. Answer user: When you have gathered and analyzed sufficient information OR if the question is straightforward an doesn't require research.`,
    options: { temperature: 0.6 },
  },
  [MagiName.Caspar]: {
    model: Model.Qwen,
    personalitySource: path.resolve(__dirname, 'personalities', 'Caspar.md'),
    setNewGoalPrompt: `
1. Update your synthesis based on the latest findings.
2. Define your next goal by following this progression:
   - If a response to the user's message is straightforward, then your goal is to provide your answer directly.
   - If the user's message to you requires accessing a tool (like a smart home device), your goal is to use a tool.
   - If you've recieved information from one of your tools, then your goal is to analyze that data.
   - If your analysis has provided you with sufficient information to address the user's message, your goal is to provide your answer.
   - If you really need more context from the user in order to respond, your goal is to ask the user a clarifying question.
    `,
    executeGoalPrompt:  `1. Use Available Tools: Leverage your tool(s) to gather relevant information.
2. Ask User: If a clarifying question is needed, ask the user.
3. Answer user: When you have gathered and analyzed sufficient information OR if the question is straightforward an doesn't require research.`,
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
  private toolUser: ToolUser;
  private toolsList: McpToolInfo[] = [];
  private conduit: ConduitClient;
  private shortTermMemory: ShortTermMemory;
  
  constructor(public name: MagiName, private config: MagiConfig) {
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

  getToolDescriptionForPrompt(t: McpToolInfo): string {
    if (!t.name) return '';

    const toolDefinition = TOOL_REGISTRY[t.name];
    if (!toolDefinition) return '';

    const instructions = toolDefinition.instructions || '';
    const parameters = instructions.split('\n')
      .filter(line => line.trim())
      .reduce((acc, line) => {
        const trimmedLine = line.trim();
        const firstColonIndex = trimmedLine.indexOf(':');

        if (firstColonIndex > 0) {
          const key = trimmedLine.substring(0, firstColonIndex).trim();
          const value = trimmedLine.substring(firstColonIndex + 1).trim();
          
          const parenIndex = key.indexOf(' (');
          if (parenIndex > 0) {
              const name = key.substring(0, parenIndex);
              const details = key.substring(parenIndex);
              acc[name] = `${details} ${value}`.trim();
          } else {
              acc[key] = value;
          }
        }
        return acc;
      }, {} as Record<string, string>);

    const paramString = Object.entries(parameters)
      .filter(([name]) => !EXCLUDED_TOOL_PARAMS.has(name))
      .map(([name, type]) => `"${name}":"${type.replace(/"/g, '\\"')}"`)
      .join(',');
    
    return `- { "tool": { "name": "${t.name}", "description": "${t.description || ''}", "parameters": {${paramString}} } }\n  USAGE:\n ${toolDefinition.instructions || 'Infer instructions based on parameter names'}`;
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
    const response = await this.executeWithStatusManagement(() => 
      this.conduit.contact(promptWithContext, this.withPersonality(''), this.config.model, this.config.options)
    );
    
    // Store the interaction in short-term memory
    try {
      this.shortTermMemory.remember('user', 'User prompt', userPrompt);
      this.shortTermMemory.remember(this.name, 'Response', response);
    } catch (memoryError) {
      logger.warn(`Failed to store memory for ${this.name}: ${memoryError}`);
      // Continue execution - memory failure shouldn't break the response
    }
    
    return response;
  }

  async contactSimple(userPrompt: string, systemPrompt?: string): Promise<string> {
    return this.executeWithStatusManagement(() => 
      this.conduit.contact(userPrompt, systemPrompt || '', this.config.model, this.config.options)
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
    
    if (typeof goal === 'object' && goal !== null) {
      const goalObj = goal as GoalObject;
      
      // Check for action-based goal objects like {"answer": "..."}
      const actionKeys = ['answer', 'search', 'extract', 'ask'];
      for (const actionKey of actionKeys) {
        if (goalObj[actionKey] !== undefined) {
          return actionKey.toUpperCase();
        }
      }
      
      // Fall back to standard properties
      return goalObj.description || goalObj.task || goalObj.objective || JSON.stringify(goal);
    }
    
    return "Continue with current objective";
  }


  /**
   * Extracts the most recent observation from the loop history
   */
  private async extractLatestObservation(history: string): Promise<string> {
    if (!history.trim()) {
      return "No previous actions taken yet.";
    }

    const lastObservationStartIndex = history.lastIndexOf(OBSERVATION_START_DELIMITER);
    if (lastObservationStartIndex === -1) {
      return "Previous actions taken but no observation found.";
    }

    const lastObservationEndIndex = history.lastIndexOf(OBSERVATION_END_DELIMITER);
    if (lastObservationEndIndex === -1 || lastObservationEndIndex < lastObservationStartIndex) {
        // This case should not happen if delimiters are used correctly
        return "Could not find end of last observation.";
    }
    
    const observationStart = lastObservationStartIndex + OBSERVATION_START_DELIMITER.length;
    let observation = history.substring(observationStart, lastObservationEndIndex);
    
    // Add length limits and summarization
    const MAX_OBSERVATION_LENGTH = 10000;
    if (observation.length > MAX_OBSERVATION_LENGTH) {
      logger.warn(`${this.name} observation is too long (${observation.length} chars), summarizing...`);
      const summaryPrompt = `Summarize the following text in a few sentences and only respond with the summary:\n\n${observation}`;
      const summary = await this.contactSimple(summaryPrompt, 'You are a summarization assistant.');
      return `[Summarized]: ${summary}`;
    }

    return observation;
  }

  /**
   * Synthesizes current state and updates goals based on latest observation
   */
  private async synthesizeState(
    loopState: AgenticLoopState, 
    userMessage: string
  ): Promise<void> {
    const { history, originalUserMessage, synthesis, goal, completedSteps } = loopState;
    const observation = await this.extractLatestObservation(history);
    
    // Fix contradiction: if synthesis is still default but we have meaningful observation data
    if (synthesis === "Nothing is known yet." && observation) {
      loopState.synthesis = `Just started looking into the user's message, see findings.`;
    }
    
    const systemInstructionsPrompt = `You are an expert at synthesizing information you've gathered, and defining the next goal for yourself. You are currently focusing on the user's original message`;
    const synthesisPrompt = `User's original message:
"${originalUserMessage}"

CONTEXT:
What you know so far:
${loopState.synthesis}

Your previous goal:
${goal}

YOUR LATEST FINDINGS:
${observation}

COMPLETED STEPS: ${completedSteps.join(',\n') || 'None yet'}
AVOID REPETITION: Only take actions that you have not yet completed.

SYNTHESIS INSTRUCTIONS:
${this.config.setNewGoalPrompt}

Format your response as JSON only:
\`\`\`json
{
  "synthesis": "Updated summary of what I now know...",
  "goal": "The single next goal I will pursue..."
}
\`\`\`

${userMessage === originalUserMessage ? '' : "Latest User Message: \"${userMessage}\""}
`.trim();

    try {
      const stateUpdate: StateUpdateResponse = await this.executeWithStatusManagement(() => 
        this.conduit.contactForJSON(synthesisPrompt, this.withPersonality(systemInstructionsPrompt), this.config.model, this.config.options)
      );
      
      loopState.synthesis = stateUpdate.synthesis;
      loopState.goal = this.extractGoalString(stateUpdate.goal);
      
      logger.debug(`${this.name} state update - synthesis: ${stateUpdate.synthesis}, goal: ${loopState.goal}`);
    } catch (jsonError) {
      logger.error(`${this.name} failed to get JSON response for state synthesis:`, jsonError);
      // Continue with previous state rather than breaking the loop
      logger.warn(`${this.name} continuing with previous goal: ${loopState.goal}`);
    }
  }

  /**
   * Checks if an action is repetitive based on recent history
   */
  private isRepetitiveAction(actionHistory: string[], toolName: string): boolean {
    const recentActions = actionHistory.slice(-2); // Last 2 actions (will be 3 total with current)
    return recentActions.length === 2 && recentActions.every(action => action === toolName);
  }

  /**
   * Adds warning to synthesis if repetitive action is detected
   */
  private addRepetitiveActionWarning(loopState: AgenticLoopState, toolName: string): void {
    logger.warn(`${this.name} detected repetitive use of ${toolName} - forcing progression`);
    loopState.warnings.push(`You have used the '${toolName}' tool three times in a row. You MUST use a different tool or provide a final answer now. Use any tool that is not '${toolName}'.`);
  }

  /**
   * Filters tools based on the goal type
   */
  private getToolForGoal(goal: string): string {
    const goalUpper = goal.toUpperCase() + ' ';
    const goalType = goalUpper.split(' ')[0];
    const filteredTools = [];
    
    // If goal is empty, return all tools
    if (!goal.trim()) {
      return this.toolsList.map(tool => this.getToolDescriptionForPrompt(tool)).join('\n\n');
    }
    
    for (const tool of this.toolsList) {
      if (!tool.name) continue;
      
      let shouldInclude = false;
      switch (goalType) {
        case 'ANSWER':
          shouldInclude = tool.name === 'answer-user';
          break;
        case 'ASK':
          shouldInclude = tool.name === 'ask-user';
          break;
        case 'SEARCH':
          shouldInclude = tool.name === 'tavily-search';
          break;
        case 'EXTRACT':
          shouldInclude = tool.name === 'tavily-extract';
          break;
        default:
          shouldInclude = !['ask-user', 'answer-user'].includes(tool.name);
          break;
      }
      
      if (shouldInclude) {
        filteredTools.push(tool);
      }
    }

    return filteredTools.map(tool => this.getToolDescriptionForPrompt(tool)).join('\n\n');
  }

  /**
   * Decides next action and executes it, returning result and whether to continue loop
   */
  private async decideNextAction(
    loopState: AgenticLoopState,
    workingMemory: string,
    actionHistory: string[]
  ): Promise<{ response?: string; shouldBreak: boolean }> {
    const observation = await this.extractLatestObservation(loopState.history);

    const warnings = loopState.warnings.join('\n');
    if (warnings) {
        loopState.warnings = []; // Clear warnings after use
    }

    const systemPrompt = `You are an action oriented AI agent adept at specifying the tool use for ${loopState.goal}.`;
    const reasonPrompt = `
${workingMemory ? `CONTEXT:\n${workingMemory}` : ''}

WHAT YOU KNOW:
${loopState.synthesis}

ORIGINAL USER MESSAGE:
"${loopState.originalUserMessage}"

ACTIONS TAKEN:\n${actionHistory.join(' → ') || 'None yet'}
${warnings ? `IMPORTANT WARNINGS:\n${warnings}\n` : ''}

DATA TO PROCESS:
${observation}

INSTRUCTIONS:
${this.config.executeGoalPrompt}

YOUR CURRENT GOAL:
${loopState.goal}

AVAILABLE TOOLS:
${this.getToolForGoal(loopState.goal)}

Format your response as JSON only:
\`\`\`json
{
  "thought": "I will use a tool because...",
  "action": { "tool": { "name": "<TOOL_NAME>", "parameters": { "<TOOL_PARAMETER_NAME>": "<TOOL_PARAMETER_VALUE>" } } }
}
\`\`\`
`.trim();

    let agenticResponse: AgenticResponse;
    try {
      agenticResponse = await this.executeWithStatusManagement(() => 
        this.conduit.contactForJSON(reasonPrompt, this.withPersonality(systemPrompt), this.config.model, this.config.options)
      );
      logger.debug(`${this.name} agentic response - thought: ${agenticResponse.thought}, action: ${JSON.stringify(agenticResponse.action)}`);
    } catch (jsonError) {
      logger.error(`${this.name} failed to get JSON response for action decision:`, jsonError);
      return { response: "Sorry, I encountered an error processing my response and had to stop.", shouldBreak: true };
    }
    
    const { tool } = agenticResponse.action;

    if (tool) {
      return await this.handleToolResponse(tool, agenticResponse, loopState, actionHistory);
    } else {
      logger.error(`Invalid response from agentic loop, no tool supplied:\n${JSON.stringify(agenticResponse)}`);
      return { response: "Sorry, I received an invalid response and had to stop.", shouldBreak: true };
    }
  }

  /**
   * Initialize the agentic loop with memory context and initial state
   */
  private async initializeAgenticLoop(userMessage: string): Promise<{
    workingMemory: string;
    loopState: AgenticLoopState;
    actionHistory: string[];
  }> {
    const currentTopic = await this.shortTermMemory.determineTopic(userMessage);
    const workingMemory = await this.shortTermMemory.summarize(currentTopic);
    const loopState: AgenticLoopState = {
      currentTopic: currentTopic ? currentTopic : userMessage,
      synthesis: "Nothing is known yet.",
      goal: "Formulate a plan to address the user's message.",
      history: "",
      warnings: [],
      originalUserMessage: userMessage,
      completedSteps: []
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
      if (step > 1) {
        await this.synthesizeState(loopState, userMessage);
      }

      // PHASE 2: DECIDE ACTION
      const actionResult = await this.decideNextAction(loopState, workingMemory, actionHistory);
      if (actionResult.shouldBreak) {
        return actionResult.response || '';
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
        this.shortTermMemory.remember('user', 'User message', userMessage);
        this.shortTermMemory.remember(this.name, synthesis, response);
      } catch (memoryError) {
        logger.warn(`Failed to store agentic memory for ${this.name}: ${memoryError}`);
      }
    }
  }

  public async contactAsAgent(userMessage: string): Promise<string> {
    let response = '';
    try {
      logger.info(`${this.name} beginning agentic loop...`);

      const { workingMemory, loopState, actionHistory } = await this.initializeAgenticLoop(userMessage);

      response = await this.executeAgenticLoop(loopState, workingMemory, actionHistory, userMessage) || 
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
COMPLETE PROMPT

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

YOUR TASK: Now, rewrite the following TEXT PASSAGE into a spoken script. Only respond with the spoken script itself.

TEXT PASSAGE:\n${text}

SPOKEN SCRIPT:\n`

    return await this.conduit.contact(userPrompt, this.withPersonality(systemPrompt), this.config.model, this.config.options)
  }
  
  /**
   * Handles tool response execution using a switch statement
   */
  private async handleToolResponse(
    tool: AgenticTool,
    agenticResponse: AgenticResponse,
    loopState: AgenticLoopState,
    actionHistory: string[]
  ): Promise<{ response?: string; shouldBreak: boolean }> {
    const { originalUserMessage } = loopState;
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
        const toolResponse = await this.toolUser.executeAgenticTool(tool, agenticResponse.thought, originalUserMessage);
        const historyEntry = `Thought: ${agenticResponse.thought}\nAction: ${JSON.stringify(agenticResponse.action)}\nObservation: ${OBSERVATION_START_DELIMITER}${toolResponse}${OBSERVATION_END_DELIMITER}\n\n`;
        loopState.history += historyEntry;
        
        // Check for repetitive actions before adding to history
        if (this.isRepetitiveAction(actionHistory, tool.name)) {
          this.addRepetitiveActionWarning(loopState, tool.name);
        }
        
        // Add action to history
        actionHistory.push(tool.name);
        
        // Track completed steps to avoid repetition
        const stepDescription = `${tool.name}: ${JSON.stringify(tool.parameters)}`;
        if (!loopState.completedSteps.includes(stepDescription)) {
          loopState.completedSteps.push(stepDescription);
        }
        
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