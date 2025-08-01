import axios from 'axios';
import { MAGI_CONDUIT_API_BASE_URL, ModelType } from '../config';
import { logger } from '../logger';
import { MagiName } from './magi';
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
    model: ModelType,
    options: ConduitRequestOptions,
    format?: string
  ): Promise<string> {
    const requestData = this.buildRequestData(userPrompt, systemPrompt, model, options, format);
    
    logger.debug(`➡️🤖\n\n${systemPrompt}\n\n${userPrompt}\n\n`);

    return MagiErrorHandler.withErrorHandling(
      async () => {
        const response = await axios.post<ConduitResponse>(
          `${MAGI_CONDUIT_API_BASE_URL}/api/generate`,
          requestData,
          { timeout: 60000 } // 1-minute timeout
        );

        logger.debug(`🔙🤖\n\n${response.data.response}\n\n`);
        return response.data.response;
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
    const originalResponse = await this.contact(userPrompt, systemPrompt, model, options, 'json');
    
    // Try to parse the JSON response
    try {
      return this.parseJsonResponse(originalResponse);
    } catch (parseError) {
      // JSON parsing failed, attempt to fix it
      logger.debug(`${this.magiName} original malformed response:`, originalResponse);
      logger.error(`${this.magiName} failed to parse JSON response:`, parseError);
      throw new Error(`Failed to parse JSON response: ${parseError}`);
    }
  }

  /**
   * Parse JSON response with error handling and markdown extraction
   * @param jsonResponse - The raw JSON response from the AI
   * @returns Parsed JSON object
   */
  private parseJsonResponse(jsonResponse: string): any {
    // Try to extract JSON from the response if it's wrapped in markdown or other text
    let cleanedJSON = jsonResponse.trim();
    
    // Remove markdown code blocks if present
    const jsonBlockMatch = cleanedJSON.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonBlockMatch) {
      cleanedJSON = jsonBlockMatch[1].trim();
      logger.debug(`${this.magiName} extracted JSON from code block:\n${cleanedJSON}`);
    }
    
    const parsedData = JSON.parse(cleanedJSON);
    logger.debug(`${this.magiName} successfully parsed JSON data:\n${JSON.stringify(parsedData)}`);
    return parsedData;
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