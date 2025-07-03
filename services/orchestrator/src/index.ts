import { logger } from './logger';
import { runDiagnostics } from './diagnostics';
import { loadMagi } from './loading';
import { runDeliberation } from './ready';
import { speakWithMagiVoice } from './tts';
import { MagiName } from './magi';
import http from 'http';
import { createWebSocketServer } from './websocket';
import path from 'path';
import axios from 'axios';
import express from 'express';
import cors from 'cors';
import { ensureMagiConduitIsRunning } from '../../conduit/src/index';

// Track initialization state
let isInitialized = false;

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    res.status(200).json({ 
      status: isInitialized ? 'ok' : 'busy' 
    });
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
    isInitialized = true; // Mark initialization as complete
    logger.info('The Magi are ready.');
  } catch (error) {
    logger.error('A critical error occurred during system initialization. The application will now exit.', error);
    process.exit(1);
  }
}

main().catch(error => {
  logger.error('Unhandled promise rejection in main.', error);
  process.exit(1);
});