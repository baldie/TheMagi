import path from 'path';
import { Model, ModelType } from '../config';
import { logger } from '../logger';
import { ConduitClient } from './conduit-client';
import { ToolUser } from './tool-user';
import { MagiName } from '../types/magi-types';
import { EXCLUDED_TOOL_PARAMS } from '../mcp/tools/tool-registry';
import { MagiErrorHandler } from './error-handler';
import { ShortTermMemory } from './short-term-memory';
export { MagiName };

/**
 * Interface for the configuration of a single Magi persona.
 */
interface MagiConfig {
  model: ModelType;
  personalitySource: string;
  uniqueInstructions: string;
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

/**
 * Configuration for each Magi persona.
 */
const MAX_STEPS = 8;

export const PERSONAS_CONFIG: Record<MagiName, MagiConfig> = {
  [MagiName.Balthazar]: {
    model: Model.Llama,
    personalitySource: path.resolve(__dirname, 'personalities', 'Balthazar.md'),
    uniqueInstructions: `You can only use URLs provided by a search tool. Do not make up or guess URLs`,
    options: { temperature: 0.4 },
  },
  [MagiName.Melchior]: {
    model: Model.Gemma,
    personalitySource: path.resolve(__dirname, 'personalities', 'Melchior.md'),
    uniqueInstructions: `If the user's message reveals personal preferences, emotional states, personal details, or other information relevant to your role, you should make your next step to store this data using your tool(s). Consider choosing a category that will make it easy to find this data in the future. Conversely, if the user asks a question about their personal information, your plan should first retrieve the data using your tool(s).`,
    options: { temperature: 0.6 },
  },
  [MagiName.Caspar]: {
    model: Model.Qwen,
    personalitySource: path.resolve(__dirname, 'personalities', 'Caspar.md'),
    uniqueInstructions: ``,
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
      // Extract actual parameter names and types from JSON Schema
      const parameters = this.toolUser.extractParameterDetails(t.inputSchema);
      
      // Format parameters as readable string instead of object
      const paramString = Object.entries(parameters)
        .filter(([name]) => !EXCLUDED_TOOL_PARAMS.has(name))
        .map(([name, type]) => `"${name}":"${type}"`)
        .join(',');
      
      return `- { "tool": { "name": "${t.name}", "description": "${t.description || ''}", "parameters": {${paramString}} } }\nUSAGE:\n${t.instructions || 'Infer instructions based on parameter names'}`;
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

  public async contactAsAgent(userMessage: string): Promise<string> {
    let response = '';
    try {
        logger.info(`${this.name} beginning agentic loop...`);

        // Get working memory context for this interaction
        const workingMemory = await this.shortTermMemory.summarize();

        const loopState = {
            synthesis: "Nothing is known yet.",
            goal: "Formulate a plan to address the user's message.",
            history: ""
        };

        const { model, options } = this.config;

        for (let step: number = 1; step < MAX_STEPS; step++) {
            // =================================================================
            // PHASE 1: SYNTHESIZE STATE
            // =================================================================
            if (step > 1) {
              // Extract the most recent observation from history
              let observation = "No previous actions taken yet.";
              if (loopState.history.trim()) {
                // Find the last "Observation:" in the history
                const lastObservationIndex = loopState.history.lastIndexOf('Observation: ');
                if (lastObservationIndex !== -1) {
                  // Extract from "Observation: " to the end of that observation block
                  const observationStart = lastObservationIndex;
                  const restOfHistory = loopState.history.substring(observationStart);
                  // Split by double newlines and take the first part (the complete observation)
                  const observationParts = restOfHistory.split('\n\n');
                  observation = observationParts[0] || "No observation found.";
                  logger.debug(`${this.name} extracted observation: ${observation}`);
                } else {
                  observation = "Previous actions taken but no observation found.";
                }
              }
              const systemInstructionsPrompt = `
Your job is to synthesize information and define the next goal for yourself.

INSTRUCTIONS:
1. Update your synthesis based on the latest observation
2. Evaluate your current goal:
   - Is it still relevant to the user?
   - Have you learned something that changes what you should focus on?
   - Are you getting stuck in a loop or pursuing an unproductive path?
3. Define your next goal:
   - If current goal is still valid: Continue with the logical next step
   - If current goal is complete: Move to the next phase or provide final answer
   - If current goal is no longer relevant: Pivot to what the user actually needs

TASK:
Review all information to update the "synthesis" of what you know.
Define the single next "goal" based on your evaluation.
Format response as a single JSON object with no other text.

Example format:
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

Latest User Message: "${userMessage}"
`.trim();

                try {
                    const stateUpdate: { synthesis: string, goal: string | object } = await this.conduit.contactForJSON(synthesisPrompt, this.withPersonality(systemInstructionsPrompt), model, options);
                    loopState.synthesis = stateUpdate.synthesis;
                    
                    // Handle goal - AI sometimes returns object instead of string
                    if (typeof stateUpdate.goal === 'string') {
                        loopState.goal = stateUpdate.goal;
                    } else if (typeof stateUpdate.goal === 'object' && stateUpdate.goal !== null) {
                        // Extract description if it exists, otherwise stringify the object
                        const goalObj = stateUpdate.goal as any;
                        loopState.goal = goalObj.description || goalObj.task || JSON.stringify(stateUpdate.goal);
                    } else {
                        loopState.goal = "Continue with current objective";
                    }
                    
                    logger.debug(`${this.name} state update - synthesis: ${stateUpdate.synthesis}, goal: ${loopState.goal}`);
                } catch (jsonError) {
                    logger.error(`${this.name} failed to get JSON response for state synthesis:`, jsonError);
                    // Continue with previous state rather than breaking the loop
                    logger.warn(`${this.name} continuing with previous goal: ${loopState.goal}`);
                }
            }

            // =================================================================
            // PHASE 2: DECIDE ACTION (This part remains the same)
            // =================================================================
            const toolsWithClarification = this.toolsList + '\n- { "tool": { "name": "ask-user", "description": "Ask the user a clarifying question if more information is needed.", "parameters": {"question":"string (required) - The question to ask the user."} } }';

            const systemPrompt = `
Your job is to decide the single next step to achieve your current goal. Think step by step.

Available tools:
${toolsWithClarification}

ACTION PRIORITIES:
1. Use Available Tools: Leverage your unique capabilities and data access to gather relevant information
2. Ask User: Only if the query is too vague or you need specific personal constraints that your tools cannot provide
3. Final Answer: When you have gathered sufficient information using your available resources

Format your response as JSON only:

Example for a tool call:
\`\`\`json
{
  "thought": "I will use a tool to get information.",
  "action": { "tool": { "name": "tool-name", "parameters": { "query": "..." } } }
}
\`\`\`

Example for asking the user a question:
\`\`\`json
{
  "thought": "I cannot proceed without knowing the user's budget.",
  "action": { "tool": { "name": "ask-user", "parameters": { "question": "What is your budget for this project?" } } }
}
\`\`\`

Example for a final answer:
\`\`\`json
{
  "thought": "I have all the information needed.",
  "action": { "finalAnswer": "Here is the final answer..." }
}
\`\`\`
`.trim();

const reasonPrompt = `
CONTEXT:
${workingMemory}

CURRENT GOAL:
${loopState.goal}

WHAT YOU KNOW:
${loopState.synthesis}

USER'S LATEST MESSAGE:
"${userMessage}"
`.trim();

            let agenticResponse: AgenticResponse;
            try {
                agenticResponse = await this.conduit.contactForJSON(reasonPrompt, this.withPersonality(systemPrompt), model, options);
                logger.debug(`${this.name} agentic response - thought: ${agenticResponse.thought}, action: ${JSON.stringify(agenticResponse.action)}`);
            } catch (jsonError) {
                logger.error(`${this.name} failed to get JSON response for action decision:`, jsonError);
                response = "Sorry, I encountered an error processing my response and had to stop.";
                break;
            }
            
            const { tool, finalAnswer } = agenticResponse.action;

            if (tool) {
                if (tool.name === 'ask-user') {
                    response = tool.parameters.question as string;
                    logger.info(`${this.name} has a clarifying question: "${response}"`);
                    break; // Exit the loop to return the question to the user
                } else {
                    const toolResponse = await this.toolUser.executeAgenticTool(tool, agenticResponse.thought, userMessage);
                    const historyEntry = `Thought: ${agenticResponse.thought}\nAction: ${JSON.stringify(agenticResponse.action)}\nObservation: ${toolResponse}\n\n`;
                    loopState.history += historyEntry;
                    logger.debug(`${this.name} added to history: ${historyEntry}`);
                    logger.debug(`${this.name} full history now: ${loopState.history}`);
                }
            }
            else if (finalAnswer) {
                response = finalAnswer;
                break;
            } else {
                logger.error(`Invalid results response from agentic loop:\n${JSON.stringify(agenticResponse)}`);
                response = "Sorry, I received an invalid response and had to stop.";
                break;
            }
        }
        
        // Store the interaction in short-term memory
        if (response) {
            try {
                this.shortTermMemory.remember('user', 'User message', userMessage);
                this.shortTermMemory.remember(this.name, loopState.synthesis, response);
            } catch (memoryError) {
                logger.warn(`Failed to store agentic memory for ${this.name}: ${memoryError}`);
            }
        } else {
            logger.warn(`${this.name} agentic loop completed ${MAX_STEPS - 1} steps without reaching final answer`);
            response = `Sorry, I seem to have gotten stuck in a loop. Here is what I found:\n${loopState.synthesis}`;
        }
    }
    catch(error) {
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