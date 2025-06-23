import { MagiName } from './config';
import { logger } from './logger';
import { contactMagi } from './services';
import { speakWithMagiVoice } from './tts';

/**
 * Interface for storing individual analyses from each persona
 */
interface PersonaAnalyses {
  balthazar: string;
  melchior: string;
  caspar: string;
}

/**
 * Retry a function with exponential backoff
 */
async function retry<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  delay: number = 1000
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries === 0) throw error;
    logger.error(`Function failed. Retrying in ${delay}ms... (${retries} retries left)`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return retry(fn, retries - 1, delay * 2);
  }
}

/**
 * Main function that runs the deliberation process according to the V0 PRD.
 * @param inquiry - The user's question or request
 * @returns The final synthesized response or a summary of the impasse.
 */
async function runDeliberation(inquiry: string): Promise<string> {
  logger.info('Starting deliberation proceedings', { inquiry });

  try {
    // ===================================================================
    // Phase 1: Independent Analysis
    // ===================================================================
    logger.info('Phase 1: Beginning independent analysis for "sealed envelope".');
    
    const [balthazarThesis, melchiorThesis, casparThesis] = await Promise.all([
      retry(() => contactMagi(MagiName.Balthazar, `Regarding the query "${inquiry}", what is your initial, independent thesis?`)),
      retry(() => contactMagi(MagiName.Melchior, `Regarding the query "${inquiry}", what is your initial, independent thesis?`)),
      retry(() => contactMagi(MagiName.Caspar, `Regarding the query "${inquiry}", what is your initial, independent thesis?`)),
    ]);

    // This represents the initial, immutable "sealed envelope" 
    const sealedEnvelope = `
---
Balthazar's Initial Thesis:
${balthazarThesis}
---
Melchior's Initial Thesis:
${melchiorThesis}
---
Caspar's Initial Thesis:
${casparThesis}
---
`;
    logger.info('Phase 1: "Sealed envelope" created with 3 theses.');
    logger.debug('Sealed Envelope Contents:', { sealedEnvelope });


    // ===================================================================
    // Phase 2: Multi-Round Deliberation
    // ===================================================================
    let debateTranscript = sealedEnvelope;
    let finalConsensus = '';
    const MAX_ROUNDS = 3;

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      logger.info(`Phase 2: Starting Deliberation Round ${round}.`);

      // The order is random 
      const deliberationOrder = [MagiName.Balthazar, MagiName.Melchior, MagiName.Caspar].sort(() => Math.random() - 0.5);
      
      let roundResponses = '';

      // Each Magi responds sequentially within the round 
      for (const currentMagi of deliberationOrder) {
        const debatePrompt = `
        Review the complete debate transcript below. Your task is to persuade the others or
        concede if their argument is stronger. Append your response.

        Full Transcript Thus Far:
        ${debateTranscript}
        ${roundResponses}
        Your Response:
        `;
        const response = await retry(() => contactMagi(currentMagi, debatePrompt));
        roundResponses += `\n${currentMagi}'s Round ${round} Argument:\n${response}\n---`;
        logger.info(`${currentMagi} has contributed to Round ${round}.`);
      }

      // Append the full round's responses to the main transcript 
      debateTranscript += `\n**Round ${round} Arguments:**${roundResponses}`;

      // Check for consensus at the end of the round 
      logger.info(`Checking for consensus after Round ${round}.`);
      const consensusCheckPrompt = `
        You are the impartial System Adjudicator. After reviewing the full debate transcript below, determine if a unanimous consensus has been reached. 
        If yes, respond ONLY with the final, agreed-upon recommendation. 
        If no, respond ONLY with the word "IMPASSE".

        Transcript:
        ${debateTranscript}
        `;
      const consensusResult = await retry(() => contactMagi(MagiName.Caspar, consensusCheckPrompt));

      if (consensusResult.trim().toUpperCase() !== 'IMPASSE') {
        logger.info(`Consensus reached in Round ${round}.`);
        finalConsensus = consensusResult;
        break; // Exit the loop as consensus is found
      } else {
        logger.info(`IMPASSE after Round ${round}.`);
        // TODO: to reduce load on the context windows, we should pass the full transcript
        // maybe summarize the transcript and pass that to the next round
      }
    }

    // ===================================================================
    // Phase 3: Final Output Generation
    // ===================================================================
    let finalResponse: string;

    if (finalConsensus) {
      finalResponse = finalConsensus;
    } else {
      // If no consensus after 3 rounds, Caspar summarizes the impasse 
      logger.error(`No consensus reached after ${MAX_ROUNDS} rounds. Generating summary of positions.`);
      const impasseSummaryPrompt = `
      A unanimous decision could not be reached after ${MAX_ROUNDS} rounds of debate. Your
      final task is to impartially summarize all the final positions and present them clearly
      to the user.

      Final Debate Transcript:
      ${debateTranscript}
      `;
      finalResponse = await retry(() => contactMagi(MagiName.Caspar, impasseSummaryPrompt));
    }
    
    logger.info('Phase 3: Deliberation complete.');
    logger.debug('Final synthesized response', { finalResponse });

    // Per V0 spec, print to terminal and call TTS 
    try {
      await speakWithMagiVoice(finalResponse, MagiName.Caspar);
    } catch (error) {
      logger.error('Failed to speak response', error);
    }

    return finalResponse;
  } catch (error) {
    logger.error('A critical error occurred during the deliberation process', error);
    throw new Error('Deliberation failed. Check logs for details.');
  }
}


// Example usage
const sampleQuery = 'David, our user is trying to lose weight. Is gym 5x a week a good idea?'; // 

runDeliberation(sampleQuery)
  .then((response) => {
    console.log('\nFinal Response from The Magi:');
    console.log('----------------------------');
    console.log(response);
    console.log('----------------------------\n');
  })
  .catch((error) => {
    console.error('Application error:', error);
    process.exit(1);
  });