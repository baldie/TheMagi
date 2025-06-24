import { MagiName } from './config';
import { logger } from './logger';

const loadedPrompts = new Map<MagiName, string>();

/**
 * Stores a loaded prompt for a specific Magi.
 * @param name - The name of the Magi.
 * @param prompt - The prompt string read from the file.
 */
export function setPrompt(name: MagiName, prompt: string): void {
  loadedPrompts.set(name, prompt);
  logger.debug(`... Prompt for ${name} stored in memory.`);
}

/**
 * Retrieves the loaded prompt for a specific Magi.
 * @param name - The name of the Magi.
 * @returns The loaded prompt string.
 * @throws If the prompt has not been loaded yet.
 */
export function getPrompt(name: MagiName): string {
  const prompt = loadedPrompts.get(name);
  if (!prompt) {
    const err = new Error(`Attempted to access prompt for ${name}, but it has not been loaded.`);
    logger.error('Prompt retrieval error', err);
    throw err;
  }
  return prompt;
} 