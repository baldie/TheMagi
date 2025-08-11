import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { logger } from './logger';
import { logStream } from './log-stream';
import { testHooks } from './testing/test-hooks';
import fs from 'fs/promises';
import { balthazar, caspar, melchior, PERSONAS_CONFIG, MagiName } from './magi/magi2';

// Store connected clients for audio streaming
const connectedClients = new Set<WebSocket>();

export function createWebSocketServer(server: Server, startCallback: (userMessage?: string) => Promise<string>) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket) => {
    connectedClients.add(ws);
    logger.info('[WebSocket] Client connected. Attaching to log stream.');
    
    const logListener = (message: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'log', data: message }));
        } catch (error) {
          logger.error('[WebSocket] Failed to send log message', error);
          connectedClients.delete(ws);
          logStream.unsubscribe(logListener);
        }
      }
    };

    logStream.subscribe(logListener);

    ws.on('message', async (rawMessage: Buffer) => {
      try {
        logger.info(`[WebSocket] Raw message received (${rawMessage?.length ?? 0} bytes)`);
      } catch {}
      try {
        const message = rawMessage.toString();
        const parsedMessage = JSON.parse(message);
        if (parsedMessage.type === 'start-magi') {
          try {
            if (testHooks.isEnabled() && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ack', data: 'start-magi' }));
              logger.info('[WebSocket] Sent ack for start-magi');
            }
          } catch {}
          logger.info(`[WebSocket] Received start-magi signal from client. ${message}`);
          try {
            // Test integration support: set active spec and route to a specific Magi if provided
            const testName: string | undefined = parsedMessage.data?.testName;
            const magi: string | undefined = parsedMessage.data?.magi; // e.g., "Balthazar"
            const userMessage: string | undefined = parsedMessage.data?.userMessage;

            // Initialize a new test run via test hooks
            testHooks.beginRun({ testName, magi });

            // If a magi is specified, prefix the message to force single-magi routing
            const routedMessage = magi && userMessage
              ? `${magi}: ${userMessage}`
              : userMessage;

            // In integration tests, ensure the targeted Magi is initialized like loadMagi does
            try {
              if (magi) {
                const targetName = magi as MagiName;
                const target = targetName === MagiName.Balthazar ? balthazar
                  : targetName === MagiName.Melchior ? melchior
                  : targetName === MagiName.Caspar ? caspar
                  : null;
                if (target) {
                  const src = PERSONAS_CONFIG[target.name].personalitySource;
                  const prompt = await fs.readFile(src, 'utf-8');
                  await target.initialize(prompt);
                  logger.info(`[WebSocket] ${target.name} personality initialized for test run.`);
                }
              }
            } catch (initError) {
              logger.warn('[WebSocket] Failed to pre-initialize Magi for test run', initError);
            }

            const response = await startCallback(routedMessage);
            // Record final delivery as an implicit answer-user for testing observability
            try { testHooks.recordToolCall('answer-user', { answer: response }); } catch (e) { logger.debug(`[WebSocket] Failed to record final answer-user: ${e instanceof Error ? e.message : String(e)}`); }
            const meta = testHooks.endRunAndSummarize(response);
            logger.info('[WebSocket] Magi contact completed successfully');
            
            // Send the final response back to the client
            if (ws.readyState === WebSocket.OPEN) {
              const payload: any = { type: 'deliberation-complete', data: { response } };
              if (meta) {
                payload.data.testMeta = meta;
              }
              ws.send(JSON.stringify(payload));
            }
          } catch (error) {
            logger.error(`[WebSocket] Magi contact failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ 
                type: 'deliberation-error', 
                data: { error: error instanceof Error ? error.message : 'Unknown error' } 
              }));
            }
          }
        } else {
          logger.warn('[WebSocket] Received unknown message type:', parsedMessage.type);
        }
      } catch (error) {
        logger.error('[WebSocket] Failed to parse incoming message.', error);
      }
    });

    ws.on('close', () => {
      logger.info('[WebSocket] Client disconnected. Detaching from log stream.');
      connectedClients.delete(ws);
      logStream.unsubscribe(logListener);
    });

    ws.on('error', (error) => {
      logger.error(`[WebSocket] Client error: ${error.message}`);
      connectedClients.delete(ws);
      logStream.unsubscribe(logListener);
    });
  });

  logger.info('[WebSocket] Server is running and ready for connections.');
}

/**
 * Broadcasts audio data to all connected WebSocket clients
 * @param audioData - The audio data as a Buffer
 * @param persona - The Magi persona speaking
 * @param isComplete - Whether this is the final chunk of audio
 * @param sequenceNumber - The sequence number for proper ordering
 */
export function broadcastAudioToClients(audioData: Buffer, persona: string, isComplete: boolean = false, sequenceNumber: number = 0) {
  const message = JSON.stringify({
    type: 'audio',
    data: {
      audio: audioData.toString('base64'),
      persona,
      isComplete,
      sequenceNumber
    }
  });

  connectedClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (error) {
        logger.error('[WebSocket] Failed to send audio data to client', error);
        connectedClients.delete(client);
      }
    } else {
      connectedClients.delete(client);
    }
  });

  // Audio chunks are broadcasted frequently - no need to log each one
} 