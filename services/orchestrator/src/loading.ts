import fs from 'fs/promises';
import { logger } from './logger';
import { balthazar, caspar, melchior, Magi, MagiName, PERSONAS_CONFIG } from './magi/magi';

async function checkPersonaReadiness(magi: Magi): Promise<void> {
  const maxRetries = 3;
  const retryDelay = 5000; // 5 seconds

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    logger.info(`Pinging ${magi.name} to confirm readiness... (Attempt ${attempt}/${maxRetries})`);
    try {
      const response = await magi.contact("Confirm you are ready by responding with only the word 'Ready'.");
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

  // Step 2: Check readiness of all Magi in parallel
  logger.info('--- Checking Magi Readiness ---');
  const readinessPromises = [caspar, melchior, balthazar].map(magi => 
    checkPersonaReadiness(magi)
  );

  await Promise.all(readinessPromises);
  logger.info('--- All Magi Personas Loaded Successfully ---');
} 