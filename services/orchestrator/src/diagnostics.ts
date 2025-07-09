import { spawn } from 'child_process';
import axios from 'axios';
import os from 'os';
import path from 'path';
import { logger } from './logger';
import { MAGI_CONDUIT_API_BASE_URL, TTS_API_BASE_URL, REQUIRED_MODELS } from './config';
import { PERSONAS_CONFIG } from './magi/magi';
import { promises as fs } from 'fs';
import { exec } from 'child_process';

/**
 * Checks if a service is ready, attempts to start it if not, and polls for it to become available.
 * @param serviceName - The name of the service (e.g., "Magi Conduit").
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
  logger.debug(`[${serviceName}] Health check URL: ${healthUrl}`);
  
  // First, perform a quick check to see if the service is already running.
  try {
    await axios.get(healthUrl, { timeout: 5000 }); // Increased timeout for initial check
    logger.info(`... ${serviceName} service is already running.`);
    return; // If it's running, we're done.
  } catch (e) {
    // Service is not ready, so we will proceed to start and poll.
    logger.info(`... ${serviceName} service not detected or not responding. Attempting to start and poll...`);
  }

  // Issue the start command.
  try {
    // Start the process detached so it can run independently.
    const proc = spawn(startCommand.cmd, startCommand.args, {
      ...startCommand.options,
      detached: true,
      stdio: 'ignore',
    });
    proc.unref(); // Allows the parent process to exit independently of the child.
    logger.info(`... Start command for ${serviceName} issued.`);
    
    if (serviceName === 'Magi Conduit') {
      const conduitStartupDelay = 8000; // Increased to 8 seconds
      logger.info(`... Allowing ${conduitStartupDelay / 1000}s for Magi Conduit to initialize before polling.`);
      await new Promise(res => setTimeout(res, conduitStartupDelay));
    }
  } catch (startError) {
    logger.error(`... Failed to issue start command for ${serviceName}. This may be okay if another process is already starting it.`, startError);
  }

  // Poll with exponential backoff for the service to become ready.
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(healthUrl, { timeout: 10000 }); // Increased timeout for health checks
      
      // For Magi Conduit, verify we got a valid response
      if (serviceName === 'Magi Conduit' && response.data) {
        logger.debug('Magi Conduit health check response:', response.data);
      }
      
      logger.info(`... ${serviceName} service is now ready!`);
      return;
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 
                          typeof e === 'object' && e && 'code' in e ? String(e.code) : 
                          'Unknown error';
      logger.warn(`... ${serviceName} is still not responding. (${errorMessage})`);
      
      // For Magi Conduit, provide more detailed error information
      if (serviceName === 'Magi Conduit') {
        try {
          // Check if port is in use
          await new Promise<void>((resolve) => {
            exec('netstat -ano | findstr ":11434"', (error, stdout) => {
              if (stdout.trim()) {
                logger.error('Port 11434 is in use. This may indicate a stale Ollama process.');
                logger.error('Process information:', stdout.trim());
              }
              resolve();
            });
          });
        } catch (error) {
          logger.debug('Failed to check port status', error);
        }
      }
      
      if (attempt < maxRetries) {
        const delay = initialDelay * 2 ** (attempt - 1);
        logger.info(`... Waiting for ${serviceName}. Checking in ${delay / 1000}s... (Attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(res => setTimeout(res, delay));
      }
    }
  }

  throw new Error(`${serviceName} service failed to become ready after ${maxRetries} attempts.`);
}

/**
 * Pulls a model by executing the 'ollama pull' command directly, which is more robust
 * than using the API for large downloads.
 * @param modelName The name of the model to pull.
 */
