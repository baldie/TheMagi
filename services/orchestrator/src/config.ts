/**
 * Configuration constants for The Magi Orchestrator
 */

// Import model configuration from central JSON file (with local override support)
import * as fs from 'fs';
import * as path from 'path';

// Load models configuration with local override support
const modelsJsonPath = path.resolve(__dirname, '../../../models.json');
const modelsLocalJsonPath = path.resolve(__dirname, '../../../models.local.json');

// Check if local override exists, otherwise use default
const modelsConfigPath = fs.existsSync(modelsLocalJsonPath) ? modelsLocalJsonPath : modelsJsonPath;
const modelsConfig: ModelsConfigFile = JSON.parse(fs.readFileSync(modelsConfigPath, 'utf8'));

/** Model configuration interface */
interface ModelConfig {
  name: string;
  magi?: string; // Optional for additional_models
}

/** Complete models configuration interface */
interface ModelsConfigFile {
  models: ModelConfig[];
  additional_models?: ModelConfig[];
  meta?: {
    version: string;
    updated: string;
    description: string;
  };
}

/** Model constants - dynamically generated from models.json */
export const Model = {
  Mistral: modelsConfig.models.find(m => m.magi === 'Balthazar')!.name,
  Gemma: modelsConfig.models.find(m => m.magi === 'Melchior')!.name,
  Llama: modelsConfig.models.find(m => m.magi === 'Caspar')!.name,
} as const;

/** Type for model values */
export type ModelType = typeof Model[keyof typeof Model];

/** Base URL for the Magi Conduit API (powered by Ollama) */
export const MAGI_CONDUIT_API_BASE_URL = 'http://localhost:11434';

/** Base URL for the TTS API */
export const TTS_API_BASE_URL = 'http://localhost:8000';

/**
 * Required models for the system to function - loaded from models.json
 */
export const REQUIRED_MODELS = modelsConfig.models.map((m: ModelConfig) => m.name);

/** Configuration for logging levels */
export const LOG_LEVELS = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
} as const;

/** Type for log levels */
export type LogLevel = typeof LOG_LEVELS[keyof typeof LOG_LEVELS];