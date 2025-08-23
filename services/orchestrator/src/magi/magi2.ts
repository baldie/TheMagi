import { type ActorRefFrom, createActor, waitFor } from 'xstate';
import { agentMachine, type AgentMachine } from './agent-machine';
import { plannerMachine, type PlannerMachine } from './planner-machine';
import { ConduitClient } from './conduit-client';
import { ToolUser } from './tool-user';
import { ShortTermMemory } from './short-term-memory';
import { MagiName } from '../types/magi-types';
import type { MagiTool } from '../mcp';
import type {
  PlannerContext,
  AgentContext,
  PlannerEvent,
  AgentEvent
} from './types';
import path from 'path';
import type { ModelType } from '../config';
import { Model } from '../config';
import { logger } from '../logger';
import fs from 'fs/promises';
import { MagiErrorHandler } from './error-handler';
import type { MessageParticipant } from '../types/magi-types';
export { MagiName };

/**
 * Creates a configured planner machine with proper context injection
 */
export function createConfiguredPlannerMachine(_magiName: MagiName, _userMessage: string) {
  return plannerMachine.provide({
    actors: {
      agentMachine: agentMachine
    },
    guards: {
      // Add any magi-specific guards here if needed
    },
    actions: {
      // Add any magi-specific actions here if needed
    },
    delays: {
      // Add any magi-specific delays here if needed
    }
  });
}

/**
 * Creates a configured agent machine with proper context injection
 */
export function createConfiguredAgentMachine(
  _strategicGoal: string,
  _magiName: MagiName,
  _conduitClient: ConduitClient,
  _toolUser: ToolUser,
  _availableTools: MagiTool[]
) {
  return agentMachine.provide({
    actors: {
      // Add any magi-specific actors here if needed
    },
    guards: {
      // Add any magi-specific guards here if needed
    },
    actions: {
      // Add any magi-specific actions here if needed
    },
    delays: {
      // Add any magi-specific delays here if needed
    }
  });
}

// Re-export machines and types
export { agentMachine, plannerMachine };
export type { AgentMachine, PlannerMachine };
export type PlannerActor = ActorRefFrom<PlannerMachine>;
export type AgentActor = ActorRefFrom<AgentMachine>;

// Re-export types for external usage
export type {
  PlannerContext,
  AgentContext,
  PlannerEvent,
  AgentEvent
};

/**
 * Interface for the configuration of a single Magi persona.
 */
interface MagiConfig {
  model: ModelType;
  personalitySource: string;
  strategicPersonaInstructions: string;
  strategicPlanExamples: string;
  executeGoalPrompt: string;
  options: {
    temperature: number;
  };
}

export type AgenticTool = { name: string; parameters: Record<string, unknown>};

export interface AgenticResponse {
  tool: AgenticTool;
}

