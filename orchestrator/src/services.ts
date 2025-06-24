import axios from 'axios';
import { OLLAMA_API_BASE_URL, PERSONAS, MagiName, SYSTEM_PREAMBLE } from './config';
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
 * Contacts a specific Magi persona through the Ollama API
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

  logger.debug(`Calling Ollama API for ${personaName}`, {
    model: persona.model,
    system_prompt: systemPrompt,
    user_prompt: userPrompt,
    options: persona.options,
  });

  try {
    const response = await axios.post<OllamaResponse>(`${OLLAMA_API_BASE_URL}/api/generate`, {
      model: persona.model,
      system: systemPrompt, // Use the dedicated 'system' parameter
      prompt: userPrompt, // The 'prompt' parameter now holds only the user's query/task
      stream: false,
      options: persona.options, // Pass persona-specific options
    });

    // Note: The 'context' is returned by Ollama for conversational history,
    // but we are managing state in our orchestrator, so we don't need to pass it back.
    logger.debug(`Received response from Ollama API for ${personaName}`);
    return response.data.response;
  } catch (error) {
    logger.error(`Error calling Ollama API for ${personaName}`, error);
    throw new Error(
      `Failed to get response from ${personaName}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}