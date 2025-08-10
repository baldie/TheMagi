import type { MagiName } from '../types/magi-types';

// Minimal interface to avoid tight coupling
interface MemoryMagiLike {
  name: MagiName;
  contactSimple(userPrompt: string, systemPrompt?: string): Promise<string>;
}

export interface Memory {
  speaker: MagiName | 'user';
  message: string;
}

export class ShortTermMemory {
  private static readonly MAX_MEMORIES = 15;
  private memories: Memory[] = [];
  private readonly magi: MemoryMagiLike;
  private lastSummary: string = '';
  private lastSummaryHash: string = '';

  constructor(magi: MemoryMagiLike) {
    this.magi = magi;
  }

  public remember(
    speaker: MagiName | 'user',
    message: string
  ): void {
    const memory: Memory = {
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

  public async determineTopic(userMessage: string): Promise<string | null> {
    if (this.memories.length === 0) {
      return null;
    }

    if (userMessage.trim() === '')
      return null;

    const memoryText = `Conversation History:` +
      this.memories.map((memory) => `
Speaker: ${memory.speaker}
Message: ${memory.message}
`
    ).join('\n');

    const systemPrompt = `PERSONA\nYou are an expert at analyzing conversational flow. Your task is to identify the precise subject of the user's latest message in the context of the preceding discussion.`;
    const topicDetectionPrompt = `${memoryText}
Speaker: User
Message: ${userMessage}

INSTRUCTIONS:
Your goal is to identify the subject of the user's last message.

1. First, analyze the last message on its own. If it contains a new and specific subject, prioritize it.
2. If the message lacks a specific subject and seems to be a follow-up, use the conversation history to determine the subject.

What is the primary subject of the user's last message? Be specific and complete in your answer. Format as "The [aspect] of [subject]".
`.trim();

    try {
      const topic = await this.magi.contactSimple(topicDetectionPrompt, systemPrompt);
      
      return topic;
    } catch (error) {
      return `Error summarizing memories: ${error}`;
    }
  }

  public async summarize(_forTopic: string | null): Promise<string> {
    const memories = this.memories;
    
    if (memories.length === 0) {
      return '';
    }

    // Check if we can use cached summary
    const currentHash = this.getMemoriesHash();
    if (currentHash === this.lastSummaryHash && this.lastSummary) {
      return this.lastSummary;
    }

    const memoryText = memories.map((memory) => `Speaker: ${memory.speaker}\nMessage: ${memory.message}`).join('\n');
    const systemPrompt = `PERSONA\nYou ${this.magi.name}, are a helpful assistant that creates concise extractive summaries.`;
    const summarizationPrompt = `CONTEXT:
${memoryText}
    
INSTRUCTIONS:
First, create a concise extractive summary of the conversation so far.
Then, from ${this.magi.name}'s perspective (using "I"), briefly describe what the user said and what you did and said in reply.`;

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