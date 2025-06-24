import { spawn } from 'child_process';
import axios from 'axios';
import os from 'os';
import path from 'path';
import { logger } from './logger';
import { OLLAMA_API_BASE_URL, TTS_API_BASE_URL, PERSONAS, REQUIRED_MODELS } from './config';
import fs from 'fs';

/**
 * Checks if a service is ready, attempts to start it if not, and polls for it to become available.
 * @param serviceName - The name of the service (e.g., "Ollama").
 * @param healthUrl - The health check URL for the service.
 * @param startCommand - The command to execute to start the service.
 * @param maxRetries - The number of retry attempts.
 * @param initialDelay - The initial delay in ms for the backoff.
 */
async function ensureServiceReady(
  serviceName: string,
  healthUrl: string,
  startCommand: { cmd: string; args: string[]; options?: object },
  maxRetries: number = 5,
  initialDelay: number = 2000,
): Promise<void> {
  logger.info(`Ensuring ${serviceName} service is ready...`);

  // First, check if the service is already running.
  try {
    await axios.get(healthUrl);
    logger.info(`... ${serviceName} service is already running.`);
    return; // If it's running, we're done.
  } catch (e) {
    // Service is not ready, so we will attempt to start it.
    logger.info(`... ${serviceName} service not detected. Attempting to start it.`);
    try {
      // Start the process detached so it can run independently.
      const proc = spawn(startCommand.cmd, startCommand.args, {
        ...startCommand.options,
        detached: true,
        stdio: 'ignore',
      });
      proc.unref(); // Allows the parent process to exit independently of the child.
      logger.info(`... Start command for ${serviceName} issued.`);
    } catch (startError) {
      logger.error(`... Failed to issue start command for ${serviceName}. This may be okay if another process is already starting it.`, startError);
    }
  }

  // Poll with exponential backoff for the service to become ready.
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const delay = initialDelay * 2 ** (attempt - 1);
    logger.info(`... Waiting for ${serviceName}. Checking in ${delay / 1000}s... (Attempt ${attempt}/${maxRetries})`);
    await new Promise(res => setTimeout(res, delay));

    try {
      await axios.get(healthUrl);
      logger.info(`... ${serviceName} service is now ready!`);
      return;
    } catch (e) {
      logger.warn(`... ${serviceName} is still not responding.`);
    }
  }

  throw new Error(`${serviceName} service failed to become ready after ${maxRetries} attempts.`);
}

/**
 * Ensures the Ollama service is running and the required models are available.
 */
async function ensureOllamaReady(): Promise<void> {
  await ensureServiceReady(
    'Ollama',
    OLLAMA_API_BASE_URL,
    { cmd: 'wsl', args: ['ollama', 'serve'], options: { shell: true } },
  );

  logger.info('Verifying access to LLM models...');
  try {
    const response = await axios.get(`${OLLAMA_API_BASE_URL}/api/tags`);
    const availableModels = response.data.models.map((m: { name: string }) => m.name.split(':')[0]);
    
    for (const model of REQUIRED_MODELS) {
      if (!availableModels.includes(model)) {
        throw new Error(`Required model "${model}" is not available in Ollama.`);
      }
      logger.info(`... Model found: ${model}`);
    }
    logger.info('... All required models are available.');
  } catch (error) {
    throw new Error(`Failed to verify access to Ollama models: ${error}`);
  }
}

/**
 * Ensures the Text-to-Speech (TTS) service is running.
 */
async function ensureTTSReady(): Promise<void> {
  const ttsServiceDir = path.resolve(__dirname, '../../services/tts_microservice');
  await ensureServiceReady(
    'TTS',
    `${TTS_API_BASE_URL}/health`,
    {
      cmd: 'wsl',
      args: ['--cd', ttsServiceDir, 'bash', '-c', 'source venv/bin/activate && python main.py'],
      options: { shell: true },
    },
  );
}

async function verifyPersonaFiles(): Promise<void> {
  logger.info('Verifying access to persona files...');
  for (const persona of Object.values(PERSONAS)) {
    try {
      // Use fs.promises.access to check file readability
      await fs.promises.access(persona.personalitySource, fs.constants.R_OK);
      logger.info(`... Persona file accessible: ${path.basename(persona.personalitySource)}`);
    } catch (error) {
      throw new Error(`Persona file not found or not readable: ${persona.personalitySource}`);
    }
  }
}

async function verifyInternetAccess(): Promise<void> {
  logger.info('Verifying internet access...');
  try {
    await axios.get('http://www.google.com/generate_204');
    logger.info('... Internet access verified.');
  } catch (error) {
    throw new Error('Internet access verification failed.');
  }
}

async function verifySufficientRam(): Promise<void> {
  logger.info('Verifying sufficient system RAM...');
  const totalRamGB = os.totalmem() / (1024 ** 3);
  const MIN_RAM_GB = 16;
  if (totalRamGB < MIN_RAM_GB) {
    throw new Error(`System RAM (${totalRamGB.toFixed(2)} GB) is below the recommended minimum of ${MIN_RAM_GB} GB.`);
  }
  logger.info(`... System RAM is sufficient (${totalRamGB.toFixed(2)} GB).`);
}

/**
 * Runs all system diagnostics to ensure the application can start successfully.
 */
export async function runDiagnostics(): Promise<void> {
  logger.info('--- Running System Diagnostics ---');
  try {
    await verifyInternetAccess();
    await verifySufficientRam();
    await verifyPersonaFiles();
    await ensureOllamaReady();
    await ensureTTSReady();
    logger.info('--- System Diagnostics Passed ---');
  } catch (error) {
    logger.error('System diagnostics failed.', error);
    throw error;
  }
} 