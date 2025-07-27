import path from 'path';
import { Model, ModelType } from '../config';
import { logger } from '../logger';
import { ConduitClient } from './conduit-client';
import { ToolUser } from './tool-user';
import { MagiName } from '../types/magi-types';
import { EXCLUDED_TOOL_PARAMS, TOOL_REGISTRY } from '../mcp/tools/tool-registry';
import { MagiErrorHandler } from './error-handler';
import { ShortTermMemory } from './short-term-memory';
export { MagiName };

const OBSERVATION_START_DELIMITER = '<<<OBSERVATION_START>>>';
const OBSERVATION_END_DELIMITER = '<<<OBSERVATION_END>>>';

/**
 * Interface for the configuration of a single Magi persona.
 */
interface MagiConfig {
  model: ModelType;
  personalitySource: string;
  uniqueAgenticInstructions: string;
  uniqueAgenticActionPriorities: string;
  options: {
    temperature: number;
  };
}

export type AgenticTool = { name: string; parameters: Record<string, unknown>};

export interface AgenticResponse {
  thought: string;
  action: {
    tool?: AgenticTool;
    finalAnswer?: string;
  }
}

interface AgenticLoopState {
  synthesis: string;
  goal: string;
  history: string;
  warnings: string[];
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
    uniqueAgenticInstructions: `
1. Update your synthesis based on the latest observation
2. Evaluate your current goal:
   - Is it still relevant and actionable?
   - Have you learned something that changes what you should focus on?
3. Define your next goal based on logical progression:
   - If you found URLs, your goal should be to read the content from the most relevant URLs
   - If you have enough information, your goal should be to provide the final answer
   - If current approach isn't working, try a different strategy
    `,
    uniqueAgenticActionPriorities: `
1. Internal Analysis First: Review the CURRENT GOAL and all provided context (DATA TO PROCESS, WHAT YOU KNOW) to determine if you have sufficient information.
2. Use Available Tools: Leverage your unique capabilities and data access to gather relevant information if needed.
3. Follow Logical Progression:
   - After search: Extract content from relevant URLs found
   - After extraction: Analyze and synthesize information
   - After analysis: Provide final answer
4. Ask User: Only if the query is too vague or you need specifics that your tools cannot provide
5. Final Answer: When you have gathered and analyzed sufficient information`,
    options: { temperature: 0.4 },
  },
  [MagiName.Melchior]: {
    model: Model.Gemma,
    personalitySource: path.resolve(__dirname, 'personalities', 'Melchior.md'),
    uniqueAgenticInstructions: `
1. Update your synthesis based on the latest observation
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
    uniqueAgenticActionPriorities: `1. Use Available Tools: Leverage your unique capabilities and data access to gather relevant information
2. Ask User: Only if the query is too vague or you need specific personal constraints that your tools cannot provide
3. Final Answer: When you have gathered sufficient information using your available resources`,
    options: { temperature: 0.6 },
  },
  [MagiName.Caspar]: {
    model: Model.Qwen,
    personalitySource: path.resolve(__dirname, 'personalities', 'Caspar.md'),
    uniqueAgenticInstructions: `
1. Update your synthesis based on the latest observation
2. Evaluate your current goal:
   - Is it still relevant to the user?
   - Have you learned something that changes what you should focus on?
   - Are you getting stuck in a loop or pursuing an unproductive path?
3. Define your next goal:
   - If current goal is still valid: Continue with the logical next step
   - If current goal is complete: Move to the next phase or provide final answer
   - If current goal is no longer relevant: Pivot to what the user actually needs`,
    uniqueAgenticActionPriorities:  `1. Use Available Tools: Leverage your unique capabilities and data access to gather relevant information
2. Ask User: Only if the query is too vague or you need specific personal constraints that your tools cannot provide
3. Final Answer: When you have gathered sufficient information using your available resources`,
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
  private toolsList: string = '';
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
    
    const tools = await this.toolUser.getAvailableTools();
    this.toolsList = tools.map(t => {
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
      
      return `- { "tool": { "name": "${t.name}", "description": "${t.description || ''}", "parameters": {${paramString}} } }\nUSAGE:\n${toolDefinition.instructions || 'Infer instructions based on parameter names'}`;
    }).join('\n');
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
    const workingMemory = await this.shortTermMemory.summarize();
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
      return goalObj.description || goalObj.task || goalObj.objective || JSON.stringify(goal);
    }
    
    return "Continue with current objective";
  }

  /**
   * Builds an analysis prompt for the analyze-data tool
   */
  private buildAnalysisPrompt(focus: string, criteria: string, userMessage: string, synthesis: string): string {
    return `
TASK: Analyze the available information with focus on: ${focus}
${criteria ? `CRITERIA: ${criteria}` : ''}

AVAILABLE INFORMATION:
${synthesis}

USER'S ORIGINAL QUESTION: ${userMessage}

Provide a structured analysis addressing the user's needs. Be thorough but concise. Focus on drawing actionable conclusions from the information you already have.
    `.trim();
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
    userMessage: string, 
    actionHistory: string[]
  ): Promise<void> {
    const observation = await this.extractLatestObservation(loopState.history);
    
    const systemInstructionsPrompt = `
Your job is to synthesize information and define the next goal for yourself.

INSTRUCTIONS:
${this.config.uniqueAgenticInstructions}
TASK:
Review all information to update the "synthesis" of what you know.
Define the single next "goal" based on your evaluation.
Format response as a single JSON object with no other text.

EXAMPLE FORMAT:
\`\`\`json
{
  "synthesis": "Updated summary of what you now know...",
  "goal": "The single next goal to pursue..."
}
\`\`\`
`.trim();

    const synthesisPrompt = `
CONTEXT:
What you know so far:
${loopState.synthesis}

Your previous goal was:
${loopState.goal}

OBSERVATION:
${observation}

ACTIONS TAKEN SO FAR:
${actionHistory.join(' → ') || 'None yet'}

Latest User Message: "${userMessage}"
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
    loopState.warnings.push(`You have used the '${toolName}' tool three times in a row. You MUST use a different tool or provide a final answer now. Do not use '${toolName}' again.`);
  }

  /**
   * Decides next action and executes it, returning result and whether to continue loop
   */
  private async decideNextAction(
    loopState: AgenticLoopState,
    userMessage: string,
    workingMemory: string,
    actionHistory: string[]
  ): Promise<{ response?: string; shouldBreak: boolean }> {
    const observation = await this.extractLatestObservation(loopState.history);
    const toolsWithClarification = this.toolsList + '\n- { "tool": { "name": "ask-user", "description": "Ask the user a clarifying question if more information is needed.", "parameters": {"question":"string (required) - The question to ask the user."} } }\n- { "tool": { "name": "analyze-data", "description": "Process and analyze available information to draw conclusions and insights", "parameters": {"focus":"string (required) - What aspect to analyze (e.g., \'cost comparison\', \'safety ranking\', \'best options\')","criteria":"string (optional) - Any specific constraints or requirements"} } }\nUSAGE:\nfocus (required): What aspect to analyze - cost comparison, safety ranking, best options, trend analysis\ncriteria (optional): Specific constraints or requirements to apply';

    const warnings = loopState.warnings.join('\n');
    if (warnings) {
        loopState.warnings = []; // Clear warnings after use
    }

    const systemPrompt = `
Your immediate task is to decide the single next step to achieve your current goal. Think step by step.

${warnings ? `IMPORTANT WARNINGS:\n${warnings}\n` : ''}AVAILABLE TOOLS:
${toolsWithClarification}

DATA TO PROCESS:
${observation}

ACTION PRIORITIES:${this.config.uniqueAgenticActionPriorities}

Format your response as JSON only:

Example for a tool call:
\`\`\`json
{
  "thought": "I will use a tool to get information.",
  "action": { "tool": { "name": "<TOOL_NAME>", "parameters": { "<TOOL_PARAMETER_NAME>": "<TOOL_PARAMETER_VALUE>" } } }
}
\`\`\`

Example for asking the user a question:
\`\`\`json
{
  "thought": "I cannot proceed without knowing the user's budget.",
"action": { "tool": { "name": "ask-user", "parameters": { "question": "<QUESTION_TO_ASK>" } } }
}
\`\`\`

Example for a final answer:
\`\`\`json
{
  "thought": "I have all the information needed.",
  "action": { "finalAnswer": "<FINAL_ANSWER>" }
}
\`\`\`
`.trim();

    const reasonPrompt = `
${workingMemory ? `CONTEXT:\n${workingMemory}` : ''}

NOTE: Your goal is in reference to the user's latest message:
"${userMessage}"

CURRENT GOAL:
${loopState.goal}

WHAT YOU KNOW:
${loopState.synthesis}

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
    
    const { tool, finalAnswer } = agenticResponse.action;

    if (tool) {
      if (tool.name === 'ask-user') {
        const response = tool.parameters.question as string;
        logger.info(`${this.name} has a clarifying question: "${response}"`);
        return { response, shouldBreak: true };
      } else if (tool.name === 'analyze-data') {
        const analysisPrompt = this.buildAnalysisPrompt(
          tool.parameters.focus as string,
          tool.parameters.criteria as string || '',
          userMessage,
          loopState.synthesis
        );
        
        const analysisResult = await this.contactSimple(analysisPrompt);
        const historyEntry = `Thought: ${agenticResponse.thought}\nAction: ${JSON.stringify(agenticResponse.action)}\nObservation: ${OBSERVATION_START_DELIMITER}${analysisResult}${OBSERVATION_END_DELIMITER}\n\n`;
        loopState.history += historyEntry;
        
        // Check for repetitive actions before adding to history
        if (this.isRepetitiveAction(actionHistory, tool.name)) {
          this.addRepetitiveActionWarning(loopState, tool.name);
        }
        
        // Add action to history
        actionHistory.push(tool.name);
      } else {
        const toolResponse = await this.toolUser.executeAgenticTool(tool, agenticResponse.thought, userMessage);
        const historyEntry = `Thought: ${agenticResponse.thought}\nAction: ${JSON.stringify(agenticResponse.action)}\nObservation: ${OBSERVATION_START_DELIMITER}${toolResponse}${OBSERVATION_END_DELIMITER}\n\n`;
        loopState.history += historyEntry;
        
        // Check for repetitive actions before adding to history
        if (this.isRepetitiveAction(actionHistory, tool.name)) {
          this.addRepetitiveActionWarning(loopState, tool.name);
        }
        
        // Add action to history
        actionHistory.push(tool.name);
      }
    } else if (finalAnswer) {
      return { response: finalAnswer, shouldBreak: true };
    } else {
      logger.error(`Invalid results response from agentic loop:\n${JSON.stringify(agenticResponse)}`);
      return { response: "Sorry, I received an invalid response and had to stop.", shouldBreak: true };
    }

    return { shouldBreak: false };
  }

  public async contactAsAgent(userMessage: string): Promise<string> {
    let response = '';
    try {
      logger.info(`${this.name} beginning agentic loop...`);

      const workingMemory = await this.shortTermMemory.summarize();
      const loopState: AgenticLoopState = {
        synthesis: "Nothing is known yet.",
        goal: "Formulate a plan to address the user's message.",
        history: "",
        warnings: []
      };
      const actionHistory: string[] = [];

      for (let step = 1; step < MAX_STEPS; step++) {
        // PHASE 1: SYNTHESIZE STATE
        if (step > 1) {
          await this.synthesizeState(loopState, userMessage, actionHistory);
        }

        // PHASE 2: DECIDE ACTION
        const actionResult = await this.decideNextAction(loopState, userMessage, workingMemory, actionHistory);
        if (actionResult.shouldBreak) {
          response = actionResult.response || '';
          break;
        }
      }
      
      // Handle loop completion without final answer
      if (!response) {
        logger.warn(`${this.name} agentic loop completed ${MAX_STEPS - 1} steps without reaching final answer`);
        response = `Sorry, I seem to have gotten stuck in a loop. Here is what I found:\n${loopState.synthesis}`;
      }

      // Store the interaction in short-term memory
      if (response) {
        try {
          this.shortTermMemory.remember('user', 'User message', userMessage);
          this.shortTermMemory.remember(this.name, loopState.synthesis, response);
        } catch (memoryError) {
          logger.warn(`Failed to store agentic memory for ${this.name}: ${memoryError}`);
        }
      }
    } catch (error) {
      logger.error(`ERROR: ${error}`);
      throw MagiErrorHandler.createContextualError(error, {
        magiName: this.name,
        operation: 'agentic loop'
      });
    }
    
    logger.debug(`🤖🤖🤖 Final response:\n${response}\n🤖🤖🤖`);
    return response;
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