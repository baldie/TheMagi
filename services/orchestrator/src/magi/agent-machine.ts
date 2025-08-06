import { createMachine, assign, fromPromise } from 'xstate';
import { ToolExecutor } from './tool-executor';
import { ConduitClient } from './conduit-client';
import { MagiName } from '../types/magi-types';
import type { AgentContext, AgentEvent } from './types';
import { TIMEOUT_MS } from './types';
import { 
  determineNextTacticalGoal,
  selectTool,
  evaluateSubGoalCompletion,
  gatherContext,
  synthesizeContext,
  processOutput,
  evaluateGoalCompletion
} from './agent-actions';
import { isContextValid, canRetry, isToolValid } from './agent-guards';

// ============================================================================
// AGENT MACHINE
// ============================================================================

export const agentMachine = createMachine({
  id: 'agent',
  types: {
    context: {} as AgentContext,
    events: {} as AgentEvent,
  },
  initial: 'validateContext',
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
    conduitClient: new ConduitClient(MagiName.Balthazar), // will be overridden by the agent context
    toolUser: {} as any,
    shortTermMemory: {} as any,
    availableTools: [],
    circuitBreakerContext: null,
    lastExecutionTime: 0,
  },
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
      invoke: {
        src: gatherContext,
        input: ({ context }) => ({
          strategicGoal: context.strategicGoal,
          workingMemory: context.workingMemory,
          completedSubGoals: context.completedSubGoals,
          conduitClient: context.conduitClient,
          magiName: context.magiName,
        }),
        onDone: {
          target: 'synthesizing',
          actions: assign({
            fullContext: ({ event }) => event.output,
          }),
        },
        onError: {
          target: 'synthesizing',
          actions: assign({
            fullContext: ({ context }) => {
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
    
    synthesizing: {
      invoke: {
        src: synthesizeContext,
        input: ({ context }) => ({
          strategicGoal: context.strategicGoal,
          fullContext: context.fullContext,
          conduitClient: context.conduitClient,
          magiName: context.magiName,
        }),
        onDone: {
          target: 'determiningSubGoal',
          actions: assign({
            promptContext: ({ event }) => event.output,
          }),
        },
        onError: {
          target: 'determiningSubGoal',
          actions: assign({
            promptContext: ({ context }) => {
              return `Goal: ${context.strategicGoal}\nRelevant Context: ${context.fullContext}`;
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
          context: context.promptContext,
          completedSubGoals: context.completedSubGoals,
          conduitClient: context.conduitClient,
          magiName: context.magiName,
        }),
        onDone: {
          target: 'selectingTool',
          actions: assign({
            currentSubGoal: ({ event }) => event.output,
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
          magiName: context.magiName,
        }),
        onDone: {
          target: 'validatingTool',
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
        src: fromPromise(async ({ input }: { input: { context: AgentContext } }) => {
          const { context } = input;
          const toolExecutor = new ToolExecutor(context.toolUser, context.magiName, TIMEOUT_MS);
          
          if (!context.selectedTool) {
            throw new Error('No tool selected');
          }

          const result = await toolExecutor.execute(context.selectedTool);
          
          if (!result.success) {
            throw new Error(result.error ?? 'Tool execution failed');
          }

          return result.output;
        }),
        input: ({ context }) => ({ context }),
        onDone: {
          target: 'processingOutput',
          actions: assign({
            toolOutput: ({ event }) => event.output,
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
          toolOutput: context.toolOutput,
          currentSubGoal: context.currentSubGoal,
          conduitClient: context.conduitClient,
          magiName: context.magiName,
        }),
        onDone: {
          target: 'evaluatingSubGoal',
          actions: assign({
            processedOutput: ({ event }) => event.output,
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
            guard: ({ event }) => event.output === true,
            target: 'evaluatingGoal',
            actions: assign({
              completedSubGoals: ({ context }) => [...context.completedSubGoals, context.currentSubGoal],
            }),
          },
          {
            target: 'gatheringContext',
            actions: assign({
              fullContext: ({ context }) => `${context.fullContext}\nSubgoal "${context.currentSubGoal}" failed: needs more work`,
              retryCount: () => 0,
            }),
          }
        ],
        onError: {
          target: 'gatheringContext',
          actions: assign({
            fullContext: ({ context }) => `${context.fullContext}\nSubgoal evaluation failed, continuing...`,
            retryCount: () => 0,
          }),
        }
      }
    },
    
    evaluatingGoal: {
      invoke: {
        src: evaluateGoalCompletion,
        input: ({ context }) => ({
          strategicGoal: context.strategicGoal,
          completedSubGoals: context.completedSubGoals,
          processedOutput: context.processedOutput,
          conduitClient: context.conduitClient,
          magiName: context.magiName,
        }),
        onDone: [
          {
            guard: ({ event }) => event.output.achieved === true,
            target: 'done',
          },
          {
            target: 'gatheringContext',
            actions: assign({
              fullContext: ({ context }) => `${context.fullContext}\nCompleted: ${context.currentSubGoal} -> ${context.processedOutput}`,
              retryCount: () => 0,
            }),
          },
        ],
        onError: {
          target: 'gatheringContext',
          actions: assign({
            fullContext: ({ context }) => `${context.fullContext}\nGoal evaluation failed, continuing...`,
            retryCount: () => 0,
          }),
        },
      },
    },
    
    done: {
      type: 'final',
      output: ({ context }) => context.processedOutput
    },
    
    failed: {
      type: 'final',
      output: ({ context }) => ({ error: context.error })
    },
  },
}, {
  delays: {
    TIMEOUT: TIMEOUT_MS
  }
});

export type AgentMachine = typeof agentMachine;