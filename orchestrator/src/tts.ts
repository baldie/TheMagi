import axios, { AxiosError } from 'axios';
import { TTS_API_BASE_URL } from './config';
import { MagiName } from './config';
import { logger } from './logger';
import player from 'play-sound'; // A simpler, more robust audio player library
import { serviceManager } from './service_manager';

// Initialize the audio player
const audioPlayer = player({});

// Constants for TTS service
const MAX_TEXT_LENGTH = 10000; // Maximum text length as defined in TTS service
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

/**
 * Plays an audio buffer directly from memory.
 * @param audioBuffer - The audio data buffer to play
 */
async function playAudio(audioBuffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      // The library handles temporary files and cross-platform players internally
      audioPlayer.play(audioBuffer, (err: unknown) => {
        if (err) {
          logger.error('Failed to play audio.', err);
          return reject(err);
        }
        resolve();
      });
    } catch (error) {
      logger.error('Error in audio playback', error);
      reject(error);
    } finally {
      // Ensure buffer is cleared from memory
      audioBuffer = Buffer.alloc(0);
    }
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
 * Makes a TTS API request with retry logic
 * @param text - The text to convert to speech
 * @param persona - The Magi persona whose voice to use
 * @returns The audio buffer
 */
async function makeTTSRequest(text: string, persona: MagiName): Promise<Buffer> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.post(
        `${TTS_API_BASE_URL}/api/generate-speech`,
        {
          text,
          persona,
        },
        {
          responseType: 'arraybuffer',
          timeout: 30000, // 30 second timeout
        }
      );
      
      return Buffer.from(response.data);
    } catch (error) {
      lastError = error as Error;
      logger.error(`TTS request failed (attempt ${attempt}/${MAX_RETRIES})`, error);
      
      // Don't retry on certain errors
      if (error instanceof AxiosError) {
        if (error.response?.status === 400) { // Bad request
          throw error;
        }
      }
      
      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
      }
    }
  }
  
  throw lastError || new Error('Failed to generate speech after all retries');
}

/**
 * Speaks the text using the TTS service with the specified Magi's voice.
 * This function ensures the TTS service is running before making the request.
 * @param text - The text to be spoken
 * @param persona - The Magi persona whose voice to use
 */
export async function speakWithMagiVoice(text: string, persona: MagiName): Promise<void> {
  try {
    // Validate input
    validateInput(text);
    
    // Ensure TTS service is running
    const isServiceRunning = await serviceManager.ensureTTSServiceRunning();
    if (!isServiceRunning) {
      throw new Error('Failed to start TTS service');
    }

    logger.debug(`Requesting TTS for ${persona}`, { text });

    // Make TTS request with retry logic
    const audioBuffer = await makeTTSRequest(text, persona);

    logger.debug(`Received audio response from TTS service for ${persona}`);

    // Play the audio
    await playAudio(audioBuffer);

    logger.debug(`Finished playing audio for ${persona}`);
  } catch (error) {
    logger.error(`Error in TTS service for ${persona}`, error);
    throw new Error(`Failed to generate or play speech for ${persona}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}