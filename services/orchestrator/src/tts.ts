import axios from 'axios';
import { TTS_API_BASE_URL } from './config';
import { MagiName } from './magi/magi2';
import { logger } from './logger';
import { serviceManager } from './service_manager';
import { broadcastAudioToClients } from './websocket';

// Constants for TTS service
const MAX_TEXT_LENGTH = 10000; // Maximum text length as defined in TTS service

/**
 * Streams audio data to WebSocket clients for browser-based playback.
 * Uses Web Audio API in the browser instead of server-side FFmpeg.
 * @param audioStream - A stream containing the audio data.
 * @param persona - The Magi persona speaking.
 * @param sequenceNumber - The sequence number for this audio chunk.
 */
async function streamAudioToClients(audioBuffer: Buffer, persona: MagiName, sequenceNumber: number): Promise<void> {
  // Stream audio data to WebSocket clients in chunks for better performance
  const chunkSize = 8192; // 8KB chunks for optimal streaming
  const totalChunks = Math.ceil(audioBuffer.length / chunkSize);
  
  logger.debug(`Streaming ${audioBuffer.length} bytes of audio data in ${totalChunks} chunks for ${persona} (sequence: ${sequenceNumber})`);
  
  // Send audio data in chunks
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, audioBuffer.length);
    const chunk = audioBuffer.slice(start, end);
    
    const isLastChunk = (i === totalChunks - 1);
    broadcastAudioToClients(chunk, persona, isLastChunk, sequenceNumber);
    
    // Small delay between chunks to prevent overwhelming WebSocket clients
    if (!isLastChunk) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  
  logger.debug(`Audio streaming completed for ${persona}, sent ${totalChunks} chunks to clients (sequence: ${sequenceNumber})`);
}

/**
 * Validates the input text for TTS processing
 * @param text - The text to validate
 * @throws Error if validation fails
 */
function validateInput(text: string): void {
  if (!text || text.trim().length === 0) {
    throw new Error('Text cannot be empty');
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(`Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters`);
  }
}

/**
 * Get persona-specific TTS settings
 * @param persona - The Magi persona
 * @returns TTS generation parameters
 */
function getPersonaSettings(persona: MagiName) {
  const settings = {
    [MagiName.Caspar]: {
      exaggeration: 0.5,
      cfg_weight: 0.5,
      audio_prompt_path: 'morgana.wav'
    },
    [MagiName.Melchior]: {
      exaggeration: 0.7,
      cfg_weight: 0.3,
      audio_prompt_path: 'GLaDOS.wav'
    },
    [MagiName.Balthazar]: {
      exaggeration: 0.3,
      cfg_weight: 0.6,
      audio_prompt_path: 'optimus.wav'
    }
  };
  
  return settings[persona] || settings[MagiName.Caspar];
}

async function makeTTSRequest(text: string, persona: MagiName): Promise<Buffer> {
  // Get persona-specific settings
  const personaSettings = getPersonaSettings(persona);
  
  // Use optimized direct synthesis endpoint (single request, no file I/O)
  const synthesisResponse = await axios.post(
    `${TTS_API_BASE_URL}/synthesize-direct`,
    {
      text,
      voice: persona.toLowerCase(),
      speed: 1.0,
      pitch: 1.0,
      exaggeration: personaSettings.exaggeration,
      cfg_weight: personaSettings.cfg_weight,
      audio_prompt_path: personaSettings.audio_prompt_path,
      use_cached_voice: false  // Use persona-specific voice file
    },
    {
      timeout: 60000, // 60-second timeout for synthesis
    }
  );

  const { audio_data } = synthesisResponse.data;
  
  if (!audio_data) {
    throw new Error('No audio data received from TTS service');
  }
  
  // Decode base64 audio data to buffer
  return Buffer.from(audio_data, 'base64');
}

/**
 * Batch synthesis for multiple sentences in a single request
 * @param texts Array of text sentences to synthesize
 * @param persona The Magi persona
 * @returns Array of audio buffers in order
 */
