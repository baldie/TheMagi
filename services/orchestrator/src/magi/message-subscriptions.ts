import { WebSocket } from 'ws';
import { logger } from '../logger';
import { initializeMessageQueue, type Subscription, MessageType } from '../../../message-queue/src';
import { MessageParticipant } from '../types/magi-types';
import { allMagi, type Magi2, MagiName } from './magi2';
import { beginDeliberation } from '../ready';
import { speakWithMagiVoice } from '../tts';

/**
 * Manages all message queue subscriptions for the orchestrator
 */
export class MessageSubscriptionManager {
  private magiSubscriptions: Map<MagiName, Subscription[]> = new Map();
  private userSubscriptions: Set<Subscription> = new Set();

  /**
   * Initialize all message queue subscriptions
   */
  async initialize(): Promise<void> {
    logger.info('--- Setting up Message Queue Subscriptions ---');
    
    try {
      await this.setupMagiSubscriptions();
      logger.info('--- Message Queue Subscriptions Complete ---');
    } catch (error) {
      logger.error('Failed to setup message queue subscriptions', error);
      throw error;
    }
  }

  /**
   * Setup subscriptions for Magi-to-Magi and general Magi communication
   */
  private async setupMagiSubscriptions(): Promise<void> {
    const messageQueue = await initializeMessageQueue();
    
    // Set up subscriptions for each individual Magi
    const caspar = allMagi[MagiName.Caspar];
    const melchior = allMagi[MagiName.Melchior];
    const balthazar = allMagi[MagiName.Balthazar];
    
    if (!caspar || !melchior || !balthazar) {
      throw new Error('One or more Magi instances are not properly initialized.');
    }
    const subscriptionPromises = [caspar, melchior, balthazar].map(async (magi: Magi2) => {
      const subscriptions: Subscription[] = [];
      
      // Subscribe to messages addressed to this specific Magi
      const personalSubscription = messageQueue.subscribe(magi.name, async (message) => {
        logger.debug(`${magi.name} received message from ${message.sender}: ${message.content}`);
        
        // Use contactAsAgent which handles the full agent flow
        // The agent will use communicate tool to respond if needed
        await magi.contactAsAgent(message.content, message.sender);
        
        // Acknowledge the message as processed
        await messageQueue.acknowledge(message.id);
      });
      subscriptions.push(personalSubscription);
      logger.info(`... ${magi.name} subscribed to personal messages.`);
      
      // Store subscriptions for potential cleanup
      this.magiSubscriptions.set(magi.name, subscriptions);
    });

    // Listen for general "Magi" messages (triggers deliberation)
    const generalSubscription = messageQueue.subscribe(MessageParticipant.Magi, async (message) => {
      logger.debug(`General Magi message from ${message.sender}: ${message.content}`);
      
      try {
        // Deliberate on the message
        const response = await beginDeliberation(message.content);

        // Push the message back to the queue for the user
        await messageQueue.publish(
          MessageParticipant.Caspar, // Deliberations are delivered by Caspar
          MessageParticipant.User,
          response,
          MessageType.RESPONSE,
        );
        
        // Acknowledge the message as processed
        await messageQueue.acknowledge(message.id);
      } catch (error) {
        logger.error('Failed to process general Magi message', error);
      }
    });
    
    // Store general subscription with Caspar (arbitrary choice)
    const casparSubscriptions = this.magiSubscriptions.get(MessageParticipant.Caspar) || [];
    this.magiSubscriptions.set(MessageParticipant.Caspar, [...casparSubscriptions, generalSubscription]);
    
    await Promise.all(subscriptionPromises);
  }

  /**
   * Setup subscription for a WebSocket client to receive User messages
   * This includes TTS integration
   */
  async setupUserSubscription(ws: WebSocket): Promise<Subscription | null> {
    try {
      const messageQueue = await initializeMessageQueue();
      const subscription = messageQueue.subscribe(MessageParticipant.User, async (message) => {
        await this.handleUserMessage(ws, messageQueue, message);
      });
      
      this.userSubscriptions.add(subscription);
      logger.info('[WebSocket] Client subscribed to User message queue');
      return subscription;
    } catch (error) {
      logger.error('[WebSocket] Failed to set up message queue subscription for client', error);
      return null;
    }
  }

  /**
   * Handle a user message from the message queue
   */
  private async handleUserMessage(ws: WebSocket, messageQueue: any, message: any): Promise<void> {
    if (ws.readyState !== WebSocket.OPEN) {
      logger.warn('[WebSocket] Client not open - cannot send message queue response');
      return;
    }

    try {
      const testMeta = await this.getTestMetadata(message.content);
      await this.sendMessageToClient(ws, message, testMeta);
      await this.handleTTSForMessage(message);
      await messageQueue.acknowledge(message.id);
    } catch (error) {
      logger.error('[WebSocket] Failed to send message queue response to client', error);
    }
  }

