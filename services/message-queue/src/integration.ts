import { getMessageQueue, shutdownMessageQueue } from './index';
import { MessageType } from './types';
import { MessageParticipant } from './types/magi-types';
import { logger } from './logger';

/**
 * Integration helpers for the message queue service
 */

/**
 * Quick publish functions for common message patterns
 */
export const messageQueue = {
  /**
   * Send a response from a Magi to the UI
   */
  async sendResponse(sender: MessageParticipant, response: string, correlationId?: string): Promise<string> {
    const queue = getMessageQueue();
    return await queue.publish(
      sender,
      MessageParticipant.User,
      { response },
      MessageType.RESPONSE,
      { correlationId }
    );
  },

  /**
   * Send a request from one Magi to another
   */
  async sendRequest(sender: MessageParticipant, recipient: MessageParticipant, request: any, correlationId?: string): Promise<string> {
    const queue = getMessageQueue();
    return await queue.publish(
      sender,
      recipient,
      request,
      MessageType.REQUEST,
      { correlationId }
    );
  },

  /**
   * Send a notification to the UI
   */
  async sendNotification(sender: MessageParticipant, notification: any): Promise<string> {
    const queue = getMessageQueue();
    return await queue.publish(
      sender,
      MessageParticipant.User,
      notification,
      MessageType.NOTIFICATION
    );
  },

  /**
   * Send an event that multiple participants might be interested in
   */
  async broadcastEvent(sender: MessageParticipant, recipients: MessageParticipant[], event: any): Promise<string[]> {
    const queue = getMessageQueue();
    const messageIds: string[] = [];
    
    for (const recipient of recipients) {
      const id = await queue.publish(
        sender,
        recipient,
        event,
        MessageType.EVENT
      );
      messageIds.push(id);
    }
    
    return messageIds;
  },

  /**
   * Subscribe to messages for a participant with automatic acknowledgment
   */
  subscribeWithAck(participant: MessageParticipant, handler: (content: any, message: any) => Promise<void> | void) {
    const queue = getMessageQueue();
    
    return queue.subscribe(participant, async (message) => {
      try {
        const content = JSON.parse(message.content);
        await handler(content, message);
        
        // Automatically acknowledge successful processing
        await queue.acknowledge(message.id);
        
        logger.debug(`Message processed and acknowledged: ${message.id}`);
      } catch (error) {
        logger.error(`Failed to process message ${message.id}:`, error);
        // Don't acknowledge failed messages - they'll remain in queue
      }
    });
  },

  /**
   * Get the queue instance for advanced usage
   */
  getQueue() {
    return getMessageQueue();
  }
};

/**
 * Initialize message queue during orchestrator startup
 */
export async function initializeMessageQueueForOrchestrator(): Promise<void> {
  try {
    const queue = getMessageQueue();
    await queue.initialize();
    logger.info('Message queue initialized for orchestrator');
  } catch (error) {
    logger.error('Failed to initialize message queue:', error);
    throw error;
  }
}

/**
 * Shutdown message queue during orchestrator shutdown
 */
export async function shutdownMessageQueueForOrchestrator(): Promise<void> {
  try {
    await shutdownMessageQueue();
    logger.info('Message queue shutdown for orchestrator');
  } catch (error) {
    logger.error('Failed to shutdown message queue:', error);
  }
}

/**
 * Health check for the message queue
 */
export async function checkMessageQueueHealth(): Promise<{ healthy: boolean; stats?: any; error?: string }> {
  try {
    const queue = getMessageQueue();
    const stats = await queue.getStats();
    
    return {
      healthy: true,
      stats
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      healthy: false,
      error: errorMessage
    };
  }
}