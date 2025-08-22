import { LocalIndex } from 'vectra';
import path from 'path';
import fs from 'fs/promises';
import { randomBytes } from 'crypto';
import { logger } from '../logger';
import type { 
  QueueMessage, 
  MessageCallback, 
  Subscription, 
  MessageQueueConfig, 
  QueueStats, 
  PublishOptions,
  MessageType
} from './types';
import type { MessageParticipant } from '../types/magi-types';

/**
 * Message Queue Service using Vectra for persistent storage
 * Uses artificial vectors (timestamp-based) for message ordering
 */
export class MessageQueueService {
  private readonly vectorIndex: LocalIndex;
  private readonly indexPath: string;
  private readonly config: Required<MessageQueueConfig>;
  private readonly subscriptions: Map<string, Subscription> = new Map();
  private cleanupTimer?: NodeJS.Timeout;
  private isInitialized = false;

  constructor(config: MessageQueueConfig = {}) {
    // Set up configuration with defaults
    this.config = {
      indexPath: config.indexPath ?? path.join(process.cwd(), '.magi-data', 'message-queue-index'),
      maxProcessedMessages: config.maxProcessedMessages ?? 1000,
      cleanupInterval: config.cleanupInterval ?? 5 * 60 * 1000, // 5 minutes
      defaultExpirationMs: config.defaultExpirationMs ?? 24 * 60 * 60 * 1000, // 24 hours
    };

    this.indexPath = this.config.indexPath;
    this.vectorIndex = new LocalIndex(this.indexPath);
  }