async function pullModel(modelName: string): Promise<void> {
  logger.info(`Model "${modelName}" not found. Attempting to download via command line. This may take several minutes...`);
  
  // We execute the command within WSL
  const command = `wsl ollama pull ${modelName}`;
  logger.debug(`Executing command: ${command}`);

  return new Promise<void>((resolve, reject) => {
    const child = exec(command);

    // Log stdout to our info logger
    child.stdout?.on('data', (data) => {
      // Ollama's CLI output includes carriage returns for progress bars, so we clean it up.
      const sanitizedData = data.toString().trim().replace(/(\r\n|\n|\r)/gm, "");
      if (sanitizedData) {
        logger.info(`[Ollama CLI] ${sanitizedData}`);
      }
    });

    // Log stderr to our error logger
    child.stderr?.on('data', (data) => {
      logger.error(`[Ollama CLI] ${data.toString().trim()}`);
    });

    child.on('error', (error) => {
      logger.error(`Failed to start model download for "${modelName}".`, error);
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        logger.info(`Successfully downloaded model "${modelName}".`);
        resolve();
      } else {
        const errorMessage = `Model download for "${modelName}" failed. The process exited with code ${code}.`;
        logger.error(errorMessage);
        reject(new Error(errorMessage));
      }
    });
  });
}

/**
 * Ensures the Magi Conduit service is running and the required models are available.
 * If a model is not available, it will be pulled from the registry.
 */
async function ensureMagiConduitReady(): Promise<void> {
  const scriptDir = path.resolve(__dirname, '../../scripts');
  await ensureServiceReady(
    'Magi Conduit',
    MAGI_CONDUIT_API_BASE_URL,
    {
      cmd: 'start_magi_conduit.bat',
      args: [],
      options: { 
        cwd: scriptDir, 
        shell: true
      },
    },
    10,  // Increase max retries since service startup might take longer
    5000  // Increase initial delay to 5 seconds
  );

  // After service is confirmed running, verify models
  logger.info('Verifying access to LLM models via Magi Conduit...');
  try {
    const response = await axios.get(`${MAGI_CONDUIT_API_BASE_URL}/api/tags`);
    const availableModels = response.data.models.map((m: { name: string }) => m.name.split(':')[0]);
    
    // Detailed logging to see what models are being reported by the API
    logger.debug('Models reported by Magi Conduit API:', response.data.models.map((m: {name: string}) => m.name));
    logger.debug('Models after parsing (tags removed):', availableModels);

    for (const model of REQUIRED_MODELS) {
      if (!availableModels.includes(model)) {
        // If model is not found, pull it.
        await pullModel(model);
      } else {
        logger.info(`... Model found: ${model}`);
      }
    }
    logger.info('... All required models are available.');
  } catch (error) {
    throw new Error(`Failed to verify access to models via Magi Conduit: ${error}`);
  }
}

/**
 * Ensures the Text-to-Speech (TTS) service is running.
 */
async function ensureTTSReady(): Promise<void> {
  const ttsServiceDir = path.resolve(__dirname, '../../services/tts');
  await ensureServiceReady(
    'TTS',
    `${TTS_API_BASE_URL}/health`,
    {
      // Use the 'start' command to launch the batch script in a new, independent window.
      // This prevents the process from exiting prematurely.
      cmd: 'cmd.exe',
      args: ['/c', 'start', '"Magi TTS Service"', 'start_service.bat'],
      options: { cwd: ttsServiceDir, shell: true },
    },
  );
}

async function checkPersonaFiles(): Promise<void> {
  logger.info('Verifying access to persona files...');
  for (const persona of Object.values(PERSONAS_CONFIG)) {
    try {
      // Use fs.promises.access to check file readability
      await fs.access(persona.personalitySource, fs.constants.R_OK);
      logger.info(`... Persona file accessible: ${path.basename(persona.personalitySource)}`);
    } catch (error) {
      const errorMessage = `Cannot access persona file: ${persona.personalitySource}`;
      throw new Error(errorMessage);
    }
  }
}

async function verifyInternetAccess(): Promise<void> {
  logger.info('Verifying internet access...');
  try {
    await axios.get('http://www.gstatic.com/generate_204');
    logger.info('... Internet access verified.');
  } catch (error) {
    throw new Error('Internet access verification failed.');
  }
}

async function verifySufficientRam(): Promise<void> {
  logger.info('Verifying sufficient system RAM...');
  const totalRamGB = os.totalmem() / (1024 ** 3);
  const MIN_RAM_GB = 15; // Minimum recommended RAM in GB should be 16
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
    await checkPersonaFiles();
    await ensureMagiConduitReady();
    await ensureTTSReady();
    logger.info('--- System Diagnostics Passed ---');
  } catch (error) {
    logger.error('System diagnostics failed.', error);
    throw error;
  }
} 