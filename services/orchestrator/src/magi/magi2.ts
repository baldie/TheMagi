import { createMachine, assign, fromPromise, type ActorRefFrom } from 'xstate';
import { logger } from '../logger';
import { ConduitClient } from './conduit-client';
import { ToolUser } from './tool-user';
import { ShortTermMemory } from './short-term-memory';
import { MagiName } from '../types/magi-types';
import type { MagiTool } from '../mcp';
import type { AgenticTool } from './magi';

// Constants
const MAX_RETRIES = 3;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Context for the high-level Planner machine
 */
interface PlannerContext {
  userMessage: string;
  strategicPlan: string[];
  currentStepIndex: number;
  currentGoal: string;
  agentResult: string | null;
  error: string | null;
  magiName: MagiName;
}

/**
 * Context for the tactical Agent machine
 */
interface AgentContext {
  // Goal and planning
  strategicGoal: string;
  currentSubGoal: string;
  
  // Memory and context
  fullContext: string;
  promptContext: string;
  workingMemory: string;
  
  // Tool execution
  selectedTool: AgenticTool | null;
  toolInput: Record<string, unknown>;
  toolOutput: string;
  processedOutput: string;
  
  // Tracking and control
  completedSubGoals: string[];
  retryCount: number;
  error: string | null;
  
  // Integration points
  magiName: MagiName;
  conduitClient: ConduitClient;
  toolUser: ToolUser;
  shortTermMemory: ShortTermMemory;
  availableTools: MagiTool[];
}

/**
 * Events for the Planner machine
 */
type PlannerEvent = 
  | { type: 'START'; userMessage: string; magiName: MagiName }
  | { type: 'AGENT_SUCCESS'; result: string }
  | { type: 'AGENT_FAILURE'; error: string }
  | { type: 'RETRY' }
  | { type: 'PLAN_COMPLETE' }
  | { type: 'PLAN_FAILED' };

/**
 * Events for the Agent machine
 */
type AgentEvent = 
  | { type: 'START'; strategicGoal: string }
  | { type: 'CONTEXT_GATHERED' }
  | { type: 'SYNTHESIZED' }
  | { type: 'SUBGOAL_DETERMINED' }
  | { type: 'TOOL_SELECTED' }
  | { type: 'INPUT_FORMATTED' }
  | { type: 'TOOL_EXECUTED' }
  | { type: 'OUTPUT_PROCESSED' }
  | { type: 'SUBGOAL_COMPLETE' }
  | { type: 'SUBGOAL_INCOMPLETE' }
  | { type: 'GOAL_COMPLETE' }
  | { type: 'GOAL_INCOMPLETE' }
  | { type: 'RETRY' }
  | { type: 'VALIDATION_FAILED' }
  | { type: 'MAX_RETRIES_REACHED' };

// ============================================================================
// ASYNC ACTIONS (Placeholders for LLM calls and tool execution)
// ============================================================================

/**
 * Creates a strategic plan from user message using LLM
 */
const createStrategicPlan = fromPromise(async ({ input }: { input: { userMessage: string; conduitClient: ConduitClient; magiName: MagiName } }) => {
  const { userMessage, conduitClient, magiName } = input;
  
  logger.debug(`${magiName} creating strategic plan for: ${userMessage}`);
  
  // Placeholder for LLM call to create strategic plan
  const systemPrompt = `You are a strategic planner. Break down the user's request into 2-5 high-level strategic goals.
Each goal should be actionable and specific. Return as a JSON array of strings.`;
  
  const userPrompt = `User request: "${userMessage}"

Create a strategic plan to address this request. Each step should be a clear, actionable goal.

Format your response as JSON:
{
  "plan": ["goal1", "goal2", "goal3"]
}`;

  try {
    const response = await conduitClient.contactForJSON(userPrompt, systemPrompt, 'llama3.2', { temperature: 0.3 });
    return response.plan || [`Address the user's request: ${userMessage}`];
  } catch (error) {
    logger.warn(`${magiName} failed to create strategic plan, using fallback:`, error);
    return [`Address the user's request: ${userMessage}`];
  }
});

