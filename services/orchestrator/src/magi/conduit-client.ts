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
   * Contacts the Magi Conduit to get a JSON response from the AI model with retry logic for malformed JSON.
   * @param userPrompt - The user's question or the content of a debate turn.
   * @param systemPrompt - The system prompt including manifesto and personality.
   * @param model - The AI model to use for the request.
   * @param options - The request options (temperature, etc.).
   * @returns Parsed JSON object.
   */
  async contactForJSON(
    userPrompt: string,
    systemPrompt: string,
    model: Model,
    options: ConduitRequestOptions
  ): Promise<any> {
    // First attempt: Get response from LLM
    const originalResponse = await this.contact(userPrompt, systemPrompt, model, options);
    
    // Try to parse the JSON response
    try {
      return this.parseJsonResponse(originalResponse);
    } catch (parseError) {
      // JSON parsing failed, attempt to fix it
      logger.debug(`${this.magiName} original malformed response:`, originalResponse);
    }
    
    // Second attempt: Ask LLM to fix the JSON
    const fixPrompt = `The following JSON response contains syntax errors. Fix it to be valid JSON while preserving all the original data and structure:

${originalResponse}

Respond with ONLY the corrected JSON, no additional text or explanation.`;

    const fixedResponse = await this.contact(
      fixPrompt,
      '', // No personality for JSON fixing
      model,
      { temperature: 0.1 } // Low temperature for precise correction
    );
    
    // Try parsing the fixed response
    try {
      return this.parseJsonResponse(fixedResponse);
    } catch (correctionError) {
      // JSON correction also failed, log both attempts and throw
      logger.error(`${this.magiName} contactForJSON failed after correction attempt`);
      logger.error(`${this.magiName} original response:`, originalResponse);
      logger.error(`${this.magiName} corrected response:`, fixedResponse);
      throw new Error(`JSON parsing failed after correction attempt`);
    }
  }

  /**
   * Parse JSON response with error handling and markdown extraction
   * @param jsonResponse - The raw JSON response from the AI
   * @returns Parsed JSON object
   */
  private parseJsonResponse(jsonResponse: string): any {
    try {
      logger.debug(`${this.magiName} attempting to parse JSON:`, jsonResponse);
      
      // Try to extract JSON from the response if it's wrapped in markdown or other text
      let cleanedJSON = jsonResponse.trim();
      
      // Remove markdown code blocks if present
      const jsonBlockMatch = cleanedJSON.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonBlockMatch) {
        cleanedJSON = jsonBlockMatch[1].trim();
        logger.debug(`${this.magiName} extracted JSON from code block:`, cleanedJSON);
      }

      const parsedData = JSON.parse(cleanedJSON);
      logger.debug(`${this.magiName} successfully parsed JSON data:`, parsedData);
      return parsedData;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`${this.magiName} failed to parse JSON response. Error: ${errorMessage}`);
      logger.error(`\n\n${jsonResponse}\n\n`);

      throw error;
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