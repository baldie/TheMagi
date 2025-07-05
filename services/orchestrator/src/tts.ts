import axios, { AxiosError } from 'axios';
import { TTS_API_BASE_URL } from './config';
import { MagiName } from './magi';
import { logger } from './logger';
import { serviceManager } from './service_manager';
import { Stream } from 'stream';
import { broadcastAudioToClients } from './websocket';

// Constants for TTS service
const MAX_TEXT_LENGTH = 10000; // Maximum text length as defined in TTS service
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

/**
 * Streams audio data to WebSocket clients for browser-based playback.
 * Uses Web Audio API in the browser instead of server-side FFmpeg.
 * @param audioStream - A stream containing the audio data.
 * @param persona - The Magi persona speaking.
 */
async function streamAudioToClients(audioStream: Stream, persona: MagiName): Promise<void> {
  // Buffer to collect audio data for WebSocket clients
  const audioChunks: Buffer[] = [];
  
  return new Promise<void>((resolve, reject) => {
    // Collect audio chunks and stream to WebSocket clients
    audioStream.on('data', (chunk: Buffer) => {
      audioChunks.push(chunk);
      // Send chunks in real-time to WebSocket clients
      broadcastAudioToClients(chunk, persona, false);
    });

    audioStream.on('end', () => {
      // Send final notification to WebSocket clients
      broadcastAudioToClients(Buffer.alloc(0), persona, true);
      logger.debug(`Audio streaming completed for ${persona}, sent ${audioChunks.length} chunks to clients`);
      resolve();
    });

    audioStream.on('error', (err) => {
      logger.error('Error in audio stream', err);
      reject(err);
    });
  });
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
 * Makes a TTS API request for a single chunk of text and returns the audio stream.
 * @param text - The text to convert to speech
 * @param persona - The Magi persona whose voice to use
 * @returns The audio stream
 */
/**
 * Get persona-specific TTS settings
 * @param persona - The Magi persona
 * @returns TTS generation parameters
 */
function getPersonaSettings(persona: MagiName) {
  const settings = {
    [MagiName.Caspar]: {
      exaggeration: 0.5,
      cfg_weight: 0.5
    },
    [MagiName.Melchior]: {
      exaggeration: 0.7,
      cfg_weight: 0.3
    },
    [MagiName.Balthazar]: {
      exaggeration: 0.3,
      cfg_weight: 0.6
    }
  };
  
  return settings[persona] || settings[MagiName.Caspar];
}

async function makeTTSRequest(text: string, persona: MagiName): Promise<Stream> {
  // Get persona-specific settings
  const personaSettings = getPersonaSettings(persona);
  
  // Step 1: Request synthesis with Chatterbox API
  const synthesisResponse = await axios.post(
    `${TTS_API_BASE_URL}/synthesize`,
    {
      text,
      voice: persona.toLowerCase(),
      speed: 1.0,
      pitch: 1.0,
      exaggeration: personaSettings.exaggeration,
      cfg_weight: personaSettings.cfg_weight
    },
    {
      timeout: 60000, // 60-second timeout for a single sentence
    }
  );

  const { audio_id } = synthesisResponse.data;
  
  // Step 2: Get the audio file stream
  const audioResponse = await axios.get(
    `${TTS_API_BASE_URL}/audio/${audio_id}`,
    {
      responseType: 'stream',
      timeout: 30000, // 30-second timeout for audio download
    }
  );
  
  return audioResponse.data;
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

    let ttsRequestPromise: Promise<Stream> | null = makeTTSRequest(sentences[0], persona);

    for (let i = 0; i < sentences.length; i++) {
        const currentSentence = sentences[i];
        let nextTtsRequestPromise: Promise<Stream> | null = null;
        
        // Pre-fetch the next sentence while the current one is being processed.
        if (i + 1 < sentences.length) {
            const nextSentence = sentences[i + 1];
            logger.debug(`Requesting TTS for next sentence: "${nextSentence}"`);
            nextTtsRequestPromise = makeTTSRequest(nextSentence, persona);
        }

        try {
            if (ttsRequestPromise) {
              const audioStream = await ttsRequestPromise;
              
              await streamAudioToClients(audioStream, persona);

              logger.debug(`${persona}: "${currentSentence}"`);
            }
        } catch (error) {
            logger.error(`Failed to process TTS for sentence: "${currentSentence}"`, error);
            // Continue to the next sentence even if one fails.
        }
        
        ttsRequestPromise = nextTtsRequestPromise;
    }
    
    logger.debug(`Finished playing all audio for ${persona}`);
  } catch (error) {
    logger.error(`Error in TTS service for ${persona}`, error);
    throw new Error(`Failed to generate or play speech for ${persona}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}