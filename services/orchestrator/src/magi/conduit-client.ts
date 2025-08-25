import axios from 'axios';
import type { ModelType } from '../config';
import { MAGI_CONDUIT_API_BASE_URL } from '../config';
import { logger } from '../logger';
import type { MagiName } from './magi2';
import { MagiErrorHandler } from './error-handler';

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
  constructor(private readonly magiName: MagiName) {}

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
    model: ModelType,
    options: ConduitRequestOptions,
    format?: string
  ): Promise<string> {
    const requestData = this.buildRequestData(userPrompt, systemPrompt, model, options, format);
    
    logger.debug(`➡️🤖\n\n${systemPrompt}\n\n${userPrompt}\n\n`);

    return MagiErrorHandler.withErrorHandling(
      async () => {
        const maxRetries = 3;
        let lastError: any;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const response = await axios.post<ConduitResponse>(
              `${MAGI_CONDUIT_API_BASE_URL}/api/generate`,
              requestData,
              { timeout: 60000 } // 1-minute timeout
            );

            logger.debug(`🔙🤖\n\n${response.data.response}\n\n`);
            return response.data.response;
          } catch (error) {
            lastError = error;
            logger.warn(`${this.magiName} conduit request attempt ${attempt}/${maxRetries} failed:`, error);
            
            if (attempt < maxRetries) {
              const delayMs = Math.pow(2, attempt - 1) * 1000; // Exponential backoff: 1s, 2s, 4s
              logger.info(`${this.magiName} retrying ${userPrompt} in ${delayMs}ms...`);
              await new Promise(resolve => setTimeout(resolve, delayMs));
            }
          }
        }

        throw lastError;
      },
      {
        magiName: this.magiName,
        operation: 'conduit contact',
        startTime: Date.now()
      }
    );
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
    model: ModelType,
    options: ConduitRequestOptions
  ): Promise<any> {
    const maxParseRetries = 3;
    let lastParseError: any;

    for (let attempt = 1; attempt <= maxParseRetries; attempt++) {
      let response: string;
      response = '';
      try {
        response = await this.contact(userPrompt, systemPrompt, model, options, 'json');
        return this.parseJsonResponse(response);
      } catch (parseError) {
        lastParseError = parseError;
        logger.warn(`${this.magiName} JSON parse attempt ${attempt}/${maxParseRetries} failed: ${parseError}`);
        logger.warn(`Response was: ${response}`);
        if (attempt < maxParseRetries) {
          logger.info(`${this.magiName} retrying JSON request...`);
        }
      }
    }

    // All parsing attempts failed
    logger.error(`${this.magiName} failed to parse JSON response after ${maxParseRetries} attempts:`, lastParseError);
    throw new Error(`Failed to parse JSON response after ${maxParseRetries} attempts: ${lastParseError}`);
  }

  /**
   * Parse JSON response with error handling and markdown extraction
   * @param jsonResponse - The raw JSON response from the AI
   * @returns Parsed JSON object
   */
  private parseJsonResponse(jsonResponse: string): any {
    // Try to extract JSON from the response if it's wrapped in markdown or other text
    let cleanedJSON = jsonResponse.trim();
    
    // Remove markdown code blocks if present (avoid vulnerable regex)
    const codeBlockStart = cleanedJSON.indexOf('```');
    if (codeBlockStart !== -1) {
      // Find the end of the code block after the start
      const codeBlockEnd = cleanedJSON.indexOf('```', codeBlockStart + 3);
      if (codeBlockEnd !== -1) {
        // Optionally remove 'json' after the opening ```
        let blockContent = cleanedJSON.slice(codeBlockStart + 3, codeBlockEnd).trim();
        if (blockContent.startsWith('json')) {
          blockContent = blockContent.slice(4).trim();
        }
        cleanedJSON = blockContent;
        logger.debug(`${this.magiName} extracted JSON from code block:\n${cleanedJSON}`);
      }
    }
    
    return JSON.parse(cleanedJSON);
  }

  /**
   * Builds the request data for the Conduit API.
   */
  private buildRequestData(
    userPrompt: string,
    systemPrompt: string,
    model: ModelType,
    options: ConduitRequestOptions,
    format?: string
  ) {
    return {
      model: model,
      system: systemPrompt,
      prompt: userPrompt,
      stream: false,
      format: format,
      keep_alive: "30m",
      options: {
        ...options,
        num_ctx: 8192,        // Increased for better context retention
        num_predict: 1024,    // Allow for more detailed responses
        repeat_penalty: 1.05, // Slightly lower to allow concept reinforcement
        top_k: 40,           // Add for better response variety
        top_p: 0.9,          // Add for balanced creativity/coherence
      },
    };
  }
}