import path from 'path';
import { Model } from '../config';
import { logger } from '../logger';
import { ConduitClient } from './conduit-client';
import { ToolUser } from './tool-user';
import { Planner, PlanStep } from './planner';

export enum MagiName {
  Balthazar = 'Balthazar',
  Melchior = 'Melchior',
  Caspar = 'Caspar',
}

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
    model: Model.Llama2,
    personalitySource: path.resolve(__dirname, 'personalities', 'Balthazar.md'),
    options: { temperature: 0.3 },
  },
  [MagiName.Melchior]: {
    model: Model.Gemma,
    personalitySource: path.resolve(__dirname, 'personalities', 'Melchior.md'),
    options: { temperature: 0.7 },
  },
  [MagiName.Caspar]: {
    model: Model.Mistral,
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
   * Caches the personality prompt from the configured source file.
   * @param prompt - The prompt string read from the file.
   */
  setPersonality(prompt: string): void {
    this.personalityPrompt = prompt;
    this.planner.setPersonality(prompt);
    logger.debug(`... Prompt for ${this.name} cached in memory.`);
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

  async performIndependentAnalysis(inquiry: string): Promise<string> {
    try {
      logger.info(`${this.name} beginning independent analysis for: ${inquiry}`);
      
      // Step 1: Execute the plan step by step
      const analysisResult = await this.planner.executePlan(this.planner.getInitialPlan(), inquiry);
      logger.debug(`${this.name} completed plan execution`);
      
      // Step 2: Synthesize final response
      const finalResponse = await this.planner.synthesizeResponse(analysisResult, inquiry);
      logger.info(`${this.name} completed independent analysis`);
      
      return finalResponse;
    } catch (error) {
      logger.error(`${this.name} failed during independent analysis:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Independent analysis failed for ${this.name}: ${errorMessage}`);
    }
  }

  /**
   * Expose parsePlanSteps for testing - delegates to Planner
   */
  public async parsePlanSteps(planResponse: string): Promise<PlanStep[]> {
    return await this.planner.parsePlanSteps(planResponse);
  }

  /**
   * Contacts the Magi persona through the Magi Conduit to get a response.
   * @param userPrompt - The user's question or the content of a debate turn.
   * @returns The AI's response text.
   */
  async contact(userPrompt: string): Promise<string> {
    this.status = 'busy';
    
    try {
      const response = await super.contact(
        userPrompt,
        this.getPersonality(),
        this.config.model,
        this.config.options
      );
      
      this.status = 'available';
      return response;
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