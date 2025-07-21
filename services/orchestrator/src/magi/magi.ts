import path from 'path';
import { Model } from '../config';
import { logger } from '../logger';
import { ConduitClient } from './conduit-client';
import { ToolUser } from './tool-user';
import { Planner } from './planner';
import { MagiName } from '../types/magi-types';

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

/**
 * Configuration for each Magi persona.
 */
export const PERSONAS_CONFIG: Record<MagiName, MagiConfig> = {
  [MagiName.Balthazar]: {
    model: Model.Llama,
    personalitySource: path.resolve(__dirname, 'personalities', 'Balthazar.md'),
    uniqueInstructions: ``,
    options: { temperature: 0.4 },
  },
  [MagiName.Melchior]: {
    model: Model.Qwen,
    personalitySource: path.resolve(__dirname, 'personalities', 'Melchior.md'),
    uniqueInstructions: `If the user's message reveals personal preferences, emotional states, personal details, or other information relevant to your role, you must include a step in your plan to store this data using your tool(s). For simple statements of fact or preference, your plan should first store the information and then, in a separate step, acknowledge that it has been stored without trying to retrieve or search for related data. Conversely, if the user asks a question about their personal information, your plan should first retrieve the data and then answer the question in a subsequent step.`,
    options: { temperature: 0.6 },
  },
  [MagiName.Caspar]: {
    model: Model.Gemma,
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
  public planner: Planner;
  
  constructor(public name: MagiName, private config: MagiConfig) {
    super(name);
    this.toolUser = new ToolUser(this.name);
    this.planner = new Planner(
      this.name, 
      this,
      this.toolUser,
      this.config.model,
      this.config.options.temperature
    );
  }

  /**
   * Initialize the Magi
   */
  async initialize(prompt: string): Promise<void> {
    this.personalityPrompt = prompt;
    logger.debug(`${this.name} planner initialized with tools`);
    return await this.planner.initialize();
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

  async respondUsingAgenticPlan(userMessage: string): Promise<string> {
    try {
      logger.info(`${this.name} beginning independent assessment for: ${userMessage}`);
      
      // Every assessment starts with a seed plan
      const initialPlan = Planner.getSeedPlan();
      const assessmentResult = await this.planner.executePlan(initialPlan, userMessage);
      logger.debug(`${this.name} completed plan execution`);
      
      return assessmentResult;
    } catch (error) {
      logger.error(`${this.name} failed during independent assessment:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Independent assessment failed for ${this.name}: ${errorMessage}`);
    }
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
      this.respondUsingAgenticPlan(userMessage)
    );
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