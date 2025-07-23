import path from 'path';
import { Model } from '../config';
import { logger } from '../logger';
import { ConduitClient } from './conduit-client';
import { ToolUser } from './tool-user';
import { MagiName } from '../types/magi-types';
import { EXCLUDED_TOOL_PARAMS } from '../mcp/tools/tool-registry';

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

export type AgenticTool = { name: string; args: Record<string, unknown>};

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
const MAX_STEPS = 5;

export const PERSONAS_CONFIG: Record<MagiName, MagiConfig> = {
  [MagiName.Balthazar]: {
    model: Model.Llama,
    personalitySource: path.resolve(__dirname, 'personalities', 'Balthazar.md'),
    uniqueInstructions: ``,
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
 * It extends ConduitClient to inherit communication capabilities.
 */
export class Magi extends ConduitClient {
  private personalityPrompt: string = '';
  private status: 'available' | 'busy' | 'offline' = 'offline';
  private toolUser: ToolUser;
  private toolsList: string = '';
  
  constructor(public name: MagiName, private config: MagiConfig) {
    super(name);
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
      super.contact(userPrompt, this.getPersonality(), this.config.model, this.config.options)
    );
  }

  async contactWithoutPersonality(userPrompt: string): Promise<string> {
    return this.executeWithStatusManagement(() => 
      super.contact(userPrompt, '', this.config.model, this.config.options)
    );
  }

  // TODO: maybe we don't need this indirection of "direct User's Message"
  async directMessage(userMessage: string): Promise<string> {
    return this.executeWithStatusManagement(() => 
      this.contactAsAgent(userMessage)
    );
  }

  private async contactAsAgent(userMessage: string): Promise<string> {
    let response = ''
    try {
      logger.info(`${this.name} beginning agentic loop for`);

      let previousLoopResults = '';
      for(let step: number = 1; step < MAX_STEPS; step++){
        const reasonPrompt = `
        Your job is to decide the single next step to take to respond to the user's message.
        Here is the origianl message from the user: "${userMessage}".
        
        ${PERSONAS_CONFIG[this.name].uniqueInstructions || ''}
        Here are the tools you have available:
        ${this.toolsList}
        
        ${step > 1 ? `Review your internal scratchpad below, which tracks your progress. Determine if the original request has been fully addressed.:\n- If the request is complete, your ACTION must be a "FinalAnswer".\n- If the request is not yet complete, your ACTION must be a call to one of the available tools.\n\n--- SCRATCHPAD ---\n${previousLoopResults}\n--- END SCRATCHPAD ---` : ''}

        Format your answer as JSON in the following format:
        \`\`\`json
        {
          "thought": "<YOUR THOUGHT HERE>",
          "action": {
            "tool": {
              "name": "<TOOL NAME>",
              "args": {
                "<ARGUMENT NAME>": "<ARGUMENT VALUE>",
                "<ARGUMENT NAME>": "<ARGUMENT VALUE>",
                "<ARGUMENT NAME>": "<ARGUMENT VALUE>",
              }
            }
          }
        }
        \`\`\`

        OR

        \`\`\`json
        {
          "thought": "<YOUR THOUGHT HERE>",
          "action": {
            "finalAnswer": "<YOUR FINAL ANSWER HERE>"
          }
        }
        \`\`\`
        
        Now ${this.name}, what is your next thought and action?
        Only respond with the properly formatted JSON for the next step you want to take. Do not include any other text.`;

        logger.debug(`💬💬💬Prompt for Step ${step}:\n${reasonPrompt}`);
        const agenticResponse: AgenticResponse = await super.contactForJSON(reasonPrompt, this.getPersonality(), this.config.model, this.config.options);
        
        const { tool, finalAnswer } = agenticResponse.action;
        if (tool) {
          const toolResponse = await this.toolUser.executeAgenticTool(tool, agenticResponse.thought, userMessage);
          previousLoopResults += `Thought: ${agenticResponse.thought}\nAction: ${JSON.stringify(agenticResponse.action)}\nObservation: ${toolResponse}\n\n`;
        }
        else if (finalAnswer) {
          response = finalAnswer;
          break;
        } else {
          logger.error(`Invalid results response from agentic loop:\n${JSON.stringify(agenticResponse)}`)
          break;
        }
      }
      
      if (!response) {
        logger.warn(`${this.name} agentic loop completed ${MAX_STEPS - 1} steps without reaching final answer`);
        response = `Sorry, I seem to have gotten stuck in a loop.`
      }
    }
    catch(error) {
      logger.error(`${this.name} encountered an error during agentic loop: ${error}`);
      throw error;
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