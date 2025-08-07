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
import { MagiErrorHandler } from './error-handler';
export { MagiName };

/**
 * Creates a configured planner machine with proper context injection
 */
export function createConfiguredPlannerMachine(_magiName: MagiName, _userMessage: string) {
  return plannerMachine.provide({
    actors: {
      agentMachine: agentMachine
    },
    guards: {},
    actions: {},
    delays: {}
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
  _shortTermMemory: ShortTermMemory,
  _availableTools: MagiTool[]
) {
  return agentMachine.provide({
    actors: {},
    guards: {},
    actions: {},
    delays: {}
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
  setNewGoalPrompt: string;
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
    setNewGoalPrompt: `[PLACEHOLDER] Goal setting prompt for Balthazar - focused on logical analysis and web search`,
    executeGoalPrompt: `[PLACEHOLDER] Goal execution prompt for Balthazar`,
    options: { temperature: 0.4 },
  },
  [MagiName.Melchior]: {
    model: Model.Gemma,
    personalitySource: path.resolve(__dirname, 'personalities', 'Melchior.md'),
    setNewGoalPrompt: `[PLACEHOLDER] Goal setting prompt for Melchior - focused on creativity and personal data`,
    executeGoalPrompt: `[PLACEHOLDER] Goal execution prompt for Melchior`,
    options: { temperature: 0.6 },
  },
  [MagiName.Caspar]: {
    model: Model.Qwen,
    personalitySource: path.resolve(__dirname, 'personalities', 'Caspar.md'),
    setNewGoalPrompt: `[PLACEHOLDER] Goal setting prompt for Caspar - focused on smart home integration`,
    executeGoalPrompt: `[PLACEHOLDER] Goal execution prompt for Caspar`,
    options: { temperature: 0.5 },
  },
};

// Additional types needed (copied from magi.ts)
interface HistoryEntry {
  action: AgenticTool;
  observation: string;
  timestamp: Date;
  stepDescription: string;
}

interface AgenticLoopState {
  currentTopic: string;
  synthesis: string;
  goal: string;
  executionHistory: HistoryEntry[];
  warnings: string[];
  prohibitedTools: string[];
}

// Minimal interface for ToolUser and ShortTermMemory compatibility
interface MagiCompatible {
  name: MagiName;
  withPersonality(systemPrompt: string): string;
  contact(userPrompt: string): Promise<string>;
  contactSimple(userPrompt: string, systemPrompt?: string): Promise<string>;
  forget(): void;
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
    this.toolUser = new ToolUser(this as MagiCompatible as any);
    this.shortTermMemory = new ShortTermMemory(this as MagiCompatible as any);
  }

  /**
   * Initialize the Magi
   */
  async initialize(prompt: string): Promise<void> {
    this.personalityPrompt = prompt;
    this.toolsList = await this.toolUser.getAvailableTools();
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

  async contact(userPrompt: string): Promise<string> {
    const currentTopic = await this.shortTermMemory.determineTopic(userPrompt);
    const workingMemory = await this.shortTermMemory.summarize(currentTopic);
    const promptWithContext = workingMemory + '\n' + userPrompt;
    const response = await this.executeWithStatusManagement(async () => 
      this.conduit.contact(promptWithContext, this.withPersonality(''), this.config.model, this.config.options)
    );
    
    // Store the interaction in short-term memory
    try {
      this.shortTermMemory.remember('user', userPrompt);
      this.shortTermMemory.remember(this.name, response);
    } catch (memoryError) {
      logger.warn(`Failed to store memory for ${this.name}: ${memoryError}`);
      // Continue execution - memory failure shouldn't break the response
    }
    
    return response;
  }

  async contactSimple(userPrompt: string, systemPrompt?: string): Promise<string> {
    return this.executeWithStatusManagement(async () => 
      this.conduit.contact(userPrompt, systemPrompt ?? '', this.config.model, this.config.options)
    );
  }

  public forget(): void {
    this.shortTermMemory.forget();
  }

  private async waitForActorCompletion(plannerActor: any): Promise<string> {
    // Wait for the actor to reach its final 'done' state using the standalone waitFor function
    const finalState = await waitFor(plannerActor, (snapshot) => snapshot.status === 'done');

    // The output from the machine's final state is in the 'output' property.
    const output = finalState.output as { result?: string; error?: string } | undefined;

    // Handle case where output is undefined
    if (!output) {
      throw new Error('Actor completed but produced no output');
    }

    if (output.error) {
      // Throwing an error here will be caught by the .catch() block
      // of the calling async function.
      throw new Error(output.error);
    }

    return output.result ?? 'Task completed successfully.';
  }

  public async contactAsAgent(userMessage: string, _prohibitedTools: string[] = []): Promise<string> {
    try {
      logger.info(`${this.name} beginning state machine agentic loop...`);
      // Create planner machine with proper context
      const plannerMachine = createConfiguredPlannerMachine(this.name, userMessage);

      return await this.executeWithStatusManagement(async () => {
        // Initialize memory context
        const currentTopic = await this.shortTermMemory.determineTopic(userMessage);
        const workingMemory = await this.shortTermMemory.summarize(currentTopic);

        // Create and start the planner actor
        const plannerActor = createActor(plannerMachine, {
          input: {
            userMessage,
            magiName: this.name,
            conduitClient: this.conduit,
            toolUser: this.toolUser,
            shortTermMemory: this.shortTermMemory,
            availableTools: this.toolsList.filter(tool => !_prohibitedTools.includes(tool.name)),
            workingMemory
          }
        });

        // Start the actor and wait for completion
        plannerActor.start();
        
        // Wait for the machine to complete
        const response = await this.waitForActorCompletion(plannerActor);
        this.shortTermMemory.remember('user', userMessage);
        this.shortTermMemory.remember(this.name, response);

        // Prep for TTS
        const finalResponse = await this.makeTTSReady(response);
        logger.debug(`\n🤖🔊\n${finalResponse}`);
        return finalResponse;
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

  // @ts-expect-error will add later
  private async _handleToolResponse(
    tool: AgenticTool,
    loopState: AgenticLoopState,
    _userMessage: string,
    actionHistory: string[]
  ): Promise<{ response?: string; shouldBreak: boolean }> {
    switch (tool.name) {
      case 'ask-user': {
        const response = tool.parameters.question as string;
        logger.info(`${this.name} has a clarifying question: "${response}"`);
        return { response, shouldBreak: true };
      }

      case 'answer-user': {
        return { response: tool.parameters.answer as string, shouldBreak: true };
      }

      default: {
        const toolResponse = await this.toolUser.executeWithTool(tool.name, tool.parameters);
        
        // Check for repetitive actions before adding to history
        if (this.isRepetitiveAction(loopState.executionHistory, tool.name)) {
          this.addRepetitiveActionWarning(loopState, tool.name);
        }
        
        // Create structured history entry
        const stepDescription = `${tool.name}: ${JSON.stringify(tool.parameters)}`;
        const historyEntry: HistoryEntry = {
          action: tool,
          observation: toolResponse,
          timestamp: new Date(),
          stepDescription
        };
        
        loopState.executionHistory.push(historyEntry);
        
        // Add action to legacy action history (still used for action tracking)
        actionHistory.push(tool.name);
        
        return { shouldBreak: false };
      }
    }
  }

  /**
   * Checks if an action is repetitive based on recent execution history
   */
  private isRepetitiveAction(executionHistory: HistoryEntry[], toolName: string): boolean {
    const recentActions = executionHistory.slice(-2); // Last 2 actions (will be 3 total with current)
    return recentActions.length === 2 && recentActions.every(entry => entry.action.name === toolName);
  }

  /**
   * Adds warning to synthesis if repetitive action is detected
   */
  private addRepetitiveActionWarning(loopState: AgenticLoopState, toolName: string): void {
    logger.warn(`${this.name} detected repetitive use of ${toolName} - forcing progression`);
    loopState.warnings.push(`You have used the '${toolName}' tool three times in a row. You MUST use a different tool or provide a final answer now. Use any tool that is not '${toolName}'.`);
  }
  
  private async makeTTSReady(text: string): Promise<string> {
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