import path from 'path';
import { Model } from '../config';
import { logger } from '../logger';
import { MAGI_MANIFESTO } from './magi_manifesto';
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
  private planner: Planner;
  
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

  async performIndependentAnalysis(topic: string): Promise<string> {
    try {
      logger.info(`${this.name} beginning independent analysis for: ${topic}`);
      
      // Step 1: Generate analysis plan
      const plan = await this.planner.generateAnalysisPlan(topic);
      logger.debug(`${this.name} generated analysis plan:`, { plan });
      
      // Step 2: Execute the plan step by step
      const analysisResult = await this.planner.executePlan(plan, topic);
      logger.debug(`${this.name} completed plan execution`);
      
      // Step 3: Synthesize final response
      const finalResponse = await this.planner.synthesizeResponse(analysisResult, topic);
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
  public parsePlanSteps(planResponse: string): PlanStep[] {
    return this.planner.parsePlanSteps(planResponse);
  }

  /**
   * Expose identifyRequiredTool for testing - delegates to ToolUser
   * @deprecated This method should be replaced with the new tool architecture
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  public identifyRequiredTool(_step: string): string | null {
    // For backward compatibility with tests, return null since the new architecture
    // uses getAvailableTools() instead of step-based tool identification
    return null;
  }

  /**
   * Contacts the Magi persona through the Magi Conduit to get a response.
   * @param userPrompt - The user's question or the content of a debate turn.
   * @returns The AI's response text.
   */
  async contact(userPrompt: string): Promise<string> {
    this.status = 'busy';
    const systemPrompt = `${MAGI_MANIFESTO}\n\n${this.getPersonality()}`;

    try {
      const response = await super.contact(
        userPrompt,
        systemPrompt,
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