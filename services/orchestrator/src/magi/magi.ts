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
    options: { temperature: 0.4 },
  },
  [MagiName.Melchior]: {
    model: Model.Qwen,
    personalitySource: path.resolve(__dirname, 'personalities', 'Melchior.md'),
    options: { temperature: 0.6 },
  },
  [MagiName.Caspar]: {
    model: Model.Gemma,
    personalitySource: path.resolve(__dirname, 'personalities', 'Caspar.md'),
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

  async performIndependentAssessment(inquiry: string): Promise<string> {
    try {
      logger.info(`${this.name} beginning independent assessment for: ${inquiry}`);
      
      // Every assessment starts with a seed plan
      const initialPlan = Planner.getSeedPlan();
      const assessmentResult = await this.planner.executePlan(initialPlan, inquiry);
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

  async directInquiry(inquiry: string): Promise<string> {
    return this.executeWithStatusManagement(() => 
      super.contact(inquiry, this.getPersonality(), this.config.model, this.config.options)
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