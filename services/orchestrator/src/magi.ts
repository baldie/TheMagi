import axios from 'axios';
import path from 'path';
import { MAGI_CONDUIT_API_BASE_URL, Model } from './config';
import { logger } from './logger';
import { MAGI_MANIFESTO } from './magi_manifesto';

/**
 * Enum for Magi names
 */
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
 * Interface for the response from the Magi Conduit (Ollama API).
 */
interface ConduitResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration: number;
  load_duration: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/**
 * The Magi class represents a single AI persona within the Magi system.
 */
export class Magi {
  private personalityPrompt: string = '';
  private status: 'available' | 'busy' | 'offline' = 'offline';
  
  constructor(public name: MagiName, private config: MagiConfig) {}

  /**
   * Caches the personality prompt from the configured source file.
   * @param prompt - The prompt string read from the file.
   */
  setPersonality(prompt: string): void {
    this.personalityPrompt = prompt;
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

  /**
   * Contacts the Magi persona through the Magi Conduit to get a response.
   * @param userPrompt - The user's question or the content of a debate turn.
   * @returns The AI's response text.
   */
  async contact(userPrompt: string): Promise<string> {
    this.status = 'busy';
    const systemPrompt = `${MAGI_MANIFESTO}\n\n${this.getPersonality()}`;

    const requestData = {
      model: this.config.model,
      system: systemPrompt,
      prompt: userPrompt,
      stream: false,
      options: this.config.options,
    };

    try {
      logger.debug(`Contacting ${this.name}:`, {
        url: `${MAGI_CONDUIT_API_BASE_URL}/api/generate`,
        model: this.config.model,
        promptLength: userPrompt.length,
      });

      const response = await axios.post<ConduitResponse>(
        `${MAGI_CONDUIT_API_BASE_URL}/api/generate`,
        requestData,
        { timeout: 300000 } // 5-minute timeout
      );

      logger.debug(`${this.name} has responded.`);
      this.status = 'available';
      return response.data.response;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response) {
          logger.error(`Magi Conduit returned an error for ${this.name}:`, {
            status: error.response.status,
            data: error.response.data,
          });
          throw new Error(`API Error for ${this.name}: ${error.response.statusText}`);
        } else if (error.request) {
          // Handle cases like 'socket hang up' or ECONNREFUSED where the message might be empty
          const errorMessage = error.message || 'The connection was abruptly closed.';
          logger.error(`Network error when contacting ${this.name}. No response received.`, {
            errorMessage: errorMessage,
            code: error.code,
          });
          throw new Error(`Network Error for ${this.name}: ${errorMessage}. Is the Magi Conduit running correctly?`);
        }
      }
      logger.error(`Unexpected error calling Magi Conduit for ${this.name}:`, error);
      throw new Error(`Failed to get response from ${this.name}.`);
    }
  }
}

/**
 * Configuration for each Magi persona.
 */
export const PERSONAS_CONFIG: Record<MagiName, MagiConfig> = {
  [MagiName.Balthazar]: {
    model: Model.Llama2,
    personalitySource: path.resolve(__dirname, 'personalities', 'Balthazar.md'),
    options: { temperature: 0.2 },
  },
  [MagiName.Melchior]: {
    model: Model.Gemma,
    personalitySource: path.resolve(__dirname, 'personalities', 'Melchior.md'),
    options: { temperature: 0.9 },
  },
  [MagiName.Caspar]: {
    model: Model.Mistral,
    personalitySource: path.resolve(__dirname, 'personalities', 'Caspar.md'),
    options: { temperature: 0.7 },
  },
};

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