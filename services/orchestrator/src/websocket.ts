import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { logger } from './logger';
import { initializeMessageQueue, type Subscription } from './message-queue';
import { MessageParticipant } from './types/magi-types';
import { enqueueMessage } from './loading';

console.log('[DEBUG] websocket.ts file loaded at:', new Date().toISOString());
import { logStream } from './log-stream';

// Store connected clients for audio streaming
const connectedClients = new Set<WebSocket>();

export function createWebSocketServer(server: Server) {
  console.log('[DEBUG] createWebSocketServer called at:', new Date().toISOString());
  console.log('[DEBUG] HTTP server object:', !!server);
  
  const wss = new WebSocketServer({ server });
  console.log('[DEBUG] WebSocketServer created successfully');

  wss.on('error', (error) => {
    console.log('❌❌❌ WEBSOCKET SERVER ERROR! ❌❌❌', error);
    logger.error('[WebSocket] Server error:', error);
  });

  wss.on('connection', async (ws: WebSocket) => {
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
    
    // Subscribe to message queue for User participant
    let messageQueueSubscription: Subscription | null = null;
    try {
      const messageQueue = await initializeMessageQueue();
      messageQueueSubscription = messageQueue.subscribe(MessageParticipant.User, async (message) => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            const messagePayload = {
              type: 'deliberation-complete',
              data: {
                response: message.content,
                sender: message.sender,
                source: 'message-queue'
              }
            };
            ws.send(JSON.stringify(messagePayload));
            logger.debug(`[WebSocket] Sent message queue response to client from ${message.sender}`);
            
            // Acknowledge the message as processed
            await messageQueue.acknowledge(message.id);
          } catch (error) {
            logger.error('[WebSocket] Failed to send message queue response to client', error);
          }
        } else {
          logger.warn('[WebSocket] Client not open - cannot send message queue response');
        }
      });
      logger.info('[WebSocket] Client subscribed to User message queue');
    } catch (error) {
      logger.error('[WebSocket] Failed to set up message queue subscription for client', error);
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

    // Handle incoming messages from clients
    ws.on('message', async (data: Buffer) => {
      try {
        const messageStr = data.toString();
        const messageObj = JSON.parse(messageStr);
        
        if (messageObj.type === 'contact-magi') {
          const { message } = messageObj.data || messageObj;

          let recipient: MessageParticipant = MessageParticipant.Magi;
          if (message.trim().toLowerCase().startsWith('b:')) {
            recipient = MessageParticipant.Balthazar;
          } else if (message.trim().toLowerCase().startsWith('m:')) {
            recipient = MessageParticipant.Melchior;
          } else if (message.trim().toLowerCase().startsWith('c:')) {
            recipient = MessageParticipant.Caspar;
          }

          await enqueueMessage(MessageParticipant.User, recipient, message);
          
          const payload = {
            type: 'ack',
            data: 'WORKING',
            source: 'websocket-handler'
          };
          
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(payload));
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`[WebSocket] Message handling failed: ${errorMessage}`);
        
        if (ws.readyState === WebSocket.OPEN) {
          const errorPayload = {
            type: 'deliberation-error',
            data: { error: errorMessage }
          };
          ws.send(JSON.stringify(errorPayload));
        }
      }
    });

    // In test mode, emit a lightweight heartbeat so clients receive activity even if
    // regular logs are suppressed from the log stream.
    let heartbeatTimer: NodeJS.Timeout | null = null;


    ws.on('close', () => {
      logger.info('[WebSocket] Client disconnected. Detaching from log stream.');
      connectedClients.delete(ws);
      logStream.unsubscribe(logListener);
      if (messageQueueSubscription) {
        messageQueueSubscription.unsubscribe();
        logger.info('[WebSocket] Client unsubscribed from User message queue');
      }
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    });

    ws.on('error', (error) => {
      logger.error(`[WebSocket] Client error: ${error.message}`);
      connectedClients.delete(ws);
      logStream.unsubscribe(logListener);
      if (messageQueueSubscription) {
        messageQueueSubscription.unsubscribe();
        logger.info('[WebSocket] Client unsubscribed from User message queue');
      }
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