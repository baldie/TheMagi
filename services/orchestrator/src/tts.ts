import axios, { AxiosError } from 'axios';
import { TTS_API_BASE_URL } from './config';
import { MagiName } from './magi';
import { logger } from './logger';
import { serviceManager } from './service_manager';
import { spawn } from 'child_process';
import { Stream, PassThrough } from 'stream';
import { broadcastAudioToClients } from './websocket';

// Constants for TTS service
const MAX_TEXT_LENGTH = 10000; // Maximum text length as defined in TTS service
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

/**
 * Plays a single audio stream to the default output device using ffplay
 * and broadcasts it to WebSocket clients.
 * @param audioStream - A stream containing the audio data.
 * @param persona - The Magi persona speaking.
 */
async function playSingleAudioStream(audioStream: Stream, persona: MagiName): Promise<void> {
  const ffplay = spawn('ffplay', ['-i', '-', '-nodisp', '-autoexit']);
  
  // Create a pass-through stream to tee the audio data
  const teeStream = new PassThrough();
  
  // Buffer to collect audio data for WebSocket clients
  const audioChunks: Buffer[] = [];
  
  try {
    await new Promise<void>((resolve, reject) => {
      // Pipe audio to both ffplay and our tee stream
      audioStream.pipe(teeStream);
      teeStream.pipe(ffplay.stdin);

      // Collect audio chunks for WebSocket broadcasting
      teeStream.on('data', (chunk: Buffer) => {
        audioChunks.push(chunk);
        // Send chunks in real-time to WebSocket clients
        broadcastAudioToClients(chunk, persona, false);
      });

      teeStream.on('end', () => {
        // Send final notification to WebSocket clients
        const completeAudio = Buffer.concat(audioChunks);
        broadcastAudioToClients(Buffer.alloc(0), persona, true);
        logger.debug(`Audio streaming completed for ${persona}, sent ${audioChunks.length} chunks to clients`);
      });

      let stderr = '';
      ffplay.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      ffplay.on('error', (err) => {
        logger.error('Failed to start ffplay process.', err);
        reject(err);
      });

      ffplay.on('close', (code) => {
        if (code === 0) {
          logger.debug('ffplay process finished successfully.');
          resolve();
        } else {
          logger.error(`ffplay process exited with error code ${code}.`);
          logger.error('ffplay stderr:', stderr);
          reject(new Error(`ffplay exited with code ${code}`));
        }
      });

      teeStream.on('error', (err) => {
        logger.error('Error in tee stream', err);
        reject(err);
      });
    });
  } finally {
    // Ensure ffplay is killed if the promise is resolved or rejected.
    // This helps prevent orphaned processes.
    if (ffplay.exitCode === null) {
      ffplay.kill();
    }
  }
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
async function makeTTSRequest(text: string, persona: MagiName): Promise<Stream> {
  // No retry logic here, as we are handling it in the calling function.
  const response = await axios.post(
    `${TTS_API_BASE_URL}/api/generate-speech`,
    {
      text,
      persona,
      stream: true,
    },
    {
      responseType: 'stream',
      timeout: 60000, // 60-second timeout for a single sentence
    }
  );
  return response.data;
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
 * processing and streaming the audio sentence by sentence.
 * @param text - The full text to be spoken
 * @param persona - The Magi persona whose voice to use
 */
export async function speakWithMagiVoice(text: string, persona: MagiName): Promise<void> {
  try {
    validateInput(text);
    
    const isServiceRunning = await serviceManager.ensureTTSServiceRunning();
    if (!isServiceRunning) {
      throw new Error('Failed to start TTS service');
    }

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
              
              await playSingleAudioStream(audioStream, persona);

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