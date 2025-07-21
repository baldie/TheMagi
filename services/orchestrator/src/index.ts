import { serviceManager } from './service_manager';
import { logger } from './logger';
import { loadMagi } from './loading';
import { routeInquiry } from './ready';
import { createWebSocketServer } from './websocket';
import { runDiagnostics } from './diagnostics';
import { balthazar, caspar, melchior } from './magi/magi';
import { mcpClientManager } from './mcp';
import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

// Track initialization state
let isInitialized = false;

/**
 * Load environment variables from .env file
 */
function loadEnvironmentVariables() {
  try {
    const envPath = path.resolve(__dirname, '../../../.env');
    const result = dotenv.config({ path: envPath });
    logger.info(envPath);
    if (result.error) {
      logger.warn('No .env file found at ' + envPath);
    } else {
      logger.info('Environment variables loaded from .env file');
      logger.debug(`TAVILY_API_KEY loaded: ${process.env.TAVILY_API_KEY ? 'Yes' : 'No'}`);
      if (process.env.TAVILY_API_KEY) {
        logger.debug(`TAVILY_API_KEY format valid: ${process.env.TAVILY_API_KEY.startsWith('tvly-') ? 'Yes' : 'No'}`);
      }
    }
  } catch (error) {
    logger.error('Failed to load .env file:', error);
  }
}

/**
 * Main application entry point.
 * Initializes services, runs diagnostics, and starts the server.
 */
async function main() {
  // Load environment variables first
  loadEnvironmentVariables();
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
    await runDiagnostics(); // This now includes MCP server verification and initialization
    await loadMagi();
    
    isInitialized = true; 
    logger.info('http://localhost:4200/\nThe Magi are ready. 🟢');
  } catch (error) {
    logger.error('A critical error occurred during system initialization. The application will now exit.', error);
    gracefulShutdown('unhandledRejection');
  }
}

main().catch(error => {
  logger.error('Unhandled promise rejection in main.', error);
  gracefulShutdown('unhandledRejection');
});

async function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}. Performing graceful shutdown...`);
  
  try {
    await mcpClientManager.cleanup();
    logger.info('MCP client manager cleanup completed.');
  } catch (error) {
    logger.error('Error during MCP cleanup:', error);
  }
  
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// This service provides the orchestrator's health route and a websocket server for the UI to connect to.
function startHttpOrchestratorService() {
  const app = express();
  app.use(cors({ origin: ['http://localhost:4200', 'http://127.0.0.1:4200'] }));
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

  createWebSocketServer(server, routeInquiry);

  const PORT = process.env.PORT || 8080;
  server.listen(PORT, () => {
    logger.info(`Orchestrator listening on port ${PORT}`);
  });
}
