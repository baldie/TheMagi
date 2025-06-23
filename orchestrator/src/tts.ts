import axios from 'axios';
import { TTS_API_BASE_URL } from './config';
import { MagiName } from './config';
import { logger } from './logger';
import player from 'play-sound'; // A simpler, more robust audio player library

// Initialize the audio player
const audioPlayer = player({});

/**
 * Plays an audio buffer directly from memory.
 * @param audioBuffer - The audio data buffer to play
 */
async function playAudio(audioBuffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    // The library handles temporary files and cross-platform players internally
    audioPlayer.play(audioBuffer, (err: unknown) => {
      if (err) {
        logger.error('Failed to play audio.', err);
        return reject(err);
      }
      resolve();
    });
  });
}

/**
 * Speaks the text using the TTS service with the specified Magi's voice.
 * This function now assumes the TTS service is already running.
 * @param text - The text to be spoken
 * @param persona - The Magi persona whose voice to use
 */
export async function speakWithMagiVoice(text: string, persona: MagiName): Promise<void> {
  try {
    logger.debug(`Requesting TTS for ${persona}`, { text });

    // The function no longer checks if the service is running.
    // It simply calls the API, assuming it's available.
    const response = await axios.post(
      `${TTS_API_BASE_URL}/api/generate-speech`,
      {
        text,
        persona,
      },
      {
        responseType: 'arraybuffer', // Correctly handle binary audio data
      }
    );

    logger.debug(`Received audio response from TTS service for ${persona}`);

    // Play the audio directly from the response buffer
    await playAudio(Buffer.from(response.data));

    logger.debug(`Finished playing audio for ${persona}`);
  } catch (error) {
    logger.error(`Cannot connect to TTS service for ${persona}. Is the service running?`, error);
    // Throw an error so the orchestrator knows speech failed.
    throw new Error(`Failed to generate or play speech for ${persona}.`);
  }
}