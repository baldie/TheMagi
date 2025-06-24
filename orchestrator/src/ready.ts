import { MagiName } from './config';
import { logger } from './logger';
import { contactMagi } from './services';
import { speakWithMagiVoice } from './tts';

/**
 * Retry a function with exponential backoff.
 * Note: This is a copy from the original index.ts. Consider moving to a shared utils file.
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

async function runSealedEnvelopePhase(inquiry: string): Promise<string> {
  logger.info('Phase 1: Beginning independent analysis for "sealed envelope".');
  
  const [balthazarThesis, melchiorThesis, casparThesis] = await Promise.all([
    retry(() => contactMagi(MagiName.Balthazar, `Regarding the query "${inquiry}", what is your initial, independent thesis?`)),
    retry(() => contactMagi(MagiName.Melchior, `Regarding the query "${inquiry}", what is your initial, independent thesis?`)),
    retry(() => contactMagi(MagiName.Caspar, `Regarding the query "${inquiry}", what is your initial, independent thesis?`)),
  ]);

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
  return sealedEnvelope;
}

async function runDeliberationPhase(sealedEnvelope: string): Promise<string> {
  let debateTranscript = sealedEnvelope;
  const MAX_ROUNDS = 3;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    logger.info(`Phase 2: Starting Deliberation Round ${round}.`);

    const deliberationOrder = [MagiName.Balthazar, MagiName.Melchior, MagiName.Caspar].sort(() => Math.random() - 0.5);
    let roundResponses = '';

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

    debateTranscript += `\n**Round ${round} Arguments:**${roundResponses}`;

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
      return consensusResult; // Return the consensus
    } else {
      logger.info(`IMPASSE after Round ${round}.`);
      // V0 does not require summarization between rounds to save tokens
    }
  }

  logger.error(`No consensus reached after ${MAX_ROUNDS} rounds. Generating summary of positions.`);
  const impasseSummaryPrompt = `
  A unanimous decision could not be reached after ${MAX_ROUNDS} rounds of debate. Your
  final task is to impartially summarize all the final positions and present them clearly
  to the user.

  Final Debate Transcript:
  ${debateTranscript}
  `;
  return await retry(() => contactMagi(MagiName.Caspar, impasseSummaryPrompt));
}

/**
 * Main function that runs the deliberation process according to the V0 PRD.
 * @param inquiry - The user's question or request
 * @returns The final synthesized response or a summary of the impasse.
 */
export async function runDeliberation(inquiry: string): Promise<string> {
  logger.info('--- Running Deliberation Process ---');
  logger.info('Starting deliberation proceedings', { inquiry });

  // V0 placeholders from PRD
  logger.info('... [V0] Caspar providing sanitized history to other Magi (placeholder).');
  logger.info('... [V0] Caspar providing smart device health info to Melchior (placeholder).');

  try {
    const sealedEnvelope = await runSealedEnvelopePhase(inquiry);
    const finalResponse = await runDeliberationPhase(sealedEnvelope);
    
    logger.info('--- Deliberation Complete ---');
    logger.debug('Final synthesized response', { finalResponse });

    try {
      await speakWithMagiVoice(finalResponse, MagiName.Caspar);
    } catch (error) {
      logger.error('Failed to speak response', error);
      // Don't re-throw; failing to speak shouldn't crash the whole app
    }

    return finalResponse;
  } catch (error) {
    logger.error('A critical error occurred during the deliberation process', error);
    throw new Error('Deliberation failed. Check logs for details.');
  }
} 