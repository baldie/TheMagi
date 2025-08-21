import { promises as fs } from 'fs';
import path from 'path';

/**
 * Memory interfaces for The Magi system
 */
export interface MagiMemory {
  facts: string[];
  preferences: string[];
  context: string[];
  outcomes: string[];
}

export interface UserMemory {
  caspar_memory: MagiMemory;
  melchior_memory: MagiMemory;
  balthazar_memory: MagiMemory;
  shared_memory: {
    decisions: string[];
    topics: string[];
  };
  last_updated: string;
}

/**
 * Memory service for The Magi system
 * Handles storage and retrieval of conversation context and learnings
 */
interface Logger {
  info(message: string, data?: unknown): void;
  debug(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, error?: unknown): void;
}

export class MemoryService {
  private memoryPath: string;
  private logger: Logger;

  constructor(logger: Logger) {
    this.memoryPath = path.join(process.cwd(), 'data', 'memory.json');
    this.logger = logger;
    
    // Ensure memory directory exists
    const memoryDir = path.dirname(this.memoryPath);
    fs.mkdir(memoryDir, { recursive: true }).catch(error => {
      this.logger.error('Failed to initialize memory system:', error);
    });
  }


  /**
   * Load user memory from storage
   */
  async loadUserMemory(): Promise<UserMemory> {
    try {
      const data = await fs.readFile(this.memoryPath, 'utf8');
      const memory = JSON.parse(data) as UserMemory;
      this.logger.debug('User memory loaded successfully');
      return memory;
    } catch (error) {
      // If file doesn't exist, return empty memory structure
      this.logger.info(`No existing memory found, creating new memory structure: ${String(error)}`);
      return this.createEmptyMemory();
    }
  }

  /**
   * Save user memory to storage
   */
  async saveUserMemory(memory: UserMemory): Promise<void> {
    try {
      memory.last_updated = new Date().toISOString();
      await fs.writeFile(this.memoryPath, JSON.stringify(memory, null, 2));
      this.logger.debug('User memory saved successfully');
    } catch (error) {
      this.logger.error('Failed to save user memory:', error);
      throw error;
    }
  }

  /**
   * Extract memory from a Magi response
   */
  extractMemoryFromResponse(response: string): MagiMemory {
    try {
      // Look for JSON structure in response
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
      this.logger.warn('Failed to extract structured memory from response:', error);
    }

    // Fallback: return empty memory structure
    return {
      facts: [],
      preferences: [],
      context: [],
      outcomes: []
    };
  }

  /**
   * Generate memory context for a Magi persona
   */
  generateMemoryContext(memory: UserMemory, persona: 'caspar' | 'melchior' | 'balthazar'): string {
    const personalMemory = memory[`${persona}_memory`];
    const sharedMemory = memory.shared_memory;

    let context = 'Previous conversation memory:\n';
    
    if (personalMemory.facts.length > 0) {
      context += `Facts: ${personalMemory.facts.join(', ')}\n`;
    }
    
    if (personalMemory.preferences.length > 0) {
      context += `Preferences: ${personalMemory.preferences.join(', ')}\n`;
    }
    
    if (personalMemory.context.length > 0) {
      context += `Context: ${personalMemory.context.join(', ')}\n`;
    }
    
    if (personalMemory.outcomes.length > 0) {
      context += `Past outcomes: ${personalMemory.outcomes.join(', ')}\n`;
    }
    
    if (sharedMemory.decisions.length > 0) {
      context += `Shared decisions: ${sharedMemory.decisions.join(', ')}\n`;
    }
    
    if (sharedMemory.topics.length > 0) {
      context += `Previous topics: ${sharedMemory.topics.join(', ')}\n`;
    }

    return context;
  }

  /**
   * Create memory extraction prompt for a Magi
   */
  createMemoryExtractionPrompt(inquiry: string, deliberationTranscript: string): string {
    return `Based on this conversation with the user, identify key information that should be remembered for future interactions.

User inquiry: "${inquiry}"

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
   * Update memory with new information from all Magi
   */
  async updateMemory(
    casparMemory: MagiMemory,
    melchiorMemory: MagiMemory,
    balthazarMemory: MagiMemory,
    sharedDecisions: string[] = [],
    newTopics: string[] = []
  ): Promise<void> {
    const currentMemory = await this.loadUserMemory();

    // Merge new memory with existing memory
    currentMemory.caspar_memory = this.mergeMemory(currentMemory.caspar_memory, casparMemory);
    currentMemory.melchior_memory = this.mergeMemory(currentMemory.melchior_memory, melchiorMemory);
    currentMemory.balthazar_memory = this.mergeMemory(currentMemory.balthazar_memory, balthazarMemory);

    // Update shared memory
    currentMemory.shared_memory.decisions = [...new Set([...currentMemory.shared_memory.decisions, ...sharedDecisions])];
    currentMemory.shared_memory.topics = [...new Set([...currentMemory.shared_memory.topics, ...newTopics])];

    await this.saveUserMemory(currentMemory);
  }

  /**
   * Merge new memory with existing memory, avoiding duplicates
   */
  private mergeMemory(existing: MagiMemory, newMemory: MagiMemory): MagiMemory {
    return {
      facts: [...new Set([...existing.facts, ...newMemory.facts])],
      preferences: [...new Set([...existing.preferences, ...newMemory.preferences])],
      context: [...new Set([...existing.context, ...newMemory.context])],
      outcomes: [...new Set([...existing.outcomes, ...newMemory.outcomes])]
    };
  }

  /**
   * Store a single fact for Melchior
   */
  async storeFact(fact: string): Promise<void> {
    try {
      const currentMemory = await this.loadUserMemory();
      
      // Add fact to Melchior's memory if not already present
      if (!currentMemory.melchior_memory.facts.includes(fact)) {
        currentMemory.melchior_memory.facts.push(fact);
        currentMemory.last_updated = new Date().toISOString();
        await this.saveUserMemory(currentMemory);
        this.logger.info(`Stored fact in Melchior's memory: ${fact}`);
      }
    } catch (error) {
      this.logger.error('Failed to store fact:', error);
    }
  }

  /**
   * Create empty memory structure
   */
  private createEmptyMemory(): UserMemory {
    return {
      caspar_memory: { facts: [], preferences: [], context: [], outcomes: [] },
      melchior_memory: { facts: [], preferences: [], context: [], outcomes: [] },
      balthazar_memory: { facts: [], preferences: [], context: [], outcomes: [] },
      shared_memory: { decisions: [], topics: [] },
      last_updated: new Date().toISOString()
    };
  }
}