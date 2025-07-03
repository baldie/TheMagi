/// <reference types="ws" />

import { WebSocketServer, WebSocket } from 'ws';
import { logger } from './logger';
import { logStream } from './log-stream';

export function createWebSocketServer(server: any, startCallback: (inquiry?: string) => void) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket) => {
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
      logStream.unsubscribe(logListener);
    });

    ws.on('error', (error) => {
      logger.error(`[WebSocket] Client error: ${error.message}`);
      logStream.unsubscribe(logListener);
    });
  });

  logger.info('[WebSocket] Server is running and ready for connections.');
} 