/**
 * Determines the next tactical sub-goal based on current context
 */
const determineNextTacticalGoal = fromPromise(async ({ input }: { 
  input: { 
    strategicGoal: string; 
    context: string; 
    completedSubGoals: string[];
    conduitClient: ConduitClient;
    magiName: MagiName;
  } 
}) => {
  const { strategicGoal, context, completedSubGoals, conduitClient, magiName } = input;
  
  logger.debug(`${magiName} determining next tactical goal for: ${strategicGoal}`);
  
  const systemPrompt = `You are a tactical planner. Given a strategic goal and current context, determine the next specific, actionable sub-goal.`;

  const userPrompt = `Strategic Goal: ${strategicGoal}
Context: ${context}
Completed Sub-goals: ${completedSubGoals.join(', ') || 'None'}

What is the next specific, actionable sub-goal to work towards the strategic goal?
Respond with just the sub-goal text.`;

  try {
    return await conduitClient.contact(userPrompt, systemPrompt, 'llama3.2', { temperature: 0.4 });
  } catch (error) {
    logger.error(`${magiName} failed to determine tactical goal:`, error);
    return `Work towards: ${strategicGoal}`;
  }
});

/**
 * Selects the appropriate tool for the current sub-goal
 */
const selectTool = fromPromise(async ({ input }: { 
  input: { 
    subGoal: string; 
    availableTools: MagiTool[];
    conduitClient: ConduitClient;
    magiName: MagiName;
  } 
}) => {
  const { subGoal, availableTools, conduitClient, magiName } = input;
  
  logger.debug(`${magiName} selecting tool for sub-goal: ${subGoal}`);
  
  const systemPrompt = `You are a tool selector. Choose the most appropriate tool for the given sub-goal.`;

  const toolList = availableTools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n');

  const userPrompt = `Sub-goal: ${subGoal}

Available tools:
${toolList}

Select the most appropriate tool and respond with JSON:
{
  "tool": {
    "name": "tool_name",
    "parameters": {}
  }
}`;

  try {
    const response = await conduitClient.contactForJSON(userPrompt, systemPrompt, 'llama3.2', { temperature: 0.2 });
    return response.tool;
  } catch (error) {
    logger.error(`${magiName} failed to select tool:`, error);
    // Fallback to first available tool
    return {
      name: availableTools[0]?.name || 'answer-user',
      parameters: {}
    };
  }
});

/**
 * Executes the selected tool with formatted input
 */
const executeTool = fromPromise(async ({ input }: { 
  input: { 
    tool: AgenticTool; 
    toolUser: ToolUser;
    magiName: MagiName;
  } 
}) => {
  const { tool, toolUser, magiName } = input;
  
  logger.debug(`${magiName} executing tool: ${tool.name}`);
  
  try {
    // Handle special tool cases
    if (tool.name === 'answer-user') {
      return tool.parameters.answer as string || 'No answer provided';
    }
    
    if (tool.name === 'ask-user') {
      return tool.parameters.question as string || 'No question provided';
    }
    
    // Execute regular tools through ToolUser
    return await toolUser.executeWithTool(tool.name, tool.parameters);
  } catch (error) {
    logger.error(`${magiName} tool execution failed:`, error);
    throw error;
  }
});

// ============================================================================
// GUARDS
// ============================================================================

/**
 * Validates tool input before execution
 */
const isToolInputValid = ({ context }: { context: AgentContext }): boolean => {
  const { selectedTool } = context;
  
  if (!selectedTool) {
    logger.warn(`${context.magiName} no tool selected`);
    return false;
  }
  
  // Basic validation - tool has a name
  if (!selectedTool.name || typeof selectedTool.name !== 'string') {
    logger.warn(`${context.magiName} invalid tool name`);
    return false;
  }
  
  // Tool parameters should be an object
  if (!selectedTool.parameters || typeof selectedTool.parameters !== 'object') {
    logger.warn(`${context.magiName} invalid tool parameters`);
    return false;
  }
  
  return true;
};

/**
 * Checks if retry limit has been reached
 */
