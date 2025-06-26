import fs from 'fs/promises';
import { logger } from './logger';
import { PERSONAS, MagiName } from './config';
import { contactMagi } from './services';
import { setPrompt } from './persona_manager';

async function checkPersonaReadiness(name: MagiName): Promise<void> {
  const maxRetries = 3;
  const retryDelay = 5000; // 5 seconds

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    logger.info(`Pinging ${name} to confirm readiness... (Attempt ${attempt}/${maxRetries})`);
    try {
      const response = await contactMagi(name, "Confirm you are ready by responding with only the word 'Ready'.");
      if (!response.trim().toLowerCase().includes('ready')) {
        throw new Error(`Received unexpected response from ${name}: ${response}`);
      }
      logger.info(`... ${name} is loaded and ready.`);
      return; // Success, exit the function
    } catch (error) {
      logger.warn(`Readiness check failed for ${name} on attempt ${attempt}.`, error);
      if (attempt < maxRetries) {
        logger.info(`Retrying in ${retryDelay / 1000} seconds...`);
        await new Promise(res => setTimeout(res, retryDelay));
      } else {
        logger.error(`Readiness check failed for ${name} after ${maxRetries} attempts.`, error);
        throw error; // Rethrow the error after the final attempt
      }
    }
  }
}

export async function loadMagi(): Promise<void> {
  logger.info('--- Loading Magi Personas (Sequentially) ---');
  
  // As per the PRD, the loading order should be Caspar, Melchior, and then Balthazar.
  const loadingOrder = [MagiName.Caspar, MagiName.Melchior, MagiName.Balthazar];

  // Use a sequential for...of loop to load Magi one by one.
  for (const name of loadingOrder) {
    logger.info(`Loading ${name}...`);
    const personaConfig = PERSONAS[name];

    // 1. Load prompt from file
    const prompt = await fs.readFile(personaConfig.personalitySource, 'utf-8');
    
    // 2. Store it in the manager
    setPrompt(name, prompt);
    logger.info(`... ${name}'s personality has been loaded from file.`);

    // V0 placeholders for data access checks from PRD
    switch (name) {
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

    // 3. Check readiness
    await checkPersonaReadiness(name);
  }

  logger.info('--- All Magi Personas Loaded Successfully ---');
} 