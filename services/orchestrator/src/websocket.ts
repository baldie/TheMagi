import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { logger } from './logger';
import { testHooks } from './testing/test-hooks';

console.log('[DEBUG] websocket.ts file loaded at:', new Date().toISOString());
import { logStream } from './log-stream';

// Store connected clients for audio streaming
const connectedClients = new Set<WebSocket>();

export function createWebSocketServer(server: Server, startCallback: (userMessage?: string) => Promise<string>) {
  console.log('[DEBUG] createWebSocketServer called at:', new Date().toISOString());
  console.log('[DEBUG] HTTP server object:', !!server);
  console.log('[DEBUG] Starting callback:', !!startCallback);
  
  const wss = new WebSocketServer({ server });
  console.log('[DEBUG] WebSocketServer created successfully');

  wss.on('error', (error) => {
    console.log('❌❌❌ WEBSOCKET SERVER ERROR! ❌❌❌', error);
    logger.error('[WebSocket] Server error:', error);
  });

  wss.on('connection', (ws: WebSocket) => {
    console.log('🚀🚀🚀 WEBSOCKET CLIENT CONNECTED! 🚀🚀🚀');
    logger.info('[DEBUG] WebSocket client connected at: ' + new Date().toISOString());
    connectedClients.add(ws);
    logger.info('[WebSocket] Client connected. Attaching to log stream.');
    
    // Send immediate connection acknowledgment
    try {
      const initialAck = { type: 'ack', source: 'connection' };
      ws.send(JSON.stringify(initialAck));
      console.log('🎯🎯🎯 SENT INITIAL CONNECTION ACK! 🎯🎯🎯', initialAck);
      logger.info('[DEBUG] Sent initial connection ACK');
    } catch (error) {
      logger.error('[DEBUG] Failed to send initial ACK:', error);
    }
    
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

    // In test mode, emit a lightweight heartbeat so clients receive activity even if
    // regular logs are suppressed from the log stream.
    let heartbeatTimer: NodeJS.Timeout | null = null;

    ws.on('message', async (rawMessage: Buffer) => {
      console.log('🔥🔥🔥 WEBSOCKET MESSAGE HANDLER TRIGGERED! 🔥🔥🔥');
      
      try {
        const message = rawMessage.toString();
        logger.info(`[DEBUG] Message string: ${message}`);
        const parsedMessage = JSON.parse(message);
        logger.info(`[DEBUG] Parsed message type: ${parsedMessage.type}`);
        
        if (parsedMessage.type === 'start-magi') {
          
          // Send initial ACK
          const ackResponse = { type: 'ack', data: 'WORKING', source: 'message-handler' };
          ws.send(JSON.stringify(ackResponse));
          
          // Extract user message and call the routing callback
          const userMessage = parsedMessage.data?.userMessage || '';
          const testName: string | undefined = parsedMessage.data?.testName;
          const magi: string | undefined = parsedMessage.data?.magi;
          try {
            // Initialize test recorder when running integration tests over WS
            testHooks.beginRun({ testName, magi });
          } catch (err) {
            logger.debug('[WebSocket] testHooks.beginRun failed (non-fatal)', err);
          }
          logger.info(`[DEBUG] Calling startCallback with message: ${userMessage}`);
          console.log(`[WS] Invoking startCallback at ${new Date().toISOString()}`);

          // Start heartbeat only in test mode so integration tests consider the server live
          try {
            if (testHooks.isEnabled() && !heartbeatTimer) {
              heartbeatTimer = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                  try {
                    ws.send(JSON.stringify({ type: 'log', data: '[heartbeat] server is working' }));
                  } catch {}
                }
              }, 5000);
            }
          } catch {}
          
          try {
            const response = await startCallback(userMessage);
            logger.info(`[DEBUG] Got response from startCallback: ${response.length} chars`);
            console.log(`[WS] startCallback resolved at ${new Date().toISOString()} with length=${response.length}`);
            
            // Send the final response
            let testMeta: any = undefined;
            try {
              testMeta = testHooks.endRunAndSummarize(response);
            } catch (err) {
              logger.debug('[WebSocket] testHooks.endRunAndSummarize failed (non-fatal)', err);
            }
            const finalResponse = { type: 'deliberation-complete', data: { response, ...(testMeta ? { testMeta } : {}) } };
            ws.send(JSON.stringify(finalResponse));
            logger.info(`[DEBUG] Sent deliberation-complete response`);
            if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
          } catch (error) {
            logger.error(`[DEBUG] Error calling startCallback: ${String(error)}`);
            const errorResponse = { type: 'deliberation-error', data: { error: String(error) } };
            ws.send(JSON.stringify(errorResponse));
            if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
          }
        } else {
          logger.info(`[DEBUG] Unhandled message type: ${parsedMessage.type}`);
        }
      } catch (error) {
        logger.error(`[DEBUG] Message parsing error: ${String(error)}`);
        logger.error(`[DEBUG] Raw message was: ${rawMessage.toString()}`);
      }
    });

    ws.on('close', () => {
      logger.info('[WebSocket] Client disconnected. Detaching from log stream.');
      connectedClients.delete(ws);
      logStream.unsubscribe(logListener);
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    });

    ws.on('error', (error) => {
      logger.error(`[WebSocket] Client error: ${error.message}`);
      connectedClients.delete(ws);
      logStream.unsubscribe(logListener);
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
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