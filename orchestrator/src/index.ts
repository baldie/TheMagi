import { logger } from './logger';
import { runDiagnostics } from './diagnostics';
import { loadMagi } from './loading';
import { runDeliberation } from './ready';
import { speakWithMagiVoice } from './tts';
import { MagiName } from './magi';
import http from 'http';
import { createWebSocketServer } from './websocket';
import { spawn } from 'child_process';
import path from 'path';
import axios from 'axios';
import express from 'express';
import cors from 'cors';

const MAGI_CONDUIT_URL = 'http://127.0.0.1:11434';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Ensures the Magi Conduit service is running before the application proceeds.
 * It checks for the service, and if not found, starts it programmatically.
 */
async function ensureMagiConduitIsRunning() {
  try {
    await axios.get(MAGI_CONDUIT_URL);
    logger.info('Magi Conduit service is already running.');
    return;
  } catch (error) {
    logger.info('Magi Conduit service not detected. Attempting to start it programmatically...');

    const projectRoot = path.resolve(__dirname, '..', '..');
    const modelsPath = path.join(projectRoot, '.models');
    // Prepare for shell command by escaping backslashes for the path
    const wslModelsPath = modelsPath.replace(/\\/g, '\\\\');

    // Command to kill any old processes and then start the server
    const killCommand = 'pkill -9 ollama 2>/dev/null || true';
    const startCommand = `export OLLAMA_MODELS=$(wslpath '${wslModelsPath}'); /snap/bin/ollama serve`;
    const fullCommand = `${killCommand} && ${startCommand}`;

    const magiConduitProcess = spawn('wsl.exe', ['-e', 'bash', '-c', fullCommand], {
      detached: true,
      stdio: 'ignore',
    });

    magiConduitProcess.unref();
    logger.info('Magi Conduit service starting in the background...');

    // Poll the service to see when it's ready
    let retries = 15; // ~30 seconds
    while (retries > 0) {
      await sleep(2000);
      try {
        await axios.get(MAGI_CONDUIT_URL);
        logger.info('Magi Conduit service started successfully.');
        return;
      } catch (e) {
        retries--;
        logger.info(`Waiting for Magi Conduit service... (${retries} retries left)`);
      }
    }
    throw new Error('Failed to start and connect to the Magi Conduit service.');
  }
}

/**
 * The core deliberation logic of The Magi application.
 * This function is now separate so it can be triggered on demand.
 */
async function beginDeliberation(inquiry?: string) {
  try {
    logger.info('--- MAGI DELIBERATION INITIATED ---');
    
    // Use the provided inquiry or a default one
    const deliberationInquiry = inquiry || 'Given the latest data, do we need to communicate to the user? If so, what?';
    logger.info(`Deliberation inquiry: "${deliberationInquiry}"`);

    const finalResponse = await runDeliberation(deliberationInquiry);

    console.log('-------------------------------------------');
    console.log(finalResponse);
    console.log('-------------------------------------------\n');

    if (finalResponse) {
      try {
        logger.info('Sending final response to TTS service...');
        await speakWithMagiVoice(finalResponse, MagiName.Caspar);
        logger.info('...TTS playback complete.');
      } catch (error) {
        logger.error('The final response could not be spoken.', error);
      }
    }

  } catch (error) {
    logger.error('A critical error occurred during system operation.', error);
    // We don't want to exit the process anymore, just log the error.
  }
}

/**
 * Main entry point for The Magi application.
 * This function now only sets up the server and waits for a signal to start.
 */
async function main() {
  // First, ensure our core dependency (Magi Conduit) is running.
  try {
    await ensureMagiConduitIsRunning();
  } catch (error) {
    logger.error('Could not start or connect to the Magi Conduit service. The Magi cannot operate without it.', error);
    process.exit(1);
  }

  const app = express();
  
  // Allow requests from the UI development server
  app.use(cors({ origin: 'http://localhost:4200' }));

  const server = http.createServer(app);

      // Health check endpoint
    app.get('/health', (req, res) => {
      res.status(200).json({ status: 'ok' });
    });

  // Pass the http server to the WebSocket creator
  createWebSocketServer(server, beginDeliberation);

  const PORT = process.env.PORT || 8080;
  server.listen(PORT, () => {
    logger.info(`Orchestrator HTTP/WebSocket server listening on port ${PORT}`);
  });

  // Perform startup initialization
  try {
    logger.info('--- MAGI SYSTEM INITIALIZING ---');
    await runDiagnostics();
    await loadMagi();
    logger.info('The Magi are ready.'); //<-- this should be green
  } catch (error) {
    logger.error('A critical error occurred during system initialization. The application will now exit.', error);
    process.exit(1);
  }
}

main().catch(error => {
  logger.error('Unhandled promise rejection in main.', error);
  process.exit(1);
});