const canRetry = ({ context }: { context: AgentContext }): boolean => {
  const canRetryResult = context.retryCount < MAX_RETRIES;
  if (!canRetryResult) {
    logger.warn(`${context.magiName} max retries (${MAX_RETRIES}) reached`);
  }
  return canRetryResult;
};

/**
 * Checks if plan has more steps
 */
const hasMoreSteps = ({ context }: { context: PlannerContext }): boolean => {
  return context.currentStepIndex < context.strategicPlan.length - 1;
};

/**
 * Checks if agent succeeded
 */
const agentSucceeded = ({ context }: { context: PlannerContext }): boolean => {
  return context.agentResult !== null && context.error === null;
};

// ============================================================================
// AGENT MACHINE (defined first to avoid forward reference)
// ============================================================================

const agentMachineDefinition = createMachine({
  id: 'agent',
  types: {
    context: {} as AgentContext,
    events: {} as AgentEvent,
  },
  initial: 'gatheringContext',
  context: {
    strategicGoal: '',
    currentSubGoal: '',
    fullContext: '',
    promptContext: '',
    workingMemory: '',
    selectedTool: null,
    toolInput: {},
    toolOutput: '',
    processedOutput: '',
    completedSubGoals: [],
    retryCount: 0,
    error: null,
    magiName: 'Balthazar' as MagiName,
    conduitClient: new ConduitClient(MagiName.Balthazar),
    toolUser: {} as ToolUser,
    shortTermMemory: {} as ShortTermMemory,
    availableTools: [],
  },
  states: {
    gatheringContext: {
      entry: [
        assign({
          // Gather working memory, chat history, tool outputs, completed subgoals
          fullContext: ({ context }) => {
            const parts = [
              `Strategic Goal: ${context.strategicGoal}`,
              `Working Memory: ${context.workingMemory}`,
              `Completed Sub-goals: ${context.completedSubGoals.join(', ') || 'None'}`,
            ];
            return parts.join('\n');
          },
        }),
      ],
      always: {
        target: 'synthesize',
      },
    },
    
    synthesize: {
      entry: [
        assign({
          // Synthesize only relevant information for the strategic goal
          promptContext: ({ context }) => {
            // Filter and synthesize the full context for relevance
            return `Goal: ${context.strategicGoal}\nRelevant Context: ${context.fullContext}`;
          },
        }),
      ],
      always: {
        target: 'determiningSubGoal',
      },
    },
    
    determiningSubGoal: {
      invoke: {
        src: determineNextTacticalGoal,
        input: ({ context }) => ({
          strategicGoal: context.strategicGoal,
          context: context.promptContext,
          completedSubGoals: context.completedSubGoals,
          conduitClient: context.conduitClient,
          magiName: context.magiName,
        }),
        onDone: {
          target: 'selectingTool',
          actions: assign({
            currentSubGoal: ({ event }) => event.output,
            retryCount: () => 0, // Reset retry count for new sub-goal
          }),
        },
        onError: [
          {
            guard: canRetry,
            target: 'determiningSubGoal',
            actions: assign({
              retryCount: ({ context }) => context.retryCount + 1,
            }),
          },
          {
            target: 'failed',
            actions: assign({
              error: ({ event }) => `Failed to determine sub-goal: ${event.error}`,
            }),
          },
        ],
      },
    },
    
    selectingTool: {
      invoke: {
        src: selectTool,
        input: ({ context }) => ({
          subGoal: context.currentSubGoal,
          availableTools: context.availableTools,
          conduitClient: context.conduitClient,
          magiName: context.magiName,
        }),
        onDone: {
          target: 'formattingToolInput',
          actions: assign({
            selectedTool: ({ event }) => event.output,
          }),
        },
        onError: [
          {
            guard: canRetry,
            target: 'selectingTool',
            actions: assign({
              retryCount: ({ context }) => context.retryCount + 1,
              // Add feedback for retry: could log why previous attempt failed
            }),
          },
          {
            target: 'failed',
            actions: assign({
              error: ({ event }) => `Failed to select tool: ${event.error}`,
            }),
          },
        ],
      },
    },
    
    formattingToolInput: {
      entry: [
        assign({
          // Format tool parameters based on selected tool and context
          toolInput: ({ context }) => {
            const { selectedTool, currentSubGoal } = context;
            
            if (!selectedTool) return {};
            
            // Basic parameter formatting based on tool type
            switch (selectedTool.name) {
              case 'search-web':
                return { query: currentSubGoal };
              case 'read-page':
                return { urls: selectedTool.parameters.urls || [] };
              case 'answer-user':
                return { answer: selectedTool.parameters.answer || currentSubGoal };
              case 'ask-user':
                return { question: selectedTool.parameters.question || currentSubGoal };
              default:
                return selectedTool.parameters;
            }
          },
        }),
      ],
      always: {
        target: 'validateToolInput',
      },
    },
    
    validateToolInput: {
      always: [
        {
          guard: isToolInputValid,
          target: 'executingTool',
        },
        {
          target: 'validationFailed',
        },
      ],
    },
    
    validationFailed: {
      always: [
        {
          guard: canRetry,
          target: 'selectingTool',
          actions: assign({
            retryCount: ({ context }) => context.retryCount + 1,
            error: () => 'Tool input validation failed, retrying tool selection',
          }),
        },
        {
          target: 'failed',
          actions: assign({
            error: () => 'Tool input validation failed after max retries',
          }),
        },
      ],
    },
    
    executingTool: {
      invoke: {
        src: executeTool,
        input: ({ context }) => ({
          tool: {
            name: context.selectedTool!.name,
            parameters: context.toolInput,
          },
          toolUser: context.toolUser,
          magiName: context.magiName,
        }),
        onDone: {
          target: 'processingOutput',
          actions: assign({
            toolOutput: ({ event }) => event.output,
          }),
        },
        onError: [
          {
            guard: canRetry,
            target: 'selectingTool',
            actions: assign({
              retryCount: ({ context }) => context.retryCount + 1,
              error: ({ event }) => `Tool execution failed: ${event.error}`,
            }),
          },
          {
            target: 'failed',
            actions: assign({
              error: ({ event }) => `Tool execution failed after retries: ${event.error}`,
            }),
          },
        ],
      },
    },
    
    processingOutput: {
      entry: [
        assign({
          // Perform post-processing on tool output as needed
          processedOutput: ({ context }) => {
            let output = context.toolOutput;
            
            // Basic post-processing
            if (output.length > 5000) {
              output = output.substring(0, 5000) + '... [truncated]';
            }
            
            return output;
          },
        }),
      ],
      always: {
        target: 'subGoalReflection',
      },
    },
    
    subGoalReflection: {
      // Determine whether the subgoal has been met
      entry: [
        assign({
          // Simple heuristic: if we got meaningful output, subgoal is likely complete
          // In a real implementation, this would involve LLM evaluation
        }),
      ],
      always: [
        {
          // Simplified: if we have processed output and no errors, subgoal is complete
          guard: ({ context }) => context.processedOutput.length > 0 && !context.error,
          target: 'goalReflection',
          actions: assign({
            completedSubGoals: ({ context }) => [...context.completedSubGoals, context.currentSubGoal],
          }),
        },
        {
          // If subgoal incomplete, add failure reason to context and retry
          target: 'gatheringContext',
          actions: assign({
            fullContext: ({ context }) => `${context.fullContext}\nSubgoal "${context.currentSubGoal}" failed: ${context.error ?? 'Unknown reason'}`,
            error: () => null, // Clear error for next iteration
          }),
        },
      ],
    },
    
    goalReflection: {
      // Determine whether the planner-provided goal has been met
      always: [
        {
          // Simplified: if we have completed sub-goals and processed output, goal is complete
          guard: ({ context }) => context.completedSubGoals.length > 0 && context.processedOutput.length > 0,
          target: 'done',
        },
        {
          // Goal incomplete, continue with more sub-goals
          target: 'gatheringContext',
          actions: assign({
            fullContext: ({ context }) => `${context.fullContext}\nCompleted: ${context.currentSubGoal} -> ${context.processedOutput}`,
          }),
        },
      ],
    },
    
    done: {
      type: 'final',
    },
    
    failed: {
      type: 'final',
    },
  },
});

