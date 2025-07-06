import { Injectable } from '@angular/core';
import { AudioMessage } from './websocket.service';

interface WebkitWindow extends Window {
  webkitAudioContext: typeof AudioContext;
}

@Injectable({
  providedIn: 'root'
})
export class AudioService {
  private audioContext: AudioContext | null = null;
  private currentAudioChunks: ArrayBuffer[] = [];
  private isPlaying = false;
  private isRecording = false;
  private mediaStream: MediaStream | null = null;

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
      // Decode base64 audio data
      const audioData = this.base64ToArrayBuffer(audioMessage.audio);
      
      if (audioData.byteLength > 0) {
        this.currentAudioChunks.push(audioData);
      }

      // If this is the complete message, play all accumulated chunks
      if (audioMessage.isComplete && this.currentAudioChunks.length > 0) {
        await this.playAccumulatedAudio();
        this.currentAudioChunks = [];
      }
    } catch (error) {
      console.error('Error playing audio:', error);
    }
  }

  private async playAccumulatedAudio(): Promise<void> {
    if (!this.audioContext || this.currentAudioChunks.length === 0) {
      return;
    }

    try {
      // Concatenate all audio chunks
      const totalLength = this.currentAudioChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const concatenatedBuffer = new ArrayBuffer(totalLength);
      const view = new Uint8Array(concatenatedBuffer);
      
      let offset = 0;
      for (const chunk of this.currentAudioChunks) {
        view.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
      }

      // Decode and play the audio
      const audioBuffer = await this.audioContext.decodeAudioData(concatenatedBuffer);
      await this.playAudioBuffer(audioBuffer);
    } catch (error) {
      console.error('Error playing accumulated audio:', error);
    }
  }

  private async playAudioBuffer(audioBuffer: AudioBuffer): Promise<void> {
    if (!this.audioContext) {
      console.error('AudioContext not initialized');
      return;
    }

    try {
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);
      source.start(0);
      this.isPlaying = true;
      
      source.onended = () => {
        this.isPlaying = false;
      };
    } catch (error) {
      console.error('Error playing audio:', error);
      this.isPlaying = false;
    }
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

  async startRecording() {
    if (!this.audioContext || !this.mediaStream) {
      console.error('AudioContext or MediaStream not initialized');
      return;
    }
    
    const source = this.audioContext.createMediaStreamSource(this.mediaStream);
    const processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    
    source.connect(processor);
    processor.connect(this.audioContext.destination);
    
    this.isRecording = true;
    // ... rest of the code ...
  }
}