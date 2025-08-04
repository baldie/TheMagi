import { Injectable } from '@angular/core';
import { AudioMessage } from './websocket.service';

interface WebkitWindow extends Window {
  webkitAudioContext: typeof AudioContext;
}

interface QueuedAudio {
  sequenceNumber: number;
  audioChunks: ArrayBuffer[];
  persona: string;
  isComplete: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AudioService {
  private audioContext: AudioContext | null = null;
  private isPlaying = false;
  private readonly mediaStream: MediaStream | null = null;
  private readonly audioQueue: Map<number, QueuedAudio> = new Map();
  private nextExpectedSequence = 0;
  private isProcessingQueue = false;

  constructor() {
    this.initializeAudioContext();
  }

  private initializeAudioContext(): void {
    try {
      this.audioContext = new (window.AudioContext || ((window as unknown) as WebkitWindow).webkitAudioContext)();
    } catch (error) {
      console.error('Failed to initialize AudioContext:', error);
    }
  }

  async playAudioMessage(audioMessage: AudioMessage): Promise<void> {
    if (!this.audioContext) {
      console.error('AudioContext not available');
      return;
    }

    try {
      const sequenceNumber = audioMessage.sequenceNumber;
      
      // Initialize queue entry if it doesn't exist
      if (!this.audioQueue.has(sequenceNumber)) {
        this.audioQueue.set(sequenceNumber, {
          sequenceNumber,
          audioChunks: [],
          persona: audioMessage.persona,
          isComplete: false
        });
      }

      const queuedAudio = this.audioQueue.get(sequenceNumber)!;
      
      // Decode base64 audio data and add to queue
      const audioData = this.base64ToArrayBuffer(audioMessage.audio);
      if (audioData.byteLength > 0) {
        queuedAudio.audioChunks.push(audioData);
      }

      // Mark as complete if this is the final chunk
      if (audioMessage.isComplete) {
        queuedAudio.isComplete = true;
        console.log(`Audio sequence ${sequenceNumber} is complete`);
      }

      // Try to process the queue
      await this.processAudioQueue();
    } catch (error) {
      console.error('Error processing audio message:', error);
    }
  }

  private async processAudioQueue(): Promise<void> {
    if (this.isProcessingQueue) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      // Process audio in sequence order
      while (this.audioQueue.has(this.nextExpectedSequence)) {
        const queuedAudio = this.audioQueue.get(this.nextExpectedSequence)!;
        
        // Only play if the audio is complete
        if (queuedAudio.isComplete) {
          console.log(`Playing audio sequence ${this.nextExpectedSequence}`);
          await this.playQueuedAudio(queuedAudio);
          this.audioQueue.delete(this.nextExpectedSequence);
          this.nextExpectedSequence++;
        } else {
          // Wait for this sequence to be complete
          break;
        }
      }
    } catch (error) {
      console.error('Error processing audio queue:', error);
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private async playQueuedAudio(queuedAudio: QueuedAudio): Promise<void> {
    if (!this.audioContext || queuedAudio.audioChunks.length === 0) {
      return;
    }

    try {
      // Concatenate all audio chunks
      const totalLength = queuedAudio.audioChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const concatenatedBuffer = new ArrayBuffer(totalLength);
      const view = new Uint8Array(concatenatedBuffer);
      
      let offset = 0;
      for (const chunk of queuedAudio.audioChunks) {
        view.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
      }

      // Decode and play the audio
      const audioBuffer = await this.audioContext.decodeAudioData(concatenatedBuffer);
      await this.playAudioBuffer(audioBuffer);
    } catch (error) {
      console.error('Error playing queued audio:', error);
    }
  }

  private async playAudioBuffer(audioBuffer: AudioBuffer): Promise<void> {
    if (!this.audioContext) {
      console.error('AudioContext not initialized');
      return;
    }

    // Wait for previous audio to finish
    while (this.isPlaying) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    return new Promise<void>((resolve, reject) => {
      try {
        const source = this.audioContext!.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext!.destination);
        
        this.isPlaying = true;
        
        source.onended = () => {
          this.isPlaying = false;
          resolve();
        };
        
        source.start(0);
      } catch (error) {
        console.error('Error playing audio:', error);
        this.isPlaying = false;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    if (!base64) {
      return new ArrayBuffer(0);
    }
    
    const binaryString = window.atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    return bytes.buffer;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public async resumeAudioContext(): Promise<void> {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  public resetAudioQueue(): void {
    this.audioQueue.clear();
    this.nextExpectedSequence = 0;
    this.isProcessingQueue = false;
    console.log('Audio queue reset');
  }

  async startRecording() {
    if (!this.audioContext || !this.mediaStream) {
      console.error('AudioContext or MediaStream not initialized');
      return;
    }
    
    const source = this.audioContext.createMediaStreamSource(this.mediaStream);

    // Register the audio worklet processor if not already registered
    if (!this.audioContext.audioWorklet) {
      console.error('AudioWorklet is not supported in this browser.');
      return;
    }

    // Define a simple processor if not already loaded
    try {
      // You may want to move this to a separate file for production use
      const processorCode = `
        class RecorderProcessor extends AudioWorkletProcessor {
          process(inputs, outputs, parameters) {
            // Implement your recording logic here
            return true;
          }
        }
        registerProcessor('recorder-processor', RecorderProcessor);
      `;
      const blob = new Blob([processorCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      await this.audioContext.audioWorklet.addModule(url);
    } catch  {
      // Ignore if already loaded
    }

    const processor = new AudioWorkletNode(this.audioContext, 'recorder-processor');

    source.connect(processor);
    processor.connect(this.audioContext.destination);

    // ... rest of the code ...
  }
}