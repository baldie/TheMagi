import path from 'path';

/**
 * Configuration constants for The Magi Orchestrator
 */

/** Enum for the LLM models used */
export enum Model {
  Llama2 = 'llama2',
  Gemma = 'gemma',
  Mistral = 'mistral',
}

/** Base URL for the Magi Conduit API (powered by Ollama) */
export const MAGI_CONDUIT_API_BASE_URL = 'http://localhost:11434';

/** Base URL for the TTS API */
export const TTS_API_BASE_URL = 'http://localhost:8000';

/**
 * Required models for the system to function
 */
export const REQUIRED_MODELS = [Model.Llama2, Model.Gemma, Model.Mistral];

/** Configuration for logging levels */
export const LOG_LEVELS = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
} as const;

/** Type for log levels */
export type LogLevel = typeof LOG_LEVELS[keyof typeof LOG_LEVELS];