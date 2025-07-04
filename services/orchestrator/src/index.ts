import { serviceManager } from './service_manager';
import { logger } from './logger';
import { loadMagi } from './loading';
import { beginDeliberation } from './ready';
import { createWebSocketServer } from './websocket';
import { runDiagnostics } from './diagnostics';
import { balthazar, caspar, melchior, MagiName } from './magi';
import express from 'express';
import http from 'http';
import cors from 'cors';

// Track initialization state
let isInitialized = false;

/**
 * Main application entry point.
 * Initializes services, runs diagnostics, and starts the server.
 */
async function main() {
  logger.info('Magi Orchestrator is starting up...');

  // Start the services
  try {
    await serviceManager.startTTSService();
    await serviceManager.startConduitService();
    await serviceManager.startUIService();
    startHttpOrchestratorService();
  } catch (error) {
    logger.error('A critical error occurred while starting the services.', error);
    process.exit(1);
  }

  // Perform startup initialization
  try {
    await runDiagnostics();
    await loadMagi();
    isInitialized = true; 
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

// This service provides the orchestrator'shealth route and a websocket server for the UI to connect to.
function startHttpOrchestratorService() {
  const app = express();
  app.use(cors({ origin: 'http://localhost:4200' }));
  const server = http.createServer(app);

  app.get('/health', (req, res) => {
    res.status(200).json(
      {
        status: isInitialized ? 'available' : 'busy',
        magi: {
          caspar: {
            status: caspar.getStatus()
          },
          melchior: {
            status: melchior.getStatus()
          },
          balthazar: {
            status: balthazar.getStatus()
          },
        }
      });
  });

  createWebSocketServer(server, beginDeliberation);

  const PORT = process.env.PORT || 8080;
  server.listen(PORT, () => {
    logger.info(`Orchestrator HTTP/WebSocket server listening on port ${PORT}`);
  });
}
