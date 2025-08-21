import { serviceManager } from './service_manager';
import { logger } from './logger';
import { loadMagi } from './loading';
import { routeMessage } from './ready';
import { createWebSocketServer } from './websocket';
import { runDiagnostics, runBackgroundMcpVerification } from './diagnostics';
import { balthazar, caspar, melchior } from './magi/magi2';
import { mcpClientManager } from './mcp';
import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { testHooks } from './testing/test-hooks';

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

  // Initialize test recorder if running in test mode
  try {
    await testHooks.initialize();
    if (process.env.MAGI_TEST_MODE === 'true') {
      logger.info('Test mode enabled. Test hooks initialized.');
    }
  } catch (e) {
    logger.error('Failed to initialize test hooks', e);
  }

  // Start the services in parallel
  try {
    const startPromises: Array<Promise<void>> = [];
    // Always ensure conduit is running
    startPromises.push(serviceManager.startConduitService());
    // In normal mode, start TTS and UI; in test mode, skip both
    if (process.env.MAGI_TEST_MODE !== 'true') {
      startPromises.push(serviceManager.startTTSService());
      startPromises.push(serviceManager.startUIService());
    } else {
      logger.info('Test mode: skipping TTS and UI startup');
    }
    await Promise.all(startPromises);
    startHttpOrchestratorService();
  } catch (error) {
    logger.error('A critical error occurred while starting the services.', error);
    process.exit(1);
  }

  // Perform startup initialization
  try {
    if (process.env.MAGI_TEST_MODE === 'true') {
      logger.info('Test mode: skipping system diagnostics');
      await mcpClientManager.initialize();
    } else {
      await runDiagnostics();
    }
    await loadMagi();

    isInitialized = true; 
    
    // Run background MCP verification after system is ready
    runBackgroundMcpVerification(() => {
      // This callback runs when MCP verification is complete
      logger.info('http://localhost:4200/\nThe Magi are ready. 🟢');
    }).catch(error => {
      logger.warn('Background MCP verification failed:', error);
    });
  } catch (error) {
    logger.error('A critical error occurred during system initialization. The application will now exit.', error);
    void gracefulShutdown('unhandledRejection');
  }
}

main().catch(error => {
  logger.error('Unhandled promise rejection in main.', error);
  void gracefulShutdown('unhandledRejection');
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

process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });

// This service provides the orchestrator's health route and a websocket server for the UI to connect to.
function startHttpOrchestratorService(): void {
  const app = express();
  
  // Log ALL HTTP requests
  app.use((req, _res, next) => {
    console.log(`🌐🌐🌐 HTTP ${req.method} ${req.url} 🌐🌐🌐`);
    console.log(`[DEBUG] Headers:`, JSON.stringify(req.headers, null, 2));
    next();
  });
  
  app.use(cors({ origin: ['http://localhost:4200', 'http://127.0.0.1:4200'] }));
  app.use(express.json());
  const server = http.createServer(app);

  server.on('upgrade', (request, _socket, _head) => {
    console.log('🔄🔄🔄 HTTP UPGRADE REQUEST RECEIVED! 🔄🔄🔄');
    console.log('[DEBUG] Upgrade URL:', request.url);
    console.log('[DEBUG] Upgrade Headers:', JSON.stringify(request.headers));
  });

  app.get('/health', (_req, res) => {
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

  async function initializeMagiForTest(magiName: string): Promise<void> {
    let target = null;
    if (magiName === 'Balthazar') {
      target = balthazar;
    } else if (magiName === 'Melchior') {
      target = melchior;
    } else if (magiName === 'Caspar') {
      target = caspar;
    }

    if (!target) return;
    
    const { PERSONAS_CONFIG } = await import('./magi/magi2');
    const src = PERSONAS_CONFIG[target.name].personalitySource;
    const fs = await import('fs/promises');
    const prompt = await fs.readFile(src, 'utf-8');
    await target.initialize(prompt);
    logger.info(`[HTTP] ${target.name} personality initialized for test run.`);
  }

  app.post('/contact-magi', async (req, res) => {
    try {
      const { testName, magi, userMessage } = req.body.data || req.body;
      
      testHooks.beginRun({ testName, magi });

      const routedMessage = magi && userMessage ? `${magi}: ${userMessage}` : userMessage;

      if (magi) {
        try {
          await initializeMagiForTest(magi);
        } catch (initError) {
          logger.warn('[HTTP] Failed to pre-initialize Magi for test run', initError);
        }
      }

      const response = await routeMessage(routedMessage);
      
      try { testHooks.recordToolCall('respond-to-user', { response }); } catch (e) { logger.debug(`[HTTP] Failed to record final respond-to-user: ${e instanceof Error ? e.message : String(e)}`); }
      const meta = testHooks.endRunAndSummarize(response);
      logger.info('[HTTP] Magi contact completed successfully');
      
      const payload: any = { type: 'deliberation-complete', data: { response } };
      if (meta) payload.data.testMeta = meta;
      
      res.status(200).json(payload);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[HTTP] Magi contact failed: ${errorMessage}`);
      res.status(500).json({
        type: 'deliberation-error',
        data: { error: errorMessage }
      });
    }
  });

  createWebSocketServer(server, async (userMessage) => routeMessage(userMessage));

  server.on('error', (err: { code?: string }) => {
    if (err.code === 'EADDRINUSE') {
      logger.info(`Previous Orchestrator instance already listening on port ${PORT}`);
    } else {
      console.error(`Server error: ${JSON.stringify(err)}`);
    }
  });

  const PORT = process.env.PORT ?? 8080;
  const HOST = process.env.HOST ?? '127.0.0.1';
  server.listen(Number(PORT), HOST, () => {
    // Preserve original log phrase for integration readiness detectors
    logger.info(`Orchestrator listening on port ${PORT}`);
    // Also log explicit host binding for debugging clarity
    logger.info(`Orchestrator listening on ${HOST}:${PORT}`);
    console.log('🔌🔌🔌 SERVER.LISTEN() CALLBACK EXECUTED! 🔌🔌🔌');
  });
  
  server.on('listening', () => {
    console.log('👂👂👂 SERVER LISTENING EVENT FIRED! 👂👂👂');
    const address = server.address();
    console.log(`[DEBUG] Server address:`, address);
  });
  
  server.on('error', (error) => {
    console.log('💥💥💥 SERVER ERROR! 💥💥💥', error);
    logger.error('[SERVER] Error:', error);
  });
}
