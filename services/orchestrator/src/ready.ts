import { balthazar, caspar, melchior, MagiName } from './magi';
import { logger } from './logger';
import { speakWithMagiVoice } from './tts';
import { MemoryService } from './memory';

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

async function runSealedEnvelopePhase(inquiry: string, memoryService: MemoryService): Promise<string> {
  logger.info('Phase 1: Beginning independent analysis for "sealed envelope".');

  // Load user memory and inject context
  const userMemory = await memoryService.loadUserMemory();
  const balthazarMemoryContext = memoryService.generateMemoryContext(userMemory, 'balthazar');
  const melchiorMemoryContext = memoryService.generateMemoryContext(userMemory, 'melchior');
  const casparMemoryContext = memoryService.generateMemoryContext(userMemory, 'caspar');

  // Process models sequentially to avoid overwhelming the system
  const basePrompt = `Regarding "${inquiry}", what are your thoughts? Be concise and on topic.`;
  const balthazarResponse = await retry(() => balthazar.contact(`${balthazarMemoryContext}\n\n${basePrompt}`));
  const melchiorResponse = await retry(() => melchior.contact(`${melchiorMemoryContext}\n\n${basePrompt}`));
  const casparResponse = await retry(() => caspar.contact(`${casparMemoryContext}\n\n${basePrompt}`));

  const sealedEnvelope = `
    ---
    Balthazar's Initial response:
    ${balthazarResponse}
    ---
    Melchior's Initial response:
    ${melchiorResponse}
    ---
    Caspar's Initial response:
    ${casparResponse}
    ---
    `;
  logger.info('Phase 1: "Sealed envelope" created with 3 responses.');
  logger.debug('A peek into the sealed envelope:', { sealedEnvelope });
  return sealedEnvelope;
}

async function beginDeliberationsPhase(sealedEnvelope: string): Promise<string> {
  let debateTranscript = sealedEnvelope;
  const MAX_ROUNDS = 3;

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
      const debatePrompt = `${currentMagi.name},
      Review the complete debate transcript below. Your task is to persuade the others if you believe
      your argument is stronger or concede if their argument is stronger. Append your response.

      Full Transcript Thus Far:
      ${debateTranscript}
      ${roundResponses}

      What is your response? Be very concise.
      `;
      
      const response = await retry(() => currentMagi.contact(debatePrompt));
      roundResponses += `\n${currentMagi.name}'s Round ${round} Argument:\n${response}\n---`;
      logger.info(`${currentMagi.name} has contributed to Round ${round}.`);
    }

    debateTranscript += `\n**Round ${round} Arguments:**${roundResponses}`;

    logger.info(`Checking for consensus after Round ${round}.`);
    const consensusCheckPrompt = `
      You will now act as an impartial moderator. After reviewing the deliberations transcript below,
      determine if a unanimous consensus has been reached in the last round.

      If yes, respond ONLY with the final, agreed-upon recommendation. It is very important that you concise in your summary. Use as few words as possible to convey the outcome, if the user wants you to elaborate they will ask.
      If no, respond ONLY with the word "IMPASSE".

      Transcript:
      ${debateTranscript}
      `;
    const consensusResult = await retry(() => caspar.contact(consensusCheckPrompt));

    if (consensusResult.trim().toUpperCase() !== 'IMPASSE') {
      logger.info(`Consensus reached in Round ${round}.`);
      return consensusResult; // Return the consensus
    } else {
      logger.info(`IMPASSE after Round ${round}.`);
    }
  }

  logger.error(`No consensus reached after ${MAX_ROUNDS} rounds. Generating summary of positions.`);
  const impasseSummaryPrompt = `
  A unanimous decision could not be reached after ${MAX_ROUNDS} rounds of deliberations. Your
  final task is to impartially summarize all the final positions and present them clearly
  to the user.

  Final Debate Transcript:
  ${debateTranscript}
  
  Please capture each Magi's final position and present them clearly to the user. Be concise.
  `;
  return await retry(() => caspar.contact(impasseSummaryPrompt));
}

async function extractAndStoreMemory(inquiry: string, deliberationTranscript: string, memoryService: MemoryService): Promise<void> {
  logger.info('Memory extraction phase: Starting memory extraction from deliberation.');
  
  try {
    const memoryPrompt = memoryService.createMemoryExtractionPrompt(inquiry, deliberationTranscript);
    
    // Extract memory from each Magi
    const casparMemoryResponse = await retry(() => caspar.contact(memoryPrompt));
    const melchiorMemoryResponse = await retry(() => melchior.contact(memoryPrompt));
    const balthazarMemoryResponse = await retry(() => balthazar.contact(memoryPrompt));
    
    // Parse memory from responses
    const casparMemory = memoryService.extractMemoryFromResponse(casparMemoryResponse);
    const melchiorMemory = memoryService.extractMemoryFromResponse(melchiorMemoryResponse);
    const balthazarMemory = memoryService.extractMemoryFromResponse(balthazarMemoryResponse);
    
    // Extract topics from inquiry
    const topics = inquiry.toLowerCase().split(' ').filter(word => word.length > 3);
    
    // Update memory
    await memoryService.updateMemory(casparMemory, melchiorMemory, balthazarMemory, [], topics);
    
    logger.info('Memory extraction complete and stored.');
  } catch (error) {
    logger.error('Memory extraction failed, but deliberation was successful', error);
  }
}

/**
 * Main function that runs the deliberation process according to the V0 PRD.
 * @param inquiry - The user's question or request
 * @returns The final synthesized response or a summary of the impasse.
 */
export async function beginDeliberation(inquiry?: string): Promise<string> {
  const memoryService = new MemoryService(logger);
  
  try {
    logger.info('--- MAGI DELIBERATION INITIATED ---');
    if (inquiry) {
      logger.userQuery(inquiry);
    }
    logger.info('Starting deliberation proceedings');

    
    // V0 placeholders from PRD (now partially implemented with memory)
    logger.info('... [V0] Caspar providing sanitized history to other Magi (implemented via memory).');
    logger.info('... [V0] Caspar providing smart device health info to Melchior (placeholder).');

    const sealedEnvelope = await runSealedEnvelopePhase(inquiry || '', memoryService);
    const finalResponse = await beginDeliberationsPhase(sealedEnvelope);

    logger.info('--- Deliberation Complete ---');
    logger.debug('Final synthesized response', { finalResponse });

    // Extract and store memory from this conversation
    await extractAndStoreMemory(inquiry || '', sealedEnvelope, memoryService);

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