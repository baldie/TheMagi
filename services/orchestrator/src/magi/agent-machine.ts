import { createMachine, assign } from 'xstate';
import type { ConduitClient } from './conduit-client';
import type { MagiName } from '../types/magi-types';
import type { AgentContext, AgentEvent } from './types';
import { TIMEOUT_MS } from './types';
import type { ToolUser } from './tool-user';
import type { MagiTool } from '../mcp';
import { logger } from '../logger';
import { 
  determineNextTacticalGoal,
  selectTool,
  evaluateSubGoalCompletion,
  gatherContext,
  processOutput,
  evaluateStrategicGoalCompletion,
  executeTool
} from './agent-actions';
import { isContextValid, canRetry, isToolValid, shouldStopForStagnation } from './agent-guards';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Checks if the agent should terminate early based on the last tool used
 */
const shouldAgentTerminateEarly = ({ context }: { context: AgentContext; event: any }): boolean => {
  // Check if last tool was a response
  return context.selectedTool !== null && context.selectedTool.name === 'respond-to-user';
};

// ============================================================================
// AGENT MACHINE
// ============================================================================

export const agentMachine = createMachine({
  id: 'agent',
  types: {
    context: {} as AgentContext,
    events: {} as AgentEvent,
    input: {} as {
      userMessage: string;
      strategicGoal: string;
      magiName: MagiName;
      conduitClient: ConduitClient;
      toolUser: ToolUser;
      availableTools: MagiTool[];
      workingMemory?: string;
    },
    output: {} as { result: string; lastExecutedTool?: string; } | { error: string }
  },
  output: ({ context }) => {
    if (context.error) {
      return { error: context.error };
    }
    return {
      result: context.processedOutput,
      lastExecutedTool: context.selectedTool?.name
    };
  },
  initial: 'validateContext',
  context: ({ input }) => ({
    userMessage: input.userMessage,
    strategicGoal: input.strategicGoal,
    currentSubGoal: '',
    workingMemory: input.workingMemory ?? '',
    selectedTool: null,
    toolInput: {},
    toolOutput: '',
    processedOutput: '',
    completedSubGoals: [],
    retryCount: 0,
    error: null,
    goalCompletionResult: null,
    magiName: input.magiName,
    conduitClient: input.conduitClient,
    toolUser: input.toolUser,
    availableTools: input.availableTools,
    circuitBreakerContext: null,
    lastExecutionTime: 0,
    hasDeliveredAnswer: false,
    cycleCount: 0,
    maxCycles: 30,
    lastProgressCycle: 0,
  }),
  states: {
    validateContext: {
      always: [
        {
          guard: isContextValid,
          target: 'gatheringContext'
        },
        {
          target: 'failed',
          actions: assign({
            error: () => 'Context validation failed'
          })
        }
      ]
    },

    gatheringContext: {
      always: [
        {
          target: 'failed',
          guard: shouldStopForStagnation,
          actions: assign({
            error: ({ context }) => `Agent stopped: reached max cycles (${context.maxCycles}) or no progress for 5 cycles`
          })
        }
      ],
      entry: assign({
        cycleCount: ({ context }) => context.cycleCount + 1
      }),
      invoke: {
        src: gatherContext,
        input: ({ context }) => ({
          userMessage: context.userMessage,
          strategicGoal: context.strategicGoal,
          workingMemory: context.workingMemory,
          completedSubGoals: context.completedSubGoals,
          conduitClient: context.conduitClient,
          magiName: context.magiName,
        }),
        onDone: {
          target: 'determiningSubGoal',
          actions: assign({
            workingMemory: ({ event }) => event.output || '',
          }),
        },
        onError: {
          target: 'determiningSubGoal',
          actions: assign({
            workingMemory: ({ context }) => {
              const parts = [
                `Strategic Goal: ${context.strategicGoal}`,
                `Working Memory: ${context.workingMemory}`,
                `Completed Sub-goals: ${context.completedSubGoals.join(', ') || 'None'}`,
              ];
              return parts.join('\n');
            },
          }),
        },
      },
    },
    
    determiningSubGoal: {
      invoke: {
        src: determineNextTacticalGoal,
        input: ({ context }) => ({
          strategicGoal: context.strategicGoal,
          context: context.workingMemory,
          completedSubGoals: context.completedSubGoals,
          conduitClient: context.conduitClient,
          magiName: context.magiName,
          userMessage: context.userMessage,
        }),
        onDone: {
          target: 'selectingTool',
          actions: assign({
            currentSubGoal: ({ event }) => event.output || '',
            retryCount: () => 0,
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
          context: context.workingMemory,
          userMessage: context.userMessage,
          magiName: context.magiName,
        }),
        onDone: {
          target: 'validatingTool',
          actions: assign({
            selectedTool: ({ event }) => event.output || null,
          }),
        },
        onError: [
          {
            guard: canRetry,
            target: 'selectingTool',
            actions: assign({
              retryCount: ({ context }) => context.retryCount + 1,
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

    validatingTool: {
      always: [
        {
          guard: isToolValid,
          target: 'executingTool'
        },
        {
          guard: canRetry,
          target: 'selectingTool',
          actions: assign({
            retryCount: ({ context }) => context.retryCount + 1,
            error: () => 'Tool validation failed, retrying tool selection',
          }),
        },
        {
          target: 'failed',
          actions: assign({
            error: () => 'Tool validation failed after max retries',
          }),
        }
      ]
    },
    
    executingTool: {
      invoke: {
        src: executeTool,
        input: ({ context }) => ({ context }),
        onDone: {
          target: 'processingOutput',
          actions: assign({
            toolOutput: ({ event }) => event.output || '',
            error: () => null,
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
      invoke: {
        src: processOutput,
        input: ({ context }) => ({
          tool: context.selectedTool,
          toolOutput: context.toolOutput,
          currentSubGoal: context.currentSubGoal,
          userMessage: context.userMessage,
          conduitClient: context.conduitClient,
          magiName: context.magiName,
        }),
        onDone: {
          target: 'evaluatingSubGoal',
          actions: assign({
            processedOutput: ({ event }) => event.output || '',
          }),
        },
        onError: {
          target: 'evaluatingSubGoal',
          actions: assign({
            processedOutput: ({ context }) => {
              let output = context.toolOutput;
              
              // Basic post-processing
              if (output.length > 5000) {
                output = output.substring(0, 5000) + '... [truncated]';
              }
              
              return output;
            },
          }),
        },
      },
    },
    
    evaluatingSubGoal: {
      invoke: {
        src: evaluateSubGoalCompletion,
        input: ({ context }) => ({
          subGoal: context.currentSubGoal,
          toolOutput: context.processedOutput,
          conduitClient: context.conduitClient,
          magiName: context.magiName,
        }),
        onDone: [
          {
            guard: shouldAgentTerminateEarly,
            target: 'done',
            actions: assign({
              processedOutput: ({ context }) => context.toolOutput, // let the Magi's question or answer be the final output
              completedSubGoals: ({ context }) => [...context.completedSubGoals, context.currentSubGoal],
            }),
          },
          {
            guard: ({ event }) => event.output === true,
            target: 'evaluatingStrategicGoal',
            actions: assign({
              completedSubGoals: ({ context }) => [...context.completedSubGoals, context.currentSubGoal],
            }),
          },
          {
            target: 'gatheringContext',
            actions: assign({
              workingMemory: ({ context }) => `${context.workingMemory}\nSubgoal "${context.currentSubGoal}" failed: needs more work`,
              retryCount: () => 0,
            }),
          }
        ],
        onError: {
          target: 'gatheringContext',
          actions: assign({
            workingMemory: ({ context }) => `${context.workingMemory}\nSubgoal evaluation failed, continuing...`,
            retryCount: () => 0,
          }),
        }
      }
    },
    
    evaluatingStrategicGoal: {
      invoke: {
        src: evaluateStrategicGoalCompletion,
        input: ({ context }) => ({
          strategicGoal: context.strategicGoal,
          completedSubGoals: context.completedSubGoals,
          processedOutput: context.processedOutput,
          conduitClient: context.conduitClient,
          magiName: context.magiName,
        }),
        onDone: [
          {
            guard: ({ event }) => event.output?.achieved === true,
            target: 'done',
            actions: assign({
              goalCompletionResult: ({ event }) => event.output || null,
              lastProgressCycle: ({ context }) => context.cycleCount,
              // processedOutput is preserved - no need to reassign
            }),
          },
          {
            target: 'gatheringContext',
            actions: assign({
              workingMemory: ({ context }) => `${context.workingMemory}\nCompleted: ${context.currentSubGoal} -> ${context.processedOutput}`,
              retryCount: () => 0,
              goalCompletionResult: ({ event }) => event.output || null,
            }),
          },
        ],
        onError: {
          target: 'gatheringContext',
          actions: assign({
            workingMemory: ({ context }) => `${context.workingMemory}\nGoal evaluation failed, continuing...`,
            retryCount: () => 0,
          }),
        },
      },
    },
    
    done: {
      type: 'final',
      entry: ({ context }) => {
        logger.debug(`${context.magiName} agent machine done state - processedOutput: ${context.processedOutput}`);
      }
    },
    
    failed: {
      type: 'final'
    },
  },
}, {
  delays: {
    TIMEOUT: TIMEOUT_MS
  }
});

export type AgentMachine = typeof agentMachine;