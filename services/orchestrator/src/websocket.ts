import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { logger } from './logger';
import { logStream } from './log-stream';

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
        const message = rawMessage.toString();
        const parsedMessage = JSON.parse(message);
        if (parsedMessage.type === 'start-magi') {
          logger.info(`[WebSocket] Received start-magi signal from client. ${message}`);
          try {
            const response = await startCallback(parsedMessage.data?.userMessage);
            logger.info('[WebSocket] Deliberation completed successfully');
            
            // Send the final response back to the client
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ 
                type: 'deliberation-complete', 
                data: { response } 
              }));
            }
          } catch (error) {
            logger.error('[WebSocket] Deliberation failed:', error);
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