export const PERSONAS_CONFIG: Record<MagiName, MagiConfig> = {
  [MagiName.Balthazar]: {
    model: Model.Llama,
    personalitySource: path.resolve(__dirname, 'personalities', 'Balthazar.md'),
    strategicPersonaInstructions: ``,
    strategicPlanExamples: `EXAMPLE 3:
message: "Who is the CEO of American Express?"
{"plan": ["Search web for keywords related to American Express CEO", "Extract content from most relevant search result URL", "Respond with the answer"]}

EXAMPLE 4:
message: "What should I make for dinner?"
{"plan": ["Search web for keywords related to dinner recommendations", "Extract content from most relevant search result URL", "Respond with the answer"]}

EXAMPLE 5:
message: "What is the weather like this weekend in Menlo Park?"
{"plan": ["Search web for keywords related to weather forecast in Menlo Park", "Extract content from most relevant search result URL", "Respond with the answer"]}`,
    executeGoalPrompt: `[PLACEHOLDER] Goal execution prompt for Balthazar`,
    options: { temperature: 0.4 },
  },
  [MagiName.Melchior]: {
    model: Model.Gemma,
    personalitySource: path.resolve(__dirname, 'personalities', 'Melchior.md'),
    strategicPersonaInstructions: `The user has consented to you accessing their personal data. There is useful information available in there about the user and their preferences. It is recommended that you access that first before asking the user for information that might be contained within.`,
    strategicPlanExamples: `EXAMPLE 3:
message: "Recommend a good movie for me to watch tonight."
{"plan": ["Search personal data for movie preferences", "Search web for highly-rated movies matching preferences", "Extract content from most relevant search result URL", "Respond with a list of movie recommendations"]}

EXAMPLE 4:
message: "No, I don't like horror movies. Suggest something else."
{"plan": ["Update user's movie preferences", "Collect a list of recommendations that are not in the horror genre", "Respond with updated list of movie recommendations"]}

EXAMPLE 5:
message: "My favorite color is blue."
{"plan": ["Save 'blue' as the user's favorite color in personal data", "Acknowledge that the preference has been saved"]}`,
    executeGoalPrompt: `[PLACEHOLDER] Goal execution prompt for Melchior`,
    options: { temperature: 0.6 },
  },
  [MagiName.Caspar]: {
    model: Model.Qwen,
    personalitySource: path.resolve(__dirname, 'personalities', 'Caspar.md'),
    strategicPersonaInstructions: ``,
    strategicPlanExamples: `EXAMPLE 3:
message: "Turn off the lights in the living room."
{"plan": ["Search smart home devices for light controls", "Send command to turn off living room lights", "Respond with confirmation that lights are off"]}

EXAMPLE 4:
message: "Where is Lucky?"
{"plan": ["Search memory for image of Lucky", "Search smart home devices for webcams", "Check each webcam for Lucky and if found note location", "Respond to user with Lucky's location if found, otherwise inform user that Lucky could not be located"]}

EXAMPLE 5:
message: "Play my favorite playlist"
{"plan": ["Search smart home devices for smart speakers", "Confirm device is available and powered on", "Send command to play favorite songs playlist", "Respond with confirmation that playlist is playing"]}`,
    executeGoalPrompt: `[PLACEHOLDER] Goal execution prompt for Caspar`,
    options: { temperature: 0.5 },
  },
};

// Interface for ToolUser and ShortTermMemory compatibility
interface MagiCompatible {
  name: MagiName;
  withPersonality(systemPrompt: string): string;
  contactWithMemory(speaker: MessageParticipant, message: string): Promise<string>;
  contactSimple(userPrompt: string, systemPrompt?: string): Promise<string>;
  forget(): void;
  ensureInitialized(): Promise<void>;
}

/**
 * The Magi2 class represents a single AI persona within the Magi system.
 * It uses composition to communicate through a ConduitClient and XState machines.
 */
export class Magi2 implements MagiCompatible {
  private personalityPrompt: string = '';
  private status: 'available' | 'busy' | 'offline' = 'offline';
  private readonly toolUser: ToolUser;
  private toolsList: MagiTool[] = [];
  private readonly conduit: ConduitClient;
  private readonly shortTermMemory: ShortTermMemory;
  
  constructor(public name: MagiName, private readonly config: MagiConfig) {
    this.conduit = new ConduitClient(name);
    this.toolUser = new ToolUser(this);
    this.shortTermMemory = new ShortTermMemory(this);
  }

  public async ensureInitialized(): Promise<void> {
    // If already initialized (prompt + tools), do nothing
    if (this.personalityPrompt && this.toolsList.length > 0) {
      return;
    }
    try {
      const src = PERSONAS_CONFIG[this.name].personalitySource;
      const prompt = await fs.readFile(src, 'utf-8');
      await this.initialize(prompt);
      logger.info(`${this.name} lazily initialized.`);
    } catch (err) {
      logger.warn(`${this.name} lazy initialization failed`, err);
    }
  }

  /**
   * Initialize the Magi
   */
  async initialize(prompt: string): Promise<void> {
    this.personalityPrompt = prompt;
    this.toolsList = await this.toolUser.getAvailableTools();
    logger.info(`${this.name} initialized with the following tools: ${this.toolsList.map(tool => tool.name).join(', ')}.`);
  }

