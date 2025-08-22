import { MessageQueueService } from './MessageQueueService';
import { MessageType } from './types';
import { MessageParticipant } from '../types/magi-types';
import path from 'path';
import fs from 'fs/promises';

describe('MessageQueueService', () => {
  let messageQueue: MessageQueueService;
  let testIndexPath: string;

  beforeEach(async () => {
    // Use a test-specific directory
    testIndexPath = path.join(__dirname, '..', '..', '..', '.test-data', 'message-queue-test');
    
    messageQueue = new MessageQueueService({
      indexPath: testIndexPath,
      maxProcessedMessages: 10,
      cleanupInterval: 1000,
      defaultExpirationMs: 60000
    });

    await messageQueue.initialize();
  });

  afterEach(async () => {
    await messageQueue.shutdown();
    
    // Clean up test data
    try {
      await fs.rm(path.dirname(testIndexPath), { recursive: true });
    } catch (error) {
      // Ignore cleanup errors in tests - not critical if test data cleanup fails
      console.warn('Test cleanup failed, continuing...', error);
    }
  });

  describe('Basic Operations', () => {
    test('should publish and retrieve messages', async () => {
      const messageId = await messageQueue.publish(
        MessageParticipant.Caspar,
        MessageParticipant.User,
        { text: 'Hello World' },
        MessageType.RESPONSE
      );

      expect(messageId).toBeDefined();
      expect(messageId).toMatch(/^msg_\d+_[a-f0-9]+$/);

      const pendingMessages = await messageQueue.getPendingMessages(MessageParticipant.User);
      expect(pendingMessages).toHaveLength(1);
      expect(pendingMessages[0].id).toBe(messageId);
      expect(pendingMessages[0].sender).toBe(MessageParticipant.Caspar);
      expect(pendingMessages[0].recipient).toBe(MessageParticipant.User);
      expect(JSON.parse(pendingMessages[0].content)).toEqual({ text: 'Hello World' });
    });

    test('should acknowledge messages', async () => {
      const messageId = await messageQueue.publish(
        MessageParticipant.Melchior,
        MessageParticipant.Balthazar,
        { request: 'analyze this' },
        MessageType.REQUEST
      );

      let pendingMessages = await messageQueue.getPendingMessages(MessageParticipant.Balthazar);
      expect(pendingMessages).toHaveLength(1);
      expect(pendingMessages[0].processed).toBe(false);

      await messageQueue.acknowledge(messageId);

      pendingMessages = await messageQueue.getPendingMessages(MessageParticipant.Balthazar);
      expect(pendingMessages).toHaveLength(0);
    });

    test('should handle message priority correctly', async () => {
      // Publish messages with different priorities
      await messageQueue.publish(
        MessageParticipant.System,
        MessageParticipant.Caspar,
        { priority: 'low' },
        MessageType.COMMAND,
        { priority: 1 }
      );

      await messageQueue.publish(
        MessageParticipant.System,
        MessageParticipant.Caspar,
        { priority: 'high' },
        MessageType.COMMAND,
        { priority: 10 }
      );

      await messageQueue.publish(
        MessageParticipant.System,
        MessageParticipant.Caspar,
        { priority: 'medium' },
        MessageType.COMMAND,
        { priority: 5 }
      );

      const pendingMessages = await messageQueue.getPendingMessages(MessageParticipant.Caspar);
      expect(pendingMessages).toHaveLength(3);
      
      // Should be ordered by priority: high (10), medium (5), low (1)
      expect(JSON.parse(pendingMessages[0].content).priority).toBe('high');
      expect(JSON.parse(pendingMessages[1].content).priority).toBe('medium');
      expect(JSON.parse(pendingMessages[2].content).priority).toBe('low');
    });
  });

  describe('Subscriptions', () => {
    test('should notify subscribers when messages are published', async () => {
      const receivedMessages: any[] = [];
      
      const subscription = messageQueue.subscribe(MessageParticipant.User, async (message) => {
        receivedMessages.push(message);
      });

      await messageQueue.publish(
        MessageParticipant.Caspar,
        MessageParticipant.User,
        { notification: 'test' },
        MessageType.NOTIFICATION
      );

      // Give a moment for async notification
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].sender).toBe(MessageParticipant.Caspar);
      expect(JSON.parse(receivedMessages[0].content)).toEqual({ notification: 'test' });

      subscription.unsubscribe();
    });

    test('should handle multiple subscribers', async () => {
      const receivedMessages1: any[] = [];
      const receivedMessages2: any[] = [];
      
      const sub1 = messageQueue.subscribe(MessageParticipant.Melchior, async (message) => {
        receivedMessages1.push(message);
      });

      const sub2 = messageQueue.subscribe(MessageParticipant.Melchior, async (message) => {
        receivedMessages2.push(message);
      });

      await messageQueue.publish(
        MessageParticipant.System,
        MessageParticipant.Melchior,
        { command: 'process' },
        MessageType.COMMAND
      );

      // Give a moment for async notifications
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(receivedMessages1).toHaveLength(1);
      expect(receivedMessages2).toHaveLength(1);

      sub1.unsubscribe();
      sub2.unsubscribe();
    });
  });

  describe('Statistics and Management', () => {
    test('should provide accurate statistics', async () => {
      await messageQueue.publish(
        MessageParticipant.Caspar,
        MessageParticipant.User,
        { msg: '1' },
        MessageType.RESPONSE
      );

      const messageId2 = await messageQueue.publish(
        MessageParticipant.Melchior,
        MessageParticipant.User,
        { msg: '2' },
        MessageType.RESPONSE
      );

      await messageQueue.acknowledge(messageId2);

      const stats = await messageQueue.getStats();
      
      expect(stats.totalMessages).toBe(2);
      expect(stats.pendingMessages).toBe(1);
      expect(stats.processedMessages).toBe(1);
      expect(stats.messagesByParticipant[MessageParticipant.User]).toBe(2);
    });

    test('should handle message expiration', async () => {
      // Publish a message that expires quickly
      await messageQueue.publish(
        MessageParticipant.Caspar,
        MessageParticipant.User,
        { msg: 'expires soon' },
        MessageType.NOTIFICATION,
        { expirationMs: 50 } // 50ms expiration
      );

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 100));

      const pendingMessages = await messageQueue.getPendingMessages(MessageParticipant.User);
      expect(pendingMessages).toHaveLength(0);
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid message IDs gracefully', async () => {
      await expect(messageQueue.acknowledge('invalid-id')).resolves.not.toThrow();
    });

    test('should handle subscription errors gracefully', async () => {
      const subscription = messageQueue.subscribe(MessageParticipant.User, async () => {
        throw new Error('Callback error');
      });

      // This should not throw even if the callback throws
      await expect(messageQueue.publish(
        MessageParticipant.Caspar,
        MessageParticipant.User,
        { test: 'data' },
        MessageType.NOTIFICATION
      )).resolves.toBeDefined();

      subscription.unsubscribe();
    });
  });
});