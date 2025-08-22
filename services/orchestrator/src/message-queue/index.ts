// Re-export all types and enums
export * from './types';

// Export the main service
export { MessageQueueService } from './MessageQueueService';

// Singleton instance for easy access throughout the application
import { MessageQueueService } from './MessageQueueService';

let messageQueueInstance: MessageQueueService | null = null;

/**
 * Get the singleton message queue instance
 * Creates a new instance if one doesn't exist
 */
export function getMessageQueue(): MessageQueueService {
  if (!messageQueueInstance) {
    messageQueueInstance = new MessageQueueService();
  }
  return messageQueueInstance;
}

/**
 * Initialize the message queue singleton with custom configuration
 * Should be called once during application startup
 */
export async function initializeMessageQueue(config?: ConstructorParameters<typeof MessageQueueService>[0]): Promise<MessageQueueService> {
  if (!messageQueueInstance) {
    messageQueueInstance = new MessageQueueService(config);
    await messageQueueInstance.initialize();
  }
  return messageQueueInstance;
}

/**
 * Shutdown the message queue singleton
 * Should be called during application shutdown
 */
export async function shutdownMessageQueue(): Promise<void> {
  if (messageQueueInstance) {
    await messageQueueInstance.shutdown();
    messageQueueInstance = null;
  }
}