async function makeBatchTTSRequest(texts: string[], persona: MagiName): Promise<Buffer[]> {
  const personaSettings = getPersonaSettings(persona);
  
  logger.debug(`Making batch TTS request for ${texts.length} sentences`);
  
  const batchResponse = await axios.post(
    `${TTS_API_BASE_URL}/synthesize-batch`,
    {
      texts,
      voice: persona.toLowerCase(),
      speed: 1.0,
      pitch: 1.0,
      exaggeration: personaSettings.exaggeration,
      cfg_weight: personaSettings.cfg_weight,
      audio_prompt_path: personaSettings.audio_prompt_path,
      use_cached_voice: false
    },
    {
      timeout: 120000, // 2-minute timeout for batch requests
    }
  );
  
  const { results } = batchResponse.data;
  
  if (!results || !Array.isArray(results)) {
    throw new Error('Invalid batch response from TTS service');
  }
  
  // Sort results by sequence number and decode audio data
  return results
    .sort((a, b) => a.sequence_number - b.sequence_number)
    .map(result => {
      if (!result.audio_data) {
        throw new Error(`No audio data for sequence ${result.sequence_number}`);
      }
      return Buffer.from(result.audio_data, 'base64');
    });
}

/**
 * Splits text into sentences for sequential processing.
 * @param text The text to split.
 * @returns An array of sentences.
 */
function splitIntoSentences(text: string): string[] {
    // This regex splits the text by periods, question marks, or exclamation marks,
    // followed by whitespace or the end of the string. It keeps the delimiters.
    const sentences = text.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g);
    return sentences ? sentences.map(s => s.trim()).filter(s => s.length > 0) : [];
}

/**
 * Speaks the text using the TTS service with the specified Magi's voice,
 * processing and streaming the audio sentence by sentence to WebSocket clients.
 * Audio playback is handled by the browser using Web Audio API.
 * @param text - The full text to be spoken
 * @param persona - The Magi persona whose voice to use
 */
/**
 * Optimized version using batch synthesis for better performance
 */
export async function speakWithMagiVoice(text: string, persona: MagiName): Promise<void> {
  try {
    validateInput(text);
    
    await serviceManager.startTTSService();

    const sentences = splitIntoSentences(text);
    if (sentences.length === 0) {
        logger.warn('No sentences to speak.');
        return;
    }

    logger.debug(`Split text into ${sentences.length} sentences for TTS processing.`);

    // Use batch processing for better performance when we have multiple sentences
    if (sentences.length > 3) {
      await speakWithBatchSynthesis(sentences, persona);
    } else {
      await speakWithSequentialSynthesis(sentences, persona);
    }
    
    logger.debug(`Finished playing all audio for ${persona}`);
  } catch (error) {
    logger.error(`Error in TTS service for ${persona}`, error);
    throw new Error(`Failed to generate or play speech for ${persona}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Process sentences using batch synthesis (optimal for 4+ sentences)
 */
async function speakWithBatchSynthesis(sentences: string[], persona: MagiName): Promise<void> {
  logger.debug(`Using batch synthesis for ${sentences.length} sentences`);
  
  try {
    // Get all audio buffers in a single batch request
    const audioBuffers = await makeBatchTTSRequest(sentences, persona);
    
    // Stream each audio buffer to clients in sequence
    for (let i = 0; i < audioBuffers.length; i++) {
      await streamAudioToClients(audioBuffers[i], persona, i);
      logger.debug(`${persona}: "${sentences[i]}" (sequence: ${i})`);
    }
  } catch (error) {
    logger.warn(`Batch synthesis failed, falling back to sequential: ${error}`);
    await speakWithSequentialSynthesis(sentences, persona);
  }
}

/**
 * Process sentences sequentially with pre-fetching (optimal for 1-3 sentences)
 */
async function speakWithSequentialSynthesis(sentences: string[], persona: MagiName): Promise<void> {
  logger.debug(`Using sequential synthesis for ${sentences.length} sentences`);
  
  let ttsRequestPromise: Promise<Buffer> | null = makeTTSRequest(sentences[0], persona);

  for (let i = 0; i < sentences.length; i++) {
      const currentSentence = sentences[i];
      let nextTtsRequestPromise: Promise<Buffer> | null = null;
      
      // Pre-fetch the next sentence while the current one is being processed.
      if (i + 1 < sentences.length) {
          const nextSentence = sentences[i + 1];
          logger.debug(`Requesting TTS for next sentence: "${nextSentence}"`);
          nextTtsRequestPromise = makeTTSRequest(nextSentence, persona);
      }

      try {
          if (ttsRequestPromise) {
            const audioBuffer = await ttsRequestPromise;
            
            await streamAudioToClients(audioBuffer, persona, i);

            logger.debug(`${persona}: "${currentSentence}" (sequence: ${i})`);
          }
      } catch (error) {
          logger.error(`Failed to process TTS for sentence: "${currentSentence}" (sequence: ${i})`, error);
          // Continue to the next sentence even if one fails.
      }
      
      ttsRequestPromise = nextTtsRequestPromise;
  }
}