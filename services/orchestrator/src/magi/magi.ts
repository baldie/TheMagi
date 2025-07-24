import path from 'path';
import { Model } from '../config';
import { logger } from '../logger';
import { ConduitClient } from './conduit-client';
import { ToolUser } from './tool-user';
import { MagiName } from '../types/magi-types';
import { EXCLUDED_TOOL_PARAMS } from '../mcp/tools/tool-registry';
import { MagiErrorHandler } from './error-handler';

export { MagiName };

/**
 * Interface for the configuration of a single Magi persona.
 */
interface MagiConfig {
  model: Model;
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
  
  constructor(public name: MagiName, private config: MagiConfig) {
    this.conduit = new ConduitClient(name);
    this.toolUser = new ToolUser(this);
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
      
      return `- { "tool": { "name": "${t.name}", "description": "${t.description || ''}", "parameters": {${paramString}} } }
USAGE:\n${t.instructions || 'Infer instructions based on parameter names'}`;
    }).join('\n');
  }

  /**
   * Retrieves the cached personality prompt.
   * @throws If the prompt has not been loaded yet.
   */
  getPersonality(): string {
    if (!this.personalityPrompt) {
      const err = new Error(`Attempted to access personality for ${this.name}, but it has not been cached.`);
      logger.error('Prompt retrieval error', err);
      throw err;
    }
    return this.personalityPrompt;
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
    return this.executeWithStatusManagement(() => 
      this.conduit.contact(userPrompt, this.getPersonality(), this.config.model, this.config.options)
    );
  }

  async contactWithoutPersonality(userPrompt: string): Promise<string> {
    return this.executeWithStatusManagement(() => 
      this.conduit.contact(userPrompt, '', this.config.model, this.config.options)
    );
  }

  // TODO: maybe we don't need this indirection of "direct User's Message"
  async directMessage(userMessage: string): Promise<string> {
    return this.executeWithStatusManagement(() => 
      this.contactAsAgent(userMessage)
    );
  }

 private async contactAsAgent(userMessage: string): Promise<string> {
    let response = '';
    try {
        logger.info(`${this.name} beginning agentic loop...`);

        // ... (state declaration and Phase 1 are unchanged)
        const loopState = {
            synthesis: "Nothing is known yet.",
            goal: "Formulate a plan to answer the user's message.",
            history: ""
        };

        const { model, options } = this.config;

        for (let step: number = 1; step < MAX_STEPS; step++) {
            // =================================================================
            // PHASE 1: SYNTHESIZE STATE (This part remains the same)
            // =================================================================
            if (step > 1) { 
                // ... (synthesisPrompt and stateUpdate call are unchanged)
            }

            // =================================================================
            // PHASE 2: DECIDE ACTION
            // =================================================================
            
            // MINIMAL CHANGE 1: Add the new 'ask_user' tool to the tools list
            // We do this by creating a new toolsList string for the prompt
            const toolsWithClarification = this.toolsList + '\n- { "tool": { "name": "ask_user", "description": "Ask the user a clarifying question when more information is needed to proceed.", "parameters": {"question":"string (required) - The question to ask the user."} } }';

            const reasonPrompt = `
Your job is to decide the single next step to take to achieve a goal.

**Current Goal:** ${loopState.goal}

**What I know so far:**
${loopState.synthesis}

Here is the original message from the user: "${userMessage}".
Here are the tools you have available:
${toolsWithClarification}

--- INSTRUCTIONS & FORMAT ---
- Based *only* on the "Current Goal", decide the next "thought" and "action".
- If you have enough information, your action must be a "FinalAnswer".
- **If you need more information from the user, you must use the "ask_user" tool.**
- **You must format your response as a single JSON object with no other text.**

**Example for a tool call:**
\`\`\`json
{
  "thought": "I will use a tool to get information.",
  "action": { "tool": { "name": "tavily-search", "parameters": { "query": "..." } } }
}
\`\`\`

**Example for asking the user a question:**
\`\`\`json
{
  "thought": "I cannot proceed without knowing the user's budget.",
  "action": { "tool": { "name": "ask_user", "parameters": { "question": "What is your budget for this project?" } } }
}
\`\`\`

**Example for a final answer:**
\`\`\`json
{
  "thought": "I have all the information needed.",
  "action": { "finalAnswer": "Here is the final answer..." }
}
\`\`\`
`;

            logger.debug(`💬💬💬Prompt for Step ${step}:\n${reasonPrompt}`);
            const agenticResponse: { thought: string, action: { tool?: any, finalAnswer?: string } } = await this.conduit.contactForJSON(reasonPrompt, this.getPersonality(), model, options);
            
            const { tool, finalAnswer } = agenticResponse.action;

            if (tool) {
                // MINIMAL CHANGE 2: Add an else if block to handle the new tool
                if (tool.name === 'ask_user') {
                    response = tool.parameters.question;
                    logger.info(`Agent is asking a clarifying question: "${response}"`);
                    break; // Exit the loop to return the question to the user
                } else {
                    const toolResponse = await this.toolUser.executeAgenticTool(tool, agenticResponse.thought, userMessage);
                    loopState.history += `Thought: ${agenticResponse.thought}\nAction: ${JSON.stringify(agenticResponse.action)}\nObservation: ${toolResponse}\n\n`;
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
        
        if (!response) {
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
    logger.debug(`✅✅✅Final response:\n${response}\n`);

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