export const agentMachine = agentMachineDefinition;

// ============================================================================
// PLANNER MACHINE
// ============================================================================

export const plannerMachine = createMachine({
  id: 'planner',
  types: {
    context: {} as PlannerContext,
    events: {} as PlannerEvent,
  },
  initial: 'creatingPlan',
  context: {
    userMessage: '',
    strategicPlan: [],
    currentStepIndex: 0,
    currentGoal: '',
    agentResult: null,
    error: null,
    magiName: 'Balthazar' as MagiName,
  },
  states: {
    creatingPlan: {
      invoke: {
        src: createStrategicPlan,
        input: ({ context }) => ({
          userMessage: context.userMessage,
          conduitClient: new ConduitClient(context.magiName),
          magiName: context.magiName,
        }),
        onDone: {
          target: 'invokingAgent',
          actions: assign({
            strategicPlan: ({ event }) => event.output,
            currentGoal: ({ event }) => event.output[0] ?? '',
          }),
        },
        onError: {
          target: 'failed',
          actions: assign({
            error: ({ event }) => `Failed to create plan: ${event.error}`,
          }),
        },
      },
    },
    
    invokingAgent: {
      invoke: {
        src: agentMachine,
        input: ({ context }) => ({
          strategicGoal: context.currentGoal,
          magiName: context.magiName,
        }),
        onDone: {
          target: 'evaluatingProgress',
          actions: assign({
            agentResult: ({ event }) => event.output,
            error: () => null,
          }),
        },
        onError: {
          target: 'evaluatingProgress',
          actions: assign({
            agentResult: () => null,
            error: ({ event }) => `Agent failed: ${event.error}`,
          }),
        },
      },
    },
    
    evaluatingProgress: {
      always: [
        {
          guard: agentSucceeded,
          target: 'checkingPlanCompletion',
        },
        {
          target: 'failed',
        },
      ],
    },
    
    checkingPlanCompletion: {
      always: [
        {
          guard: hasMoreSteps,
          target: 'invokingAgent',
          actions: assign({
            currentStepIndex: ({ context }) => context.currentStepIndex + 1,
            currentGoal: ({ context }) => context.strategicPlan[context.currentStepIndex + 1] ?? '',
            agentResult: () => null,
          }),
        },
        {
          target: 'done',
        },
      ],
    },
    
    done: {
      type: 'final',
    },
    
    failed: {
      type: 'final',
    },
  },
});


