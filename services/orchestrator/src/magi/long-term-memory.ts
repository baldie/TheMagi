import { promises as fs } from 'fs';
import path from 'path';
import type { MagiName } from '../types/magi-types';
import { logger } from '../logger';

/**
 * Private memory interfaces (internal implementation details)
 */
interface MagiMemory {
  facts: string[];
  preferences: string[];
  context: string[];
  outcomes: string[];
  last_updated: string;
}


// Minimal interface to avoid tight coupling
interface MemoryMagiLike {
  name: MagiName;
  contactSimple(message: string, systemPrompt?: string): Promise<string>;
}

/**
 * Long-term memory system for individual Magi
 * Encapsulates all memory storage, retrieval, and management logic
 */
export class LongTermMemory {
  private readonly magi: MemoryMagiLike;
  private readonly memoryPath: string;

  constructor(magi: MemoryMagiLike) {
    this.magi = magi;
    this.memoryPath =path.join(process.cwd(), 'data', `${magi.name.toLowerCase()}-memory.json`);
  }

  /**
   * Initialize the memory system
   */
  async initialize(): Promise<void> {
    const memoryDir = path.dirname(this.memoryPath);
    try {
      await fs.mkdir(memoryDir, { recursive: true });
      await this.loadMemory(); // Ensure memory file exists
    } catch (error) {
      logger.error(`Failed to initialize memory system for ${this.magi.name}:`, error);
    }
  }

  /**
   * Get relevant context for the current topic
   */
  public async getRelevantContext(currentTopic: string): Promise<string> {
    try {
      const memory = await this.loadMemory();
      
      const systemPrompt = `PERSONA
You are an expert memory analyst for ${this.magi.name}. Your task is to extract and return only the most relevant information from the user's long-term memory that pertains to the current topic.`;

      const summarizeRelevantContextPrompt = `CURRENT TOPIC: "${currentTopic}"

USER'S LONG-TERM MEMORY:
Facts: ${JSON.stringify(memory.facts)}
Preferences: ${JSON.stringify(memory.preferences)}  
Past Outcomes: ${JSON.stringify(memory.outcomes)}
Context: ${JSON.stringify(memory.context)}

INSTRUCTIONS:
Scan through all the memory categories above and return only the information that is directly relevant to "${currentTopic}". 
Focus on:
1. Facts that relate to the current topic
2. User preferences that might influence the current topic
3. Past outcomes from similar situations
4. Relevant context from previous interactions

Format your response as a concise summary that provides context for the current topic. If no relevant information is found, return "No relevant long-term memory found for this topic."`;

      const relevantContext = await this.magi.contactSimple(summarizeRelevantContextPrompt, systemPrompt);
      return relevantContext;
    } catch (error) {
      return `Error retrieving relevant context: ${error}`;
    }
  }

  /**
   * Store memory from a deliberation transcript
   */
  public async storeMemoryFromDeliberation(message: string, transcript: string): Promise<void> {
    try {
      const extractionPrompt = this.createMemoryExtractionPrompt(message, transcript);
      const response = await this.magi.contactSimple(extractionPrompt);
      const extractedMemory = this.extractMemoryFromResponse(response);
      
      if (this.hasValidMemoryContent(extractedMemory)) {
        await this.updateMemory(extractedMemory);
        logger.debug(`Memory updated for ${this.magi.name} from deliberation`);
      }
    } catch (error) {
      logger.error(`Failed to store memory from deliberation for ${this.magi.name}:`, error);
    }
  }

  /**
   * Add a single fact to memory
   */
  public async addFact(fact: string): Promise<void> {
    try {
      const memory = await this.loadMemory();
      
      if (!memory.facts.includes(fact)) {
        memory.facts.push(fact);
        await this.saveMemory(memory);
        logger.info(`Stored fact in ${this.magi.name}'s memory: ${fact}`);
      }
    } catch (error) {
      logger.error(`Failed to store fact for ${this.magi.name}:`, error);
    }
  }

  /**
   * Load memory from storage (private)
   */
  private async loadMemory(): Promise<MagiMemory> {
    try {
      const data = await fs.readFile(this.memoryPath, 'utf8');
      const memory = JSON.parse(data) as MagiMemory;
      logger.debug(`Memory loaded successfully for ${this.magi.name}`);
      return memory;
    } catch (error) {
      logger.info(`No existing memory found for ${this.magi.name}, creating new memory structure: ${String(error)}`);
      return this.createEmptyMemory();
    }
  }

  /**
   * Save memory to storage (private)
   */
  private async saveMemory(memory: MagiMemory): Promise<void> {
    try {
      memory.last_updated = new Date().toISOString();
      await fs.writeFile(this.memoryPath, JSON.stringify(memory, null, 2));
      logger.debug(`Memory saved successfully for ${this.magi.name}`);
    } catch (error) {
      logger.error(`Failed to save memory for ${this.magi.name}:`, error);
      throw error;
    }
  }

  /**
   * Extract memory from a Magi response (private)
   */
  private extractMemoryFromResponse(response: string): Partial<MagiMemory> {
    try {
      const jsonRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/;
      const jsonMatch = jsonRegex.exec(response);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          facts: parsed.facts || [],
          preferences: parsed.preferences || [],
          context: parsed.context || [],
          outcomes: parsed.outcomes || []
        };
      }
    } catch (error) {
      logger.warn(`Failed to extract structured memory from response for ${this.magi.name}:`, error);
    }

    return { facts: [], preferences: [], context: [], outcomes: [] };
  }

  /**
   * Create memory extraction prompt (private)
   */
  private createMemoryExtractionPrompt(message: string, deliberationTranscript: string): string {
    return `Based on this conversation with the user, identify key information that should be remembered for future interactions.

User inquiry: "${message}"

Conversation transcript:
${deliberationTranscript}

Please extract important information and format as JSON with these categories:
{
  "facts": ["factual information about the user"],
  "preferences": ["user preferences and likes/dislikes"],
  "context": ["situational context and background"],
  "outcomes": ["results of recommendations or decisions"]
}

Focus on information that would be useful for future conversations. Be concise and specific.`;
  }

  /**
   * Update memory with new information (private)
   */
  private async updateMemory(newMemory: Partial<MagiMemory>): Promise<void> {
    const currentMemory = await this.loadMemory();
    const mergedMemory = this.mergeMemory(currentMemory, newMemory);
    await this.saveMemory(mergedMemory);
  }

  /**
   * Merge new memory with existing memory, avoiding duplicates (private)
   */
  private mergeMemory(existing: MagiMemory, newMemory: Partial<MagiMemory>): MagiMemory {
    return {
      facts: [...new Set([...existing.facts, ...(newMemory.facts || [])])],
      preferences: [...new Set([...existing.preferences, ...(newMemory.preferences || [])])],
      context: [...new Set([...existing.context, ...(newMemory.context || [])])],
      outcomes: [...new Set([...existing.outcomes, ...(newMemory.outcomes || [])])],
      last_updated: new Date().toISOString()
    };
  }

  /**
   * Create empty memory structure (private)
   */
  private createEmptyMemory(): MagiMemory {
    return {
      facts: [],
      preferences: [],
      context: [],
      outcomes: [],
      last_updated: new Date().toISOString()
    };
  }

  /**
   * Check if extracted memory has valid content (private)
   */
  private hasValidMemoryContent(memory: Partial<MagiMemory>): boolean {
    return (
      (memory.facts?.length ?? 0) > 0 ||
      (memory.preferences?.length ?? 0) > 0 ||
      (memory.context?.length ?? 0) > 0 ||
      (memory.outcomes?.length ?? 0) > 0
    );
  }
}