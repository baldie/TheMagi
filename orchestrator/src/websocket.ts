/// <reference types="ws" />

import { WebSocketServer, WebSocket } from 'ws';
import { logger } from './logger';
import { logStream } from './log-stream';

export function createWebSocketServer(server: any) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket) => {
    logger.info('[WebSocket] Client connected. Attaching to log stream.');
    
    const logListener = (message: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'log', data: message }));
      }
    };

    logStream.subscribe(logListener);

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