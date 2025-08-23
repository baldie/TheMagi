import { WebSocket } from 'ws';
import { logger } from '../logger';
import { initializeMessageQueue, type Subscription, MessageType } from '../../../message-queue/src';
import { MessageParticipant } from '../types/magi-types';
import { balthazar, caspar, melchior, type MagiName } from './magi2';
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
    const subscriptionPromises = [caspar, melchior, balthazar].map(async (magi) => {
      const subscriptions: Subscription[] = [];
      
      // Subscribe to messages addressed to this specific Magi
      const personalSubscription = messageQueue.subscribe(magi.name, async (message) => {
        logger.debug(`${magi.name} received message from ${message.sender}: ${message.content}`);
        
        // Use contactAsAgent which now returns void and handles publishing internally
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
            
            // Trigger TTS for the response using the appropriate Magi voice
            if (message.sender && message.sender !== MessageParticipant.User && message.sender !== MessageParticipant.System) {
              try {
                // Parse the response to make it TTS-ready if needed
                const magiName = message.sender as MagiName;
                const magi = this.getMagiInstance(magiName);
                if (magi) {
                  const ttsReady = await magi.makeTTSReady(message.content);
                  logger.debug(`\n🤖🔊\n${ttsReady}`);
                  void speakWithMagiVoice(ttsReady, magiName);
                }
              } catch (ttsError) {
                logger.warn('Failed to trigger TTS for message', ttsError);
              }
            }
            
            // Acknowledge the message as processed
            await messageQueue.acknowledge(message.id);
          } catch (error) {
            logger.error('[WebSocket] Failed to send message queue response to client', error);
          }
        } else {
          logger.warn('[WebSocket] Client not open - cannot send message queue response');
        }
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
   * Remove a user subscription (when WebSocket client disconnects)
   */
  removeUserSubscription(subscription: Subscription): void {
    subscription.unsubscribe();
    this.userSubscriptions.delete(subscription);
    logger.debug('[WebSocket] Removed user subscription');
  }

  /**
   * Get Magi instance by name
   */
  private getMagiInstance(magiName: MagiName) {
    switch (magiName) {
      case MessageParticipant.Caspar:
        return caspar;
      case MessageParticipant.Melchior:
        return melchior;
      case MessageParticipant.Balthazar:
        return balthazar;
      default:
        return null;
    }
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