import { balthazar, caspar, melchior, MagiName } from './magi/magi';
import { logger } from './logger';
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
  logger.info('Phase 1: Beginning independent assessment for "sealed envelope".');

  // Process models sequentially to avoid network errors
  logger.info('Running Balthazar assessment...');
  const balthazarResponse = await retry(() => balthazar.performIndependentAssessment(inquiry));
  
  logger.info('Running Melchior assessment...');
  const melchiorResponse = await retry(() => melchior.performIndependentAssessment(inquiry));
  
  logger.info('Running Caspar assessment...');
  const casparResponse = await retry(() => caspar.performIndependentAssessment(inquiry));

  const sealedEnvelope = `
    
--------------------------------------------------------------------------
Balthazar's Independent assessment:
${balthazarResponse}

--------------------------------------------------------------------------
Melchior's Independent assessment:
${melchiorResponse}

--------------------------------------------------------------------------
Caspar's Independent assessment:
${casparResponse}
--------------------------------------------------------------------------

  `;
  logger.debug(`A peek into the sealed envelope ✉️:\n ${sealedEnvelope}`);
  return sealedEnvelope;
}

async function beginDeliberationsPhase(sealedEnvelope: string): Promise<string> {
  let debateTranscript = sealedEnvelope;
  const MAX_ROUNDS = 3;
  let previousRoundResponses = '';

  const magiInstances = {
    [MagiName.Balthazar]: balthazar,
    [MagiName.Melchior]: melchior,
    [MagiName.Caspar]: caspar
  };

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    logger.info(`Phase 2: Starting Deliberation Round ${round}.`);

    // Shuffle the Magi order so that over time it balances out
    const deliberationOrder = [MagiName.Balthazar, MagiName.Melchior, MagiName.Caspar].sort(() => Math.random() - 0.5);
    let roundResponses = '';

    for (const currentMagiName of deliberationOrder) {
      const currentMagi = magiInstances[currentMagiName];
      
      // Send only initial positions and previous round (not full transcript)
      const recentContext = round === 1 ? sealedEnvelope : 
        `${sealedEnvelope}\n\n**Previous Round ${round - 1} Arguments:**${previousRoundResponses}`;
      
      const debatePrompt = `${currentMagi.name},
      Review the discussion transcript below.
      Your task is to persuade the other 2 participants of your position
      if you believe your argument is stronger, concede if their argument is stronger, or express
      agreement if you are more or less aligned.

      Dsicussion Transcript:
      --------------------------------
      ${recentContext}
      ${roundResponses}
      --------------------------------

      What is your response? Be very concise.
      `;
      
      const response = await retry(() => currentMagi.contact(debatePrompt));
      roundResponses += `\n${currentMagi.name}'s Round ${round} response:\n${response}\n---`;
      logger.info(`${currentMagi.name} has contributed to Round ${round}.`);
    }

    // Keep full transcript for final consensus check
    debateTranscript += `\n**Round ${round} Arguments:**${roundResponses}`;
    previousRoundResponses = roundResponses;

    logger.info(`Checking for consensus after Round ${round}.`);
    
    // For consensus check, only send the latest round responses
    const consensusCheckPrompt = `
      You will now act as an impartial moderator of a discussion.
      Review the latest round of deliberations below and determine if an consensus has been reached.

      Initial Positions:
      ${sealedEnvelope}

      Latest Round ${round} Arguments:
      ${roundResponses}

      If there are fundamental disagreements still, respond ONLY with the word "IMPASSE".
      Otherwise, respond with the final, agreed-upon recommendation/answer summarized so that it directly answers the inquiry.
      It is very important that you concise in your summary.
      Use as few words as possible to convey the outcome.
      `;
    const consensusResult = await retry(() => caspar.contactWithoutPersonality(consensusCheckPrompt));

    if (consensusResult.trim().toUpperCase() !== 'IMPASSE') {
      logger.info(`Consensus reached in Round ${round}.`);
      return consensusResult;
    } else {
      logger.info(`IMPASSE after Round ${round}.`);
      logger.info(`Round ${round}: responses were:\n${roundResponses}`);
    }
  }

  logger.info(`No consensus reached after ${MAX_ROUNDS} rounds. Generating summary of positions.`);
  const impasseSummaryPrompt = `
  A unanimous decision could not be reached after ${MAX_ROUNDS} rounds of deliberations. Your
  final task is to impartially summarize all the final positions and present them clearly
  to the user.

  Final Debate Transcript:
  ${debateTranscript}
  
  Please capture each Magi's final position and present them clearly to the user.
  Be very concise and do not use bullet points, use conversational prose.
  The user should be able to understand the differing viewpoints and the nature of the impasse.
  `;
  return await retry(() => caspar.contactWithoutPersonality(impasseSummaryPrompt));
}

/**
 * Main function that runs the deliberation process according to the V0 PRD.
 * @param inquiry - The user's question or request
 * @returns The final synthesized response or a summary of the impasse.
 */
export async function beginDeliberation(inquiry?: string): Promise<string> {
  try {
    logger.info('--- MAGI DELIBERATION INITIATED ---');
    logger.info('Starting deliberation proceedings', { inquiry });

    // V0 placeholders from PRD
    logger.info('... [V0] Caspar providing sanitized history to other Magi (placeholder).');
    logger.info('... [V0] Caspar providing smart device health info to Melchior (placeholder).');

    const sealedEnvelope = await runSealedEnvelopePhase(inquiry || '');
    const finalResponse = await beginDeliberationsPhase(sealedEnvelope);

    logger.info('--- Deliberation Complete ---');
    logger.debug('Final synthesized response', { finalResponse });

    // Trigger TTS for the final response using Caspar's voice (primary spokesperson)
    try {
      logger.info('Triggering TTS for final response...');
      await speakWithMagiVoice(finalResponse, MagiName.Caspar);
      logger.info('TTS delivery complete.');
    } catch (error) {
      logger.error('Failed to deliver TTS response, but deliberation was successful', error);
    }

    return finalResponse;
  } catch (error) {
    logger.error('A critical error occurred during the deliberation process', error);
    throw new Error('Deliberation failed. Check logs for details.');
  }
} 