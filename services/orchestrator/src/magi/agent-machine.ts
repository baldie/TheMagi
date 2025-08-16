import { createMachine, assign, fromPromise } from 'xstate';
import { ToolExecutor } from './tool-executor';
import type { ConduitClient } from './conduit-client';
import type { MagiName } from '../types/magi-types';
import type { AgentContext, AgentEvent } from './types';
import { TIMEOUT_MS } from './types';
import type { ToolUser } from './tool-user';
import type { ShortTermMemory } from './short-term-memory';
import type { MagiTool } from '../mcp';
import { logger } from '../logger';
import { 
  determineNextTacticalGoal,
  selectTool,
  evaluateSubGoalCompletion,
  gatherContext,
  processOutput,
  evaluateStrategicGoalCompletion
} from './agent-actions';
import { isContextValid, canRetry, isToolValid, shouldStopForStagnation } from './agent-guards';
import { speakWithMagiVoice } from '../tts';
import { allMagi } from './magi2';

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
      shortTermMemory: ShortTermMemory;
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
    fullContext: '',
    promptContext: '',
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
    shortTermMemory: input.shortTermMemory,
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
            fullContext: ({ event }) => event.output,
            // Use gathered context directly for planning
            promptContext: ({ event }) => event.output,
          }),
        },
        onError: {
          target: 'determiningSubGoal',
          actions: assign({
            fullContext: ({ context }) => {
              const parts = [
                `Strategic Goal: ${context.strategicGoal}`,
                `Working Memory: ${context.workingMemory}`,
                `Completed Sub-goals: ${context.completedSubGoals.join(', ') || 'None'}`,
              ];
              return parts.join('\n');
            },
            promptContext: ({ context }) => {
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
          context: context.promptContext,
          completedSubGoals: context.completedSubGoals,
          conduitClient: context.conduitClient,
          magiName: context.magiName,
          userMessage: context.userMessage,
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
          context: context.promptContext,
          userMessage: context.userMessage,
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
          let toolOutput = '';
          
          const { toolUser, magiName, selectedTool } = input.context;
          const toolExecutor = new ToolExecutor(toolUser, magiName, TIMEOUT_MS);
      
          if (!selectedTool) {
            throw new Error('No tool selected');
          }

          const result = await toolExecutor.execute(selectedTool);
          
          if (!result.success) {
            throw new Error(result.error ?? 'Tool execution failed');
          }

          toolOutput = result.output;
        
          if (selectedTool.name === 'ask-user' || selectedTool.name === 'answer-user') {
            const magi = allMagi[magiName];
            const ttsReady = await magi.makeTTSReady(toolOutput);
            logger.debug(`\n🤖🔊\n${ttsReady}`);
            void speakWithMagiVoice(ttsReady, magiName);
          }

          return toolOutput;
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
            target: 'evaluatingStrategicGoal',
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
            guard: ({ event }) => event.output.achieved === true,
            target: 'done',
            actions: assign({
              goalCompletionResult: ({ event }) => event.output,
              lastProgressCycle: ({ context }) => context.cycleCount,
              // processedOutput is preserved - no need to reassign
            }),
          },
          {
            target: 'gatheringContext',
            actions: assign({
              fullContext: ({ context }) => `${context.fullContext}\nCompleted: ${context.currentSubGoal} -> ${context.processedOutput}`,
              retryCount: () => 0,
              goalCompletionResult: ({ event }) => event.output,
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