    /**
   * Retrieves the cached personality prompt.
   * @throws If the prompt has not been loaded yet.
   */
  withPersonality(systemInstructionsPrompt: string): string {
    if (!this.personalityPrompt) {
      const err = new Error(`Attempted to access personality for ${this.name}, but it has not been cached.`);
      logger.error('Prompt retrieval error', err);
      throw err;
    }
    return `${this.personalityPrompt}\n\n${systemInstructionsPrompt}`;
  }

  public getStatus(): 'available' | 'busy' | 'offline' {
    return this.status;
  }

  async contactWithMemory(speaker: MessageParticipant, message: string): Promise<string> {
    await this.ensureInitialized();
    const currentTopic = await this.shortTermMemory.determineTopic(speaker, message);
    const workingMemory = await this.shortTermMemory.summarize(currentTopic);
    const promptWithContext = workingMemory + '\n' + message;
    const response = await this.executeWithStatusManagement(async () => 
      this.conduit.contact(promptWithContext, this.withPersonality(''), this.config.model, this.config.options)
    );
    
    // Store the interaction in short-term memory
    try {
      this.shortTermMemory.remember(speaker, message);
      this.shortTermMemory.remember(this.name, response);
    } catch (memoryError) {
      logger.error(`Critical memory failure for ${this.name}:`, memoryError);
      // Re-throw if memory is critical for this operation
      if (memoryError instanceof Error && memoryError.message.includes('critical')) {
        throw new Error(`Memory storage failed: ${memoryError.message}`);
      }
      // Continue execution for non-critical memory failures
    }
    
    return response;
  }

  /**
    * Simple contact method without memory context
  */
  async contactSimple(userPrompt: string, systemPrompt?: string): Promise<string> {
    await this.ensureInitialized();
    return this.executeWithStatusManagement(async () => 
      this.conduit.contact(userPrompt, systemPrompt ?? '', this.config.model, this.config.options)
    );
  }

  public forget(): void {
    this.shortTermMemory.forget();
  }

  private async waitForActorCompletion(plannerActor: any): Promise<string> {
    const finalState = await waitFor(plannerActor, (snapshot) => snapshot.status === 'done');
    
    // Get output from state configuration if finalState.output is undefined
    const currentStateValue = typeof finalState.value === 'string' ? finalState.value : Object.keys(finalState.value)[0];
    const stateConfig = finalState.machine.config.states[currentStateValue];
    
    const output = (stateConfig && typeof stateConfig.output === 'function') 
      ? stateConfig.output({ context: finalState.context })
      : finalState.output;

    if (!output) {
      throw new Error('Actor completed but produced no output');
    }

    if (output.error) {
      throw new Error(output.error);
    }

    return output.result ?? 'Task completed successfully.';
  }

  public async contactAsAgent(message: string, sender: MessageParticipant, _prohibitedTools: string[] = []): Promise<string> {
    try {
      await this.ensureInitialized();
      
      // Validate initialization completed successfully
      if (!this.personalityPrompt || this.toolsList.length === 0) {
        throw new Error(`${this.name} initialization incomplete - missing personality or tools`);
      }
      
      logger.info(`${this.name} beginning state machine agentic loop...`);
      // Create planner machine with proper context
      const plannerMachine = createConfiguredPlannerMachine(this.name, message);

      return await this.executeWithStatusManagement(async () => {
        // Initialize memory context
        const currentTopic = await this.shortTermMemory.determineTopic(sender, message);
        const workingMemory = await this.shortTermMemory.summarize(currentTopic);

        // Create and start the planner actor
        const plannerActor = createActor(plannerMachine, {
          input: {
            message,
            magiName: this.name,
            conduitClient: this.conduit,
            toolUser: this.toolUser,
            availableTools: this.toolsList.filter(tool => !_prohibitedTools.includes(tool.name)),
            workingMemory
          }
        });

        // Start the actor and wait for completion
        plannerActor.start();
        
        // Wait for the machine to complete
        const response = await this.waitForActorCompletion(plannerActor);
        this.shortTermMemory.remember(sender, message);
        this.shortTermMemory.remember(this.name, response);

        return response;
      });
    } catch (error) {
      logger.error(`ERROR: ${error}`);
      throw MagiErrorHandler.createContextualError(error, {
        magiName: this.name,
        operation: 'agentic loop'
      });
    }
  }

