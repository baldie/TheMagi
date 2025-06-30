import { logger } from './logger';
import { runDiagnostics } from './diagnostics';
import { loadMagi } from './loading';
import { runDeliberation } from './ready';
import { speakWithMagiVoice } from './tts';
import { MagiName } from './magi';
import http from 'http';
import { createWebSocketServer } from './websocket';

/**
 * Main entry point for The Magi application.
 * Orchestrates the V0 initialization process:
 * 1. Diagnostics
 * 2. Loading
 * 3. Ready (Deliberation)
 */
async function main() {
  const server = http.createServer();
  createWebSocketServer(server);

  const PORT = process.env.PORT || 8080;
  server.listen(PORT, () => {
    logger.info(`Orchestrator HTTP/WebSocket server listening on port ${PORT}`);
  });
  
  try {
    logger.info('--- MAGI SYSTEM INITIALIZING ---');
    
    // Phase 1: Diagnostics
    await runDiagnostics();
    
    // Phase 2: Loading
    await loadMagi();
    
    // Phase 3: Ready
    logger.info('--- MAGI SYSTEM READY ---');
    
    // As per the PRD, the initial deliberation is kicked off with a general
    // inquiry to see if there is anything worth reporting to the user.
    const initialInquiry = 'Given the latest data, do we need to communicate to the user? If so, what?';
    
    const finalResponse = await runDeliberation(initialInquiry);

    console.log('-------------------------------------------');
    console.log(finalResponse);
    console.log('-------------------------------------------\n');

    if (finalResponse) {
      try {
        logger.info('Sending final response to TTS service...');
        await speakWithMagiVoice(finalResponse, MagiName.Caspar);
        logger.info('...TTS playback complete.');
      } catch (error) {
        logger.error('The final response could not be spoken.', error);
      }
    }

  } catch (error) {
    logger.error('A critical error occurred during system operation. The application will now exit.', error);
    process.exit(1);
  }
}

main().catch(error => {
  logger.error('Unhandled promise rejection in main.', error);
  process.exit(1);
});