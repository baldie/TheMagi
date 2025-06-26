import axios, { AxiosError } from 'axios';
import { MAGI_CONDUIT_API_BASE_URL, PERSONAS, MagiName, SYSTEM_PREAMBLE } from './config';
import { logger } from './logger';
import { getPrompt } from './persona_manager';

/**
 * Interface for Ollama API response
 */
interface OllamaResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[]; // context is optional in some responses
  total_duration: number;
  load_duration: number;
  prompt_eval_count?: number; // Renamed for clarity, was prompt_eval_duration
  prompt_eval_duration?: number;
  eval_count?: number; // Renamed for clarity, was eval_duration
  eval_duration?: number;
}

/**
 * Contacts a specific Magi persona through the Magi Conduit API
 * @param personaName - Name of the Magi persona (Balthazar, Melchior, or Caspar)
 * @param userPrompt - The user's question, request, or the content of a debate turn.
 * @returns The AI's response text
 */
export async function contactMagi(
  personaName: MagiName,
  userPrompt: string,
): Promise<string> {
  const persona = PERSONAS[personaName];
  const personaPrompt = getPrompt(personaName);

  // Construct the complete system prompt including the universal preamble
  const systemPrompt = `${SYSTEM_PREAMBLE}\n\n${personaPrompt}`;

  const requestData = {
    model: persona.model,
    system: systemPrompt,
    prompt: userPrompt,
    stream: false,
    options: persona.options,
  };

  try {
    logger.debug(`Sending request to Magi Conduit API for ${personaName}:`, {
      url: `${MAGI_CONDUIT_API_BASE_URL}/api/generate`,
      model: persona.model,
      promptLength: userPrompt.length,
      systemPromptLength: systemPrompt.length,
    });

    const response = await axios.post<OllamaResponse>(
      `${MAGI_CONDUIT_API_BASE_URL}/api/generate`,
      requestData
    );

    logger.debug(`Received response from Magi Conduit API for ${personaName}`);
    return response.data.response;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      logger.error(`Error calling Magi Conduit API for ${personaName}:`, {
        status: axiosError.response?.status,
        statusText: axiosError.response?.statusText,
        data: axiosError.response?.data,
        requestUrl: axiosError.config?.url,
        requestData: requestData,
      });
      throw new Error(
        `Failed to get response from ${personaName}: ${axiosError.response?.status} ${axiosError.response?.statusText}. Data: ${JSON.stringify(axiosError.response?.data)}`
      );
    } else {
      logger.error(`Unexpected error calling Magi Conduit API for ${personaName}:`, error);
      throw new Error(
        `Failed to get response from ${personaName}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}