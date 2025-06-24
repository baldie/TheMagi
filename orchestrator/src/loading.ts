import fs from 'fs/promises';
import { logger } from './logger';
import { PERSONAS, MagiName } from './config';
import { contactMagi } from './services';
import { setPrompt } from './persona_manager';

async function checkPersonaReadiness(name: MagiName): Promise<void> {
  logger.info(`Pinging ${name} to confirm readiness...`);
  try {
    const response = await contactMagi(name, "Confirm you are ready by responding with only the word 'Ready'.");
    if (!response.trim().toLowerCase().includes('ready')) {
      throw new Error(`Received unexpected response from ${name}: ${response}`);
    }
    logger.info(`... ${name} is loaded and ready.`);
  } catch (error) {
    logger.error(`Readiness check failed for ${name}.`, error);
    throw error;
  }
}

export async function loadMagi(): Promise<void> {
  logger.info('--- Loading Magi Personas (Sequentially) ---');
  
  // Use a sequential for...of loop to load Magi one by one.
  for (const name of Object.values(MagiName)) {
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