  /**
   * Get test metadata if in test mode
   */
  private async getTestMetadata(content: string): Promise<any> {
    try {
      const testHooks = await import('../testing/test-hooks');
      if (testHooks.testHooks.isEnabled()) {
        try {
          const testMeta = testHooks.testHooks.endRunAndSummarize(content);
          logger.info(`[WebSocket] Test completed with metadata: ${JSON.stringify(testMeta)}`);
          return testMeta;
        } catch (error) {
          logger.warn(`[WebSocket] Failed to get test metadata: ${error}`);
        }
      }
    } catch (error) {
      logger.debug(`[WebSocket] Test hooks not available: ${error}`);
    }
    return undefined;
  }

  /**
   * Send message to WebSocket client
   */
  private async sendMessageToClient(ws: WebSocket, message: any, testMeta?: any): Promise<void> {
    const messagePayload = {
      type: 'deliberation-complete',
      data: {
        response: message.content,
        sender: message.sender,
        source: 'message-queue',
        ...(testMeta && { testMeta })
      }
    };
    ws.send(JSON.stringify(messagePayload));
    logger.debug(`[WebSocket] Sent message queue response to client from ${message.sender}`);
  }

  /**
   * Handle TTS for a message if sender is a Magi
   */
  private async handleTTSForMessage(message: any): Promise<void> {
    const shouldTriggerTTS = message.sender && 
      message.sender !== MessageParticipant.User && 
      message.sender !== MessageParticipant.System;
      
    if (!shouldTriggerTTS) return;

    try {
      const magiName = message.sender as MagiName;
      const magi: Magi2 | null = allMagi[magiName];
      if (!magi) return;

      const ttsReady = await (magi as Magi2).makeTTSReady(message.content);
      logger.debug(`\n🤖🔊\n${ttsReady}`);
      void speakWithMagiVoice(ttsReady, magiName);
    } catch (ttsError) {
      logger.warn('Failed to trigger TTS for message', ttsError);
    }
  }

  /**
   * Remove a user subscription (when WebSocket client disconnects)
   */
  removeUserSubscription(subscription: Subscription): void {
    subscription.unsubscribe();
    this.userSubscriptions.delete(subscription);
    logger.debug('[WebSocket] Removed user subscription');
  }

  /**
   * Collect responses from all 3 Magi for sealed envelope phase sequentially
   */
  async collectSealedEnvelopeResponses(timeoutMs: number = 30000): Promise<{balthazar: string, melchior: string, caspar: string}> {
    const messageQueue = await initializeMessageQueue();
    
    // Helper function to wait for a single response from a specific Magi
    const waitForResponse = async (expectedSender: MagiName): Promise<string> => {
      return new Promise<string>((resolve, reject) => {
        const subscription = messageQueue.subscribe(MessageParticipant.System, async (message) => {
          if (message.sender === expectedSender) {
            subscription.unsubscribe();
            resolve(message.content);
          }
        });
        
        setTimeout(() => {
          subscription.unsubscribe();
          reject(new Error(`Timeout waiting for ${expectedSender} response`));
        }, timeoutMs);
      });
    };
    
    // Wait for each Magi's response in order
    logger.info('Waiting for Balthazar response...');
    const balthazarResponse = await waitForResponse(MagiName.Balthazar);
    
    logger.info('Waiting for Melchior response...');
    const melchiorResponse = await waitForResponse(MagiName.Melchior);
    
    logger.info('Waiting for Caspar response...');
    const casparResponse = await waitForResponse(MagiName.Caspar);
    
    return {
      balthazar: balthazarResponse,
      melchior: melchiorResponse,
      caspar: casparResponse
    };
  }

  /**
   * Shutdown all subscriptions
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down message queue subscriptions...');
    
    // Shutdown Magi subscriptions
    for (const [magiName, subscriptions] of this.magiSubscriptions) {
      for (const subscription of subscriptions) {
        subscription.unsubscribe();
      }
      logger.debug(`Unsubscribed all subscriptions for ${magiName}`);
    }
    this.magiSubscriptions.clear();
    
    // Shutdown User subscriptions
    for (const subscription of this.userSubscriptions) {
      subscription.unsubscribe();
    }
    this.userSubscriptions.clear();
    
    logger.info('All message queue subscriptions shutdown complete');
  }
}

// Export a singleton instance
export const messageSubscriptionManager = new MessageSubscriptionManager();