  /**
   * Initialize the message queue
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Ensure the data directory exists
      await fs.mkdir(path.dirname(this.indexPath), { recursive: true });

      if (!(await this.vectorIndex.isIndexCreated())) {
        await this.vectorIndex.createIndex({
          version: 1,
          deleteIfExists: false,
          metadata_config: {
            indexed: ['sender', 'recipient', 'type', 'processed', 'timestamp', 'priority'] // Index for filtering
          }
        });
        logger.info('Message queue index created');
      }

      // Start cleanup timer
      this.startCleanupTimer();
      this.isInitialized = true;
      
      logger.info(`Message queue service initialized at ${this.indexPath}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to initialize message queue: ${errorMessage}`);
      throw new Error(`Failed to initialize message queue: ${errorMessage}`);
    }
  }

  /**
   * Publish a message to the queue
   */
  async publish(
    sender: MessageParticipant,
    recipient: MessageParticipant,
    content: any,
    type: MessageType,
    options: PublishOptions = {}
  ): Promise<string> {
    await this.ensureInitialized();

    const messageId = `msg_${Date.now()}_${randomBytes(6).toString('hex')}`;
    const timestamp = new Date().toISOString();
    const expiresAt = options.expirationMs 
      ? new Date(Date.now() + options.expirationMs).toISOString()
      : new Date(Date.now() + this.config.defaultExpirationMs).toISOString();

    const message: QueueMessage = {
      id: messageId,
      sender,
      recipient,
      content: JSON.stringify(content),
      type,
      timestamp,
      processed: false,
      correlationId: options.correlationId ?? '',
      priority: options.priority ?? 0,
      expiresAt,
    };

    // Create a vector from timestamp for chronological ordering
    // Convert timestamp to a simple vector representation
    const timestampMs = new Date(timestamp).getTime();
    const vector = this.createTimestampVector(timestampMs, message.priority ?? 0);

    try {
      await this.vectorIndex.insertItem({
        id: messageId,
        vector,
        metadata: message
      });

      logger.debug(`Message published: ${messageId} from ${sender} to ${recipient}`);

      // Notify subscribers immediately
      await this.notifySubscribers(message);

      return messageId;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to publish message: ${errorMessage}`);
      throw new Error(`Failed to publish message: ${errorMessage}`);
    }
  }

  /**
   * Subscribe to messages for a specific recipient
   */
  subscribe(participant: MessageParticipant, callback: MessageCallback): Subscription {
    const subscriptionId = `sub_${Date.now()}_${randomBytes(4).toString('hex')}`;
    
    const subscription: Subscription = {
      id: subscriptionId,
      participant,
      callback,
      unsubscribe: () => {
        this.subscriptions.delete(subscriptionId);
        logger.debug(`Subscription removed: ${subscriptionId} for ${participant}`);
      }
    };

    this.subscriptions.set(subscriptionId, subscription);
    logger.debug(`New subscription: ${subscriptionId} for ${participant}`);

    return subscription;
  }

  /**
   * Get pending messages for a specific recipient
   */
  async getPendingMessages(recipient: MessageParticipant): Promise<QueueMessage[]> {
    await this.ensureInitialized();

    try {
      const allItems = await this.vectorIndex.listItems();
      
      // First, load all messages fully (handling metadata files)
      const allMessagesPromises = allItems.map(async item => {
        const metadata = item.metadata as any;
        
        let message: QueueMessage;
        
        if (item.metadataFile && typeof item.metadataFile === 'string') {
          // Metadata is stored in a separate file
          try {
            const metadataFilePath = path.join(this.indexPath, item.metadataFile);
            const metadataFileContent = await fs.readFile(metadataFilePath, 'utf-8');
            const parsedMetadata = JSON.parse(metadataFileContent);
            message = parsedMetadata as QueueMessage;
          } catch (error) {
            logger.error(`Error reading metadata file ${item.metadataFile}:`, error);
            // Fallback to inline metadata
            message = metadata as QueueMessage;
          }
        } else {
          // Metadata is stored inline
          message = metadata as QueueMessage;
        }
        
        // Ensure the message has an ID
        if (!message.id) {
          message.id = item.id;
        }
        
        return message;
      });

      const allMessages = await Promise.all(allMessagesPromises);
      
      // Now filter with the complete message data
      const pendingMessages = allMessages
        .filter(message => {
          return message.recipient === recipient && 
                 !message.processed && 
                 !this.isExpired(message);
        });
      
      // Sort by priority (higher first), then by timestamp (older first)
      return pendingMessages.sort((a, b) => {
        const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
        if (priorityDiff !== 0) return priorityDiff;
        
        return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to get pending messages: ${errorMessage}`);
      throw new Error(`Failed to get pending messages: ${errorMessage}`);
    }
  }

  /**
   * Acknowledge that a message has been processed
   */
  async acknowledge(messageId: string): Promise<void> {
    await this.ensureInitialized();

    try {
      const allItems = await this.vectorIndex.listItems();
      const messageItem = allItems.find(item => item.id === messageId);

      if (!messageItem) {
        logger.warn(`Message not found for acknowledgment: ${messageId}`);
        return;
      }

      // Load the current message metadata
      let currentMessage: QueueMessage;
      
      if (messageItem.metadataFile && typeof messageItem.metadataFile === 'string') {
        try {
          const metadataFilePath = path.join(this.indexPath, messageItem.metadataFile);
          const metadataFileContent = await fs.readFile(metadataFilePath, 'utf-8');
          currentMessage = JSON.parse(metadataFileContent) as QueueMessage;
        } catch (error) {
          // Fallback to inline metadata if file reading fails
          logger.warn(`Failed to read metadata file ${messageItem.metadataFile}, using inline metadata:`, error);
          currentMessage = messageItem.metadata as QueueMessage;
        }
      } else {
        currentMessage = messageItem.metadata as QueueMessage;
      }

      const updatedMessage = {
        ...currentMessage,
        processed: true
      } as QueueMessage;

      // Update the item with processed = true by deleting and re-inserting
      await this.vectorIndex.deleteItem(messageId);
      await this.vectorIndex.insertItem({
        id: messageId,
        vector: messageItem.vector,
        metadata: updatedMessage
      });

      logger.debug(`Message acknowledged: ${messageId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to acknowledge message: ${errorMessage}`);
      throw new Error(`Failed to acknowledge message: ${errorMessage}`);
    }
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<QueueStats> {
    await this.ensureInitialized();

    try {
      const allItems = await this.vectorIndex.listItems();
      
      // Load all messages, handling potential metadata files
      const messagesPromises = allItems.map(async item => {
        const metadata = item.metadata as any;
        
        let message: QueueMessage;
        
        if (item.metadataFile && typeof item.metadataFile === 'string') {
          try {
            const metadataFilePath = path.join(this.indexPath, item.metadataFile);
            const metadataFileContent = await fs.readFile(metadataFilePath, 'utf-8');
            const parsedMetadata = JSON.parse(metadataFileContent);
            message = parsedMetadata as QueueMessage;
          } catch (error) {
            // Fallback to inline metadata if file reading fails
            logger.warn(`Failed to read metadata file ${item.metadataFile}, using inline metadata:`, error);
            message = metadata as QueueMessage;
          }
        } else {
          message = metadata as QueueMessage;
        }
        
        if (!message.id) {
          message.id = item.id;
        }
        
        return message;
      });
      
      const messages = await Promise.all(messagesPromises);

      const stats: QueueStats = {
        totalMessages: messages.length,
        pendingMessages: messages.filter(m => !m.processed && !this.isExpired(m)).length,
        processedMessages: messages.filter(m => m.processed).length,
        activeSubscriptions: this.subscriptions.size,
        messagesByParticipant: {} as Record<MessageParticipant, number>
      };

      // Count messages by participant
      for (const message of messages) {
        if (!this.isExpired(message)) {
          stats.messagesByParticipant[message.recipient] = 
            (stats.messagesByParticipant[message.recipient] ?? 0) + 1;
        }
      }

      return stats;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to get queue stats: ${errorMessage}`);
      throw new Error(`Failed to get queue stats: ${errorMessage}`);
    }
  }

  /**
   * Clean up old processed messages and expired messages
   */
  async cleanup(): Promise<void> {
    await this.ensureInitialized();

    try {
      const allItems = await this.vectorIndex.listItems();
      const messages = allItems.map(item => ({ ...item, metadata: item.metadata as QueueMessage }));

      // Find messages to remove
      const processedMessages = messages.filter(m => m.metadata.processed);
      const expiredMessages = messages.filter(m => this.isExpired(m.metadata));
      
      // Keep only the most recent processed messages
      const sortedProcessed = [...processedMessages].sort((a, b) => 
        new Date(b.metadata.timestamp).getTime() - new Date(a.metadata.timestamp).getTime()
      );
      
      const messagesToRemove = [
        ...sortedProcessed.slice(this.config.maxProcessedMessages),
        ...expiredMessages
      ];

      // Remove old/expired messages
      for (const message of messagesToRemove) {
        await this.vectorIndex.deleteItem(message.id);
      }

      if (messagesToRemove.length > 0) {
        logger.debug(`Cleaned up ${messagesToRemove.length} old/expired messages`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to cleanup messages: ${errorMessage}`);
    }
  }

  /**
   * Shutdown the message queue service
   */
  async shutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    // Clear all subscriptions
    this.subscriptions.clear();
    
    logger.info('Message queue service shutdown');
  }

  // Private helper methods

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  private createTimestampVector(timestampMs: number, priority: number): number[] {
    // Create a simple vector from timestamp and priority
    // This gives us chronological ordering with priority weighting
    const normalizedTimestamp = timestampMs / 1000000000; // Normalize to smaller number
    const priorityWeight = priority * 1000; // Priority has more weight
    
    return [normalizedTimestamp + priorityWeight, normalizedTimestamp, priority];
  }

  private isExpired(message: QueueMessage): boolean {
    if (!message.expiresAt || message.expiresAt === '') return false;
    return new Date(message.expiresAt).getTime() < Date.now();
  }

  private async notifySubscribers(message: QueueMessage): Promise<void> {
    const relevantSubscriptions = Array.from(this.subscriptions.values())
      .filter(sub => sub.participant === message.recipient);

    for (const subscription of relevantSubscriptions) {
      try {
        await subscription.callback(message);
      } catch (error) {
        logger.error(`Subscription callback failed for ${subscription.id}:`, error);
      }
    }
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(async () => {
      await this.cleanup();
    }, this.config.cleanupInterval);
  }
}