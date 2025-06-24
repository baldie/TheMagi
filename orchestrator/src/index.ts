import { logger } from './logger';
import { runDiagnostics } from './diagnostics';
import { loadMagi } from './loading';
import { runDeliberation } from './ready';

/**
 * Main entry point for The Magi application.
 * Orchestrates the V0 initialization process:
 * 1. Diagnostics
 * 2. Loading
 * 3. Ready (Deliberation)
 */
async function main() {
  try {
    logger.info('--- MAGI SYSTEM INITIALIZING ---');
    
    // Phase 1: Diagnostics
    await runDiagnostics();
    
    // Phase 2: Loading
    await loadMagi();
    
    // Phase 3: Ready
    logger.info('--- MAGI SYSTEM READY ---');
    
    // For V0, a hardcoded query is used to trigger the deliberation process.
    // This is the "prompt provided to the Magi" as per the PRD.
    const sampleQuery = 'David, our human, is trying to lose weight. He wants to know if going to the gym 5x a week is a good idea?';
    
    const finalResponse = await runDeliberation(sampleQuery);

    console.log('\n\n✅✅✅ FINAL RESPONSE FROM THE MAGI ✅✅✅');
    console.log('-------------------------------------------');
    console.log(finalResponse);
    console.log('-------------------------------------------\n');

  } catch (error) {
    logger.error('A critical error occurred during system operation. The application will now exit.', error);
    process.exit(1);
  }
}

main();