import axios from 'axios';
import { MAGI_CONDUIT_API_BASE_URL, Model } from '../config';
import { logger } from '../logger';
import { MagiName } from './magi';

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
 * Interface for the configuration options for a Conduit request.
 */
interface ConduitRequestOptions {
  temperature: number;
}

/**
 * ConduitClient handles all API communication with the Magi Conduit service.
 */
export class ConduitClient {
  constructor(private magiName: MagiName) {}

  /**
   * Contacts the Magi Conduit to get a response from the AI model.
   * @param userPrompt - The user's question or the content of a debate turn.
   * @param systemPrompt - The system prompt including manifesto and personality.
   * @param model - The AI model to use for the request.
   * @param options - The request options (temperature, etc.).
   * @returns The AI's response text.
   */
  async contact(
    userPrompt: string,
    systemPrompt: string,
    model: Model,
    options: ConduitRequestOptions
  ): Promise<string> {
    const requestData = this.buildRequestData(userPrompt, systemPrompt, model, options);
    const startTime = Date.now();

    try {
      const response = await axios.post<ConduitResponse>(
        `${MAGI_CONDUIT_API_BASE_URL}/api/generate`,
        requestData,
        { timeout: 60000 } // 1-minute timeout
      );

      const duration = Date.now() - startTime;
      logger.info(`${this.magiName} conduit contact took ${duration}ms`);
      return response.data.response;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.info(`${this.magiName} conduit contact failed after ${duration}ms`);
      return this.handleError(error);
    }
  }

  /**
   * Builds the request data for the Conduit API.
   */
  private buildRequestData(
    userPrompt: string,
    systemPrompt: string,
    model: Model,
    options: ConduitRequestOptions
  ) {
    return {
      model: model,
      system: systemPrompt,
      prompt: userPrompt,
      stream: false,
      keep_alive: "30m",
      options: {
        ...options,
        num_ctx: 4096,
        num_predict: 512,
        repeat_penalty: 1.1,
      },
    };
  }

  /**
   * Handles errors from the Conduit API.
   */
  private handleError(error: any): never {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        logger.error(`Magi Conduit returned an error for ${this.magiName}:`, {
          status: error.response.status,
          data: error.response.data,
        });
        throw new Error(`API Error for ${this.magiName}: ${error.response.statusText}`);
      } else if (error.request) {
        // Handle cases like 'socket hang up' or ECONNREFUSED where the message might be empty
        const errorMessage = error.message || 'The connection was abruptly closed.';
        logger.error(`Network error when contacting ${this.magiName}. No response received.`, {
          errorMessage: errorMessage,
          code: error.code,
        });
        throw new Error(`Network Error for ${this.magiName}: ${errorMessage}. Is the Magi Conduit running correctly?`);
      }
    }
    logger.error(`Unexpected error calling Magi Conduit for ${this.magiName}:`, error);
    throw new Error(`Failed to get response from ${this.magiName}.`);
  }
}