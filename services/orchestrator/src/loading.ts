import fs from 'fs/promises';
import { logger } from './logger';
import type { Magi2 } from './magi/magi2';
import { balthazar, caspar, melchior, MagiName, PERSONAS_CONFIG } from './magi/magi2';
import { initializeMessageQueue, type Subscription, MessageType } from './message-queue';
import { beginDeliberation } from './ready';
import { MessageParticipant } from './types/magi-types';

export const enqueueMessage = async (sender: MessageParticipant, recipient: MessageParticipant, content: string): Promise<void> => {
  const messageQueue = await initializeMessageQueue();
  await messageQueue.publish(sender, recipient, content, MessageType.REQUEST);
};

// Store subscriptions globally for cleanup if needed
const magiSubscriptions: Map<MagiName, Subscription[]> = new Map();

async function setupMessageQueueSubscriptions(): Promise<void> {
  logger.info('--- Setting up Message Queue Subscriptions ---');
  
  try {
    // Initialize message queue first
    const messageQueue = await initializeMessageQueue();
    
    // Set up subscriptions for each Magi
    const subscriptionPromises = [caspar, melchior, balthazar].map(async (magi) => {
      const subscriptions: Subscription[] = [];
      
      // Subscribe to messages addressed to this specific Magi
      const personalSubscription = messageQueue.subscribe(magi.name, async (message) => {
        logger.debug(`${magi.name} received message from ${message.sender}: ${message.content}`);
        
        const response = await magi.contactAsAgent(message.content, message.sender);

        // Push the message back to the queue for whoever sent it (allows magi to magi communication)
        await messageQueue.publish(
          magi.name,
          message.sender,
          response,
          MessageType.RESPONSE,
        );
      });
      subscriptions.push(personalSubscription);
      logger.info(`... ${magi.name} subscribed to personal messages.`);
      
      // Store subscriptions for potential cleanup
      magiSubscriptions.set(magi.name, subscriptions);
    });

    // Listen for general "Magi" messages
    const generalSubscription = messageQueue.subscribe(MessageParticipant.Magi, async (message) => {
      logger.debug(`General Magi message from ${message.sender}: ${message.content}`);
      
      // Deliberate on the message
      const response = await beginDeliberation(message.content);

      // Push the message back to the queue for the user
      await messageQueue.publish(
        MessageParticipant.Magi,
        MessageParticipant.User,
        response,
        MessageType.RESPONSE,
      );
    });
    const casparSubscriptions = magiSubscriptions.get(MessageParticipant.Caspar) || [];
    magiSubscriptions.set(MessageParticipant.Caspar, [...casparSubscriptions, generalSubscription]);
    
    await Promise.all(subscriptionPromises);
    logger.info('--- Message Queue Subscriptions Complete ---');
  } catch (error) {
    logger.error('Failed to set up message queue subscriptions:', error);
    throw error;
  }
}

async function checkPersonaReadiness(magi: Magi2): Promise<void> {
  const maxRetries = 3;
  const retryDelay = 5000; // 5 seconds

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    logger.info(`Pinging ${magi.name} to confirm readiness... (Attempt ${attempt}/${maxRetries})`);
    try {
      const response = await magi.contact(MessageParticipant.System, "Confirm you are ready by responding with only the word 'Ready'.");
      if (!response.trim().toLowerCase().includes('ready')) {
        throw new Error(`Received unexpected response from ${magi.name}: ${response}`);
      }
      logger.info(`... ${magi.name} is loaded and ready.`);
      
      // Clear any memories from the readiness check
      magi.forget();
      logger.debug(`... ${magi.name}'s memory has been cleared after readiness check.`);
      
      return; // Success, exit the function
    } catch (error) {
      logger.warn(`Readiness check failed for ${magi.name} on attempt ${attempt}.`, error);
      if (attempt < maxRetries) {
        logger.info(`Retrying in ${retryDelay / 1000} seconds...`);
        await new Promise(res => setTimeout(res, retryDelay));
      } else {
        logger.error(`Readiness check failed for ${magi.name} after ${maxRetries} attempts.`, error);
        throw error; // Rethrow the error after the final attempt
      }
    }
  }
}

export async function loadMagi(): Promise<void> {
  logger.info('--- Loading Magi Personas ---');

  // Step 1: Initialize all Magi in parallel
  const initPromises = [caspar, melchior, balthazar].map(async (magi) => {
    logger.info(`Loading ${magi.name}...`);
    
    // 1. Load prompt from file using the absolute path from PERSONAS_CONFIG
    const { personalitySource } = PERSONAS_CONFIG[magi.name];
    const personalityPrompt = await fs.readFile(personalitySource, 'utf-8');
    
    // 2. Store it in the manager and initialize tools
    await magi.initialize(personalityPrompt);
    logger.info(`... ${magi.name}'s personality has been loaded from file.`);

    // Placeholders for data access checks
    switch (magi.name) {
      case MagiName.Caspar:
        logger.info('... [V0] Checking for smart home access (placeholder).');
        break;
      case MagiName.Melchior:
        logger.info('... [V0] Checking for access to personal data (placeholder).');
        logger.info('... [V0] Verifying no internet access (by prompt design).');
        break;
      case MagiName.Balthazar:
        logger.info('... [V0] Verifying internet access (by prompt design).');
        break;
    }
  });

  await Promise.all(initPromises);
  logger.info('--- All Magi Personas Initialized ---');

  // Step 2: Set up message queue subscriptions
  await setupMessageQueueSubscriptions();

  // Step 3: Check readiness of all Magi in parallel
  logger.info('--- Checking Magi Readiness ---');
  const readinessPromises = [caspar, melchior, balthazar].map(async magi => 
    checkPersonaReadiness(magi)
  );

  await Promise.all(readinessPromises);
  logger.info('--- All Magi Personas Loaded Successfully ---');
}

/**
 * Cleanup function to unsubscribe all Magi from message queues
 * Should be called during application shutdown
 */
export function cleanupMagiSubscriptions(): void {
  logger.info('Cleaning up Magi message queue subscriptions...');
  
  for (const [magiName, subscriptions] of magiSubscriptions) {
    for (const subscription of subscriptions) {
      try {
        subscription.unsubscribe();
      } catch (error) {
        logger.warn(`Failed to unsubscribe ${magiName}:`, error);
      }
    }
  }
  
  magiSubscriptions.clear();
  logger.info('All Magi subscriptions cleaned up.');
} 