  /**
   * Executes a contact operation with proper status management
   */
  private async executeWithStatusManagement<T>(operation: () => Promise<T>): Promise<T> {
    this.status = 'busy';
    
    try {
      const result = await operation();
      this.status = 'available';
      return result;
    } catch (error) {
      this.status = 'available';
      throw error;
    }
  }

  async makeTTSReady(text: string): Promise<string> {
    await this.ensureInitialized();
    const systemPrompt = `ROLE & GOAL
You are a direct transcription and vocalization engine. Your sole function is to take a TEXT PASSAGE and convert it verbatim into a SPOKEN SCRIPT for a Text-to-Speech (TTS) engine. Your output must preserve the original text's structure and intent, simply making it readable for a voice synthesizer.
`;

    const userPrompt = `
INSTRUCTIONS
Receive the TEXT PASSAGE.
Convert it directly into a SPOKEN SCRIPT.
The script must be ready for immediate TTS playback.
Preserve the original meaning and all data points without adding, removing, or changing the core message.

CORE RULES
CRITICAL RULE: DO NOT ANSWER OR RESPOND. Your task is to convert, not to have a conversation. Treat the TEXT PASSAGE as raw data to be transformed. If the passage is a question, convert the question. Do not answer it.
Expand Abbreviations: Write out all abbreviations in full. e.g. becomes for example. est. becomes estimated.
Verbalize All Numbers & Symbols: Convert all digits and symbols into words. $5.2M becomes five point two million dollars. 25% becomes twenty-five percent. Eris-1 becomes Eris one.
Clarify URLs & Jargon: Spell out URLs and special characters. project-status.com/v2 becomes project dash status dot com slash v two.

EXAMPLES

Example 1:
TEXT PASSAGE: Analysis complete: Plan A is 15% cheaper (~$2k savings) but takes 3 wks longer. See details at results.com/plan-a.
SPOKEN SCRIPT: The analysis is complete. Plan A is fifteen percent cheaper, with approximately two thousand dollars in savings, but it will take three weeks longer. See the details at results dot com slash plan a.

Example 2:
TEXT PASSAGE: Q2 report: Revenue at $1.8M (+7% QoQ). Key issue: supply chain delays, i.e., component shortages.
SPOKEN SCRIPT: The second quarter report shows revenue at one point eight million dollars, a seven percent increase quarter-over-quarter. The key issue is supply chain delays; that is, component shortages.

Example 3:
TEXT PASSAGE: Weather alert for zip 94063: High winds expected ~8 PM. Wind speed: 30-40 mph. Source: noaa.gov.
SPOKEN SCRIPT: There is a weather alert for the nine four zero six three zip code. High winds are expected at approximately eight P M, with wind speeds between thirty and forty miles per hour. The source is N O A A dot gov.

Example 4:
TEXT PASSAGE: Can you confirm the project ETA is still 9/1?
SPOKEN SCRIPT: Can you confirm the project E T A is still September first?

YOUR TASK:
Now, rewrite the following TEXT PASSAGE into a spoken script. Only respond with the spoken script itself.

TEXT PASSAGE:\n${text}

SPOKEN SCRIPT:\n`

    return await this.conduit.contact(userPrompt, this.withPersonality(systemPrompt), this.config.model, this.config.options)
  }
}

// Create and export the three Magi instances
export const balthazar = new Magi2(MagiName.Balthazar, PERSONAS_CONFIG[MagiName.Balthazar]);
export const melchior = new Magi2(MagiName.Melchior, PERSONAS_CONFIG[MagiName.Melchior]);
export const caspar = new Magi2(MagiName.Caspar, PERSONAS_CONFIG[MagiName.Caspar]);

// Export all Magi instances in a single object for easy iteration
export const allMagi = {
  [MagiName.Balthazar]: balthazar,
  [MagiName.Melchior]: melchior,
  [MagiName.Caspar]: caspar,
};