// ============================================================================
// FACTORY FUNCTIONS AND EXPORTS
// ============================================================================

/**
 * Creates a configured planner machine for a specific Magi
 */
export function createPlannerMachine(magiName: MagiName, userMessage: string) {
  return createMachine({
    ...plannerMachine.config,
    context: {
      userMessage,
      strategicPlan: [],
      currentStepIndex: 0,
      currentGoal: '',
      agentResult: null,
      error: null,
      magiName,
    },
  });
}

/**
 * Creates a configured agent machine for a specific Magi and strategic goal
 */
export function createAgentMachine(
  magiName: MagiName, 
  strategicGoal: string,
  conduitClient: ConduitClient,
  toolUser: ToolUser,
  shortTermMemory: ShortTermMemory,
  availableTools: MagiTool[]
) {
  return createMachine({
    ...agentMachine.config,
    context: {
      strategicGoal,
      currentSubGoal: '',
      fullContext: '',
      promptContext: '',
      workingMemory: '',
      selectedTool: null,
      toolInput: {},
      toolOutput: '',
      processedOutput: '',
      completedSubGoals: [],
      retryCount: 0,
      error: null,
      magiName,
      conduitClient,
      toolUser,
      shortTermMemory,
      availableTools,
    },
  });
}

/**
 * Type definitions for external usage
 */
export type PlannerMachine = typeof plannerMachine;
export type AgentMachine = typeof agentMachine;
export type PlannerActor = ActorRefFrom<typeof plannerMachine>;
export type AgentActor = ActorRefFrom<typeof agentMachine>;

// Export context types for external usage
export type { PlannerContext, AgentContext, PlannerEvent, AgentEvent };