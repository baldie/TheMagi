import type { Magi } from './magi';
import type { MagiName } from '../types/magi-types';

export interface Memory {
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
Your goal is to identify the subject of the user's final message.

1.  First, analyze the final message on its own. If it contains a new and specific subject, prioritize it.
2.  If the message lacks a specific subject and seems to be a follow-up (e.g., uses pronouns like "he", "it", or asks a short question), use the conversation history to determine the subject.

What is the primary subject of the final message? Format as "The [aspect] of [subject]".
`.trim();

    try {
      const topic = await this.magi.contactSimple(topicDetectionPrompt, systemPrompt);
      
      return topic;
    } catch (error) {
      return `Error summarizing memories: ${error}`;
    }
  }

  public async summarize(forTopic: string | null): Promise<string> {
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
Provide an extractive summary of the CONTEXT entries${forTopic ? ' only if they are related to "' + forTopic + '"': ''}.
Focus on key information, decisions, and ongoing tasks.
Keep the summary concise but comprehensive:`;

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