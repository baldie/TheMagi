/// <reference types="ws" />

import { WebSocketServer, WebSocket } from 'ws';
import { logger } from './logger';
import { logStream } from './log-stream';

// Store connected clients for audio streaming
const connectedClients = new Set<WebSocket>();

export function createWebSocketServer(server: any, startCallback: (inquiry?: string) => void) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket) => {
    connectedClients.add(ws);
    logger.info('[WebSocket] Client connected. Attaching to log stream.');
    
    const logListener = (message: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'log', data: message }));
      }
    };

    logStream.subscribe(logListener);

    ws.on('message', (message: string) => {
      try {
        const parsedMessage = JSON.parse(message);
        if (parsedMessage.type === 'start-magi') {
          logger.info('[WebSocket] Received start-magi signal from client.');
          startCallback(parsedMessage.data?.inquiry);
        }
      } catch (error) {
        logger.error('[WebSocket] Failed to parse incoming message or unknown message type.', error);
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
 */
export function broadcastAudioToClients(audioData: Buffer, persona: string, isComplete: boolean = false) {
  const message = JSON.stringify({
    type: 'audio',
    data: {
      audio: audioData.toString('base64'),
      persona,
      isComplete
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

  if (connectedClients.size > 0) {
    logger.debug(`[WebSocket] Broadcasted audio chunk to ${connectedClients.size} clients`);
  }
} 