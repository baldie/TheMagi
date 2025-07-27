import { Magi } from './magi';
import { MagiName } from '../types/magi-types';
import { sys } from 'node_modules/typescript/lib/typescript';

export interface Memory {
  scratchpad: string;
  speaker: MagiName | 'user';
  message: string;
}

export class ShortTermMemory {
  private static readonly MAX_MEMORIES = 15;
  private memories: Memory[] = [];
  private magi: Magi;
  private lastSummary: string = '';
  private lastSummaryHash: string = '';

  constructor(magi: Magi) {
    this.magi = magi;
  }

  public remember(
    speaker: MagiName | 'user',
    scratchpad: string,
    message: string
  ): void {
    const memory: Memory = {
      scratchpad,
      speaker,
      message
    };

    this.memories.push(memory);
    
    // Implement sliding window - keep only the most recent MAX_MEMORIES
    if (this.memories.length > ShortTermMemory.MAX_MEMORIES) {
      this.memories = this.memories.slice(-ShortTermMemory.MAX_MEMORIES);
    }
    
    // Invalidate cached summary when memories change
    this.lastSummaryHash = '';
  }

  public getMemories(): Memory[] {
    return this.memories;
  }

  public forget(): void {
    this.memories = [];
    this.lastSummary = '';
    this.lastSummaryHash = '';
  }

  public async summarize(): Promise<string> {
    const memories = this.memories;
    
    if (memories.length === 0) {
      return '';
    }

    // Check if we can use cached summary
    const currentHash = this.getMemoriesHash();
    if (currentHash === this.lastSummaryHash && this.lastSummary) {
      return this.lastSummary;
    }

    const memoryText = memories.map((memory, index) => 
      `Memory ${index + 1}:
Speaker: ${memory.speaker}
Scratchpad: ${memory.scratchpad}
Message: ${memory.message}
---`
    ).join('\n');

    const systemPrompt = `PERSONA\nYou ${this.magi.name}, are a helpful assistant that creates concise extractive summaries.`;
    const summarizationPrompt = `
INSTRUCTIONS:
Please provide an extractive summary of the following short-term memories for context.
Focus on key information, decisions, and ongoing tasks.
Keep the summary concise but comprehensive:

${memoryText}

Provide a clear, organized summary that captures the essential information from these memories. When referring to ${this.magi.name}, that is you so speak in the first person. No other text`;

    try {
      const summary = await this.magi.contactSimple(summarizationPrompt, systemPrompt);
      
      // Cache the summary
      this.lastSummary = summary;
      this.lastSummaryHash = currentHash;
      
      return summary;
    } catch (error) {
      return `Error summarizing memories: ${error}`;
    }
  }

  private getMemoriesHash(): string {
    // Simple hash based on memory count and last message
    const lastMemory = this.memories[this.memories.length - 1];
    return `${this.memories.length}-${lastMemory?.message?.slice(0, 20) || ''}`;
  }
}