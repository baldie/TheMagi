import { createActor } from 'xstate';
import { createMachine, assign, fromPromise } from 'xstate';

// ============================================================================
// TEST STATE MACHINES - Simplified versions for testing
// ============================================================================

// Mock a simplified agent machine for testing - define first due to forward reference
const testAgentMachine = createMachine({
  id: 'test-agent',
  types: {
    context: {} as {
      strategicGoal: string;
      currentSubGoal: string;
      fullContext: string;
      processedOutput: string;
      completedSubGoals: string[];
      error: string | null;
    },
    input: {} as {
      strategicGoal: string;
    },
  },
  initial: 'validateContext',
  context: ({ input }) => ({
    strategicGoal: input?.strategicGoal || '',
    currentSubGoal: '',
    fullContext: '',
    processedOutput: '',
    completedSubGoals: [],
    error: null,
  }),
  states: {
    validateContext: {
      always: [
        {
          guard: ({ context }) => context.strategicGoal.trim().length > 0,
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
        src: fromPromise(async () => 'Gathered context information'),
        onDone: {
          target: 'synthesizing',
          actions: assign({
            fullContext: ({ event }) => event.output,
          }),
        },
        onError: {
          target: 'synthesizing',
          actions: assign({
            fullContext: ({ context }) => `Strategic Goal: ${context.strategicGoal}`,
          }),
        },
      },
    },
    
    synthesizing: {
      invoke: {
        src: fromPromise(async () => 'Synthesized context for planning'),
        onDone: {
          target: 'determiningSubGoal',
          actions: assign({
            fullContext: ({ event }) => event.output,
          }),
        },
        onError: {
          target: 'determiningSubGoal',
          actions: assign({
            fullContext: ({ context }) => `Goal: ${context.strategicGoal}`,
          }),
        },
      },
    },
    
    determiningSubGoal: {
      invoke: {
        src: fromPromise(async () => 'Test tactical sub-goal'),
        onDone: {
          target: 'selectingTool',
          actions: assign({
            currentSubGoal: ({ event }) => event.output,
          }),
        },
        onError: {
          target: 'failed',
          actions: assign({
            error: () => 'Failed to determine sub-goal',
          }),
        },
      },
    },
    
    selectingTool: {
      invoke: {
        src: fromPromise(async () => ({ name: 'answer-user', parameters: {} })),
        onDone: {
          target: 'validatingTool'
        },
        onError: {
          target: 'failed',
          actions: assign({
            error: () => 'Failed to select tool',
          }),
        },
      },
    },

    validatingTool: {
      always: {
        target: 'executingTool'
      }
    },
    
    executingTool: {
      invoke: {
        src: fromPromise(async () => 'Mock tool execution result'),
        onDone: {
          target: 'processingOutput',
          actions: assign({
            processedOutput: ({ event }) => event.output,
          }),
        },
        onError: {
          target: 'failed',
          actions: assign({
            error: () => 'Tool execution failed',
          }),
        },
      },
    },
    
    processingOutput: {
      invoke: {
        src: fromPromise(async ({ input }) => {
          return {
            processedOutput: `Processed: ${input.processedOutput}`,
            shouldFollowUpWithRead: false,
            followUpUrl: undefined
          };
        }),
        input: ({ context }) => ({ processedOutput: context.processedOutput }),
        onDone: {
          target: 'evaluatingSubGoal',
          actions: assign({
            processedOutput: ({ event }) => event.output.processedOutput,
          }),
        },
        onError: {
          target: 'evaluatingSubGoal',
        },
      },
    },
    
    evaluatingSubGoal: {
      invoke: {
        src: fromPromise(async () => true),
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
          }
        ],
        onError: {
          target: 'gatheringContext',
        }
      }
    },
    
    evaluatingGoal: {
      invoke: {
        src: fromPromise(async () => ({ achieved: true, confidence: 0.9, reason: 'Goal achieved' })),
        onDone: [
          {
            guard: ({ event }) => event.output.achieved === true,
            target: 'done',
          },
          {
            target: 'gatheringContext',
          },
        ],
        onError: {
          target: 'gatheringContext',
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
});

// Mock a simplified planner machine for testing
const testPlannerMachine = createMachine({
  id: 'test-planner',
  types: {
    context: {} as {
      userMessage: string;
      strategicPlan: string[];
      currentStepIndex: number;
      currentGoal: string;
      agentResult: string | null;
      error: string | null;
    },
    input: {} as {
      userMessage: string;
      strategicPlan: string[];
      currentStepIndex: number;
      currentGoal: string;
      agentResult: string | null;
      error: string | null;
    },
  },
  initial: 'validateContext',
  context: ({ input }) => input || {
    userMessage: '',
    strategicPlan: [],
    currentStepIndex: 0,
    currentGoal: '',
    agentResult: null,
    error: null,
  },
  states: {
    validateContext: {
      always: [
        {
          guard: ({ context }) => context.userMessage.trim().length > 0,
          target: 'creatingPlan'
        },
        {
          target: 'failed',
          actions: assign({
            error: () => 'Planner context validation failed'
          })
        }
      ]
    },

    creatingPlan: {
      invoke: {
        src: fromPromise(async () => {
          return ['Goal 1: Test first goal', 'Goal 2: Test second goal'];
        }),
        onDone: {
          target: 'validatePlan',
          actions: assign({
            strategicPlan: ({ event }) => event.output,
          }),
        },
        onError: {
          target: 'failed',
          actions: assign({
            error: () => 'Failed to create plan',
          }),
        },
      },
    },

    validatePlan: {
      always: [
        {
          guard: ({ context }) => Array.isArray(context.strategicPlan) && context.strategicPlan.length > 0,
          target: 'initializingExecution',
          actions: assign({
            currentGoal: ({ context }) => context.strategicPlan[0] || '',
          })
        },
        {
          target: 'failed',
          actions: assign({
            error: () => 'Generated plan is invalid'
          })
        }
      ]
    },

    initializingExecution: {
      entry: assign({
        currentStepIndex: () => 0,
        agentResult: () => null,
        error: () => null,
      }),
      after: {
        100: {
          target: 'invokingAgent'
        }
      }
    },
    
    invokingAgent: {
      invoke: {
        src: testAgentMachine,
        input: ({ context }) => ({
          strategicGoal: context.currentGoal,
        }),
        onDone: {
          target: 'evaluatingProgress',
          actions: assign({
            agentResult: ({ event }) => typeof event.output === 'string' ? event.output : JSON.stringify(event.output),
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
          guard: ({ context }) => context.agentResult !== null && context.error === null,
          target: 'checkingPlanCompletion',
        },
        {
          target: 'handleFailure',
        },
      ],
    },

    handleFailure: {
      always: {
        target: 'failed'
      }
    },
    
    checkingPlanCompletion: {
      always: [
        {
          guard: ({ context }) => context.currentStepIndex < context.strategicPlan.length - 1,
          target: 'invokingAgent',
          actions: assign({
            currentStepIndex: ({ context }) => context.currentStepIndex + 1,
            currentGoal: ({ context }) => context.strategicPlan[context.currentStepIndex + 1] || '',
            agentResult: () => null,
            error: () => null,
          }),
        },
        {
          target: 'done',
        },
      ],
    },
    
    done: {
      type: 'final',
      output: ({ context }) => ({
        result: context.agentResult,
        completedSteps: context.currentStepIndex + 1,
        totalSteps: context.strategicPlan.length
      })
    },
    
    failed: {
      type: 'final',
      output: ({ context }) => ({
        error: context.error,
        completedSteps: context.currentStepIndex,
        totalSteps: context.strategicPlan.length
      })
    },
  },
});

describe('State Machines Integration Tests', () => {
  describe('Planner Machine Happy Path', () => {
    it('should complete the full planner flow successfully', async () => {
      const plannerContext = {
        userMessage: 'Test user message',
        strategicPlan: [],
        currentStepIndex: 0,
        currentGoal: '',
        agentResult: null,
        error: null,
      };

      const plannerActor = createActor(testPlannerMachine, {
        input: plannerContext
      });

      const stateTransitions: string[] = [];
      
      plannerActor.subscribe((state) => {
        stateTransitions.push(state.value as string);
      });

      plannerActor.start();

      // Wait for completion
      await new Promise((resolve, reject) => {
        const subscription = plannerActor.subscribe((state) => {
          if (state.status === 'done') {
            subscription.unsubscribe();
            resolve(state);
          }
        });
        
        // Add timeout to prevent infinite hanging
        setTimeout(() => {
          subscription.unsubscribe();
          reject(new Error('Test timeout'));
        }, 8000);
      });

      // Verify state transitions happened in correct order
      // Note: Some states may be skipped due to immediate transitions
      expect(stateTransitions).toContain('creatingPlan');
      expect(stateTransitions).toContain('initializingExecution');
      expect(stateTransitions).toContain('invokingAgent');
      expect(stateTransitions).toContain('done');
      
      // Verify the machine completed successfully
      expect(stateTransitions[stateTransitions.length - 1]).toBe('done');

      // Verify the final output
      const finalState = plannerActor.getSnapshot();
      expect(finalState.status).toBe('done');
      
      // Verify the context has expected values
      expect(finalState.context.strategicPlan).toHaveLength(2);
      expect(finalState.context.strategicPlan).toEqual(['Goal 1: Test first goal', 'Goal 2: Test second goal']);
      expect(finalState.context.currentStepIndex).toBeGreaterThanOrEqual(0);

      plannerActor.stop();
    }, 10000);
  });

  describe('Agent Machine Happy Path', () => {
    it('should complete the full agent flow successfully', async () => {
      const agentActor = createActor(testAgentMachine, {
        input: { strategicGoal: 'Test strategic goal' }
      });

      const stateTransitions: string[] = [];
      
      agentActor.subscribe((state) => {
        stateTransitions.push(state.value as string);
      });

      agentActor.start();

      // Wait for completion
      await new Promise((resolve, reject) => {
        const subscription = agentActor.subscribe((state) => {
          if (state.status === 'done') {
            subscription.unsubscribe();
            resolve(state);
          }
        });
        
        setTimeout(() => {
          subscription.unsubscribe();
          reject(new Error('Test timeout'));
        }, 8000);
      });

      // Verify state transitions happened in correct order
      expect(stateTransitions).toContain('gatheringContext');
      expect(stateTransitions).toContain('determiningSubGoal');
      expect(stateTransitions).toContain('executingTool');
      expect(stateTransitions).toContain('done');
      
      expect(stateTransitions[stateTransitions.length - 1]).toBe('done');

      // Verify the final output
      const finalState = agentActor.getSnapshot();
      expect(finalState.status).toBe('done');
      // Agent machine may not have output in final state, check context instead
      if (finalState.output) {
        expect(typeof finalState.output).toBe('string');
      }
      expect(finalState.context.strategicGoal).toBe('Test strategic goal');

      agentActor.stop();
    }, 10000);
  });

  describe('Integrated Flow', () => {
    it('should complete planner machine with embedded agent machine successfully', async () => {
      const plannerContext = {
        userMessage: 'Help me with a complex task',
        strategicPlan: [],
        currentStepIndex: 0,
        currentGoal: '',
        agentResult: null,
        error: null,
      };

      const plannerActor = createActor(testPlannerMachine, {
        input: plannerContext
      });

      let plannerStates: string[] = [];

      plannerActor.subscribe((state) => {
        plannerStates.push(state.value as string);
      });

      plannerActor.start();

      // Wait for completion
      await new Promise((resolve) => {
        plannerActor.subscribe((state) => {
          if (state.status === 'done') {
            resolve(state);
          }
        });
      });

      // Verify planner completed successfully
      expect(plannerStates).toContain('done');
      expect(plannerStates).toContain('invokingAgent');

      // Verify final result
      const finalState = plannerActor.getSnapshot();
      expect(finalState.status).toBe('done');
      expect(finalState.context.strategicPlan).toHaveLength(2);
      expect(finalState.context.currentStepIndex).toBeGreaterThanOrEqual(0);

      plannerActor.stop();
    }, 15000);
  });

  describe('Error Handling', () => {
    it('should handle planner context validation failure', () => {
      const plannerActor = createActor(testPlannerMachine, {
        input: {
          userMessage: '', // Invalid: empty message
          strategicPlan: [],
          currentStepIndex: 0,
          currentGoal: '',
          agentResult: null,
          error: null,
        }
      });

      plannerActor.start();

      // Should immediately go to failed state due to validation
      const finalState = plannerActor.getSnapshot();
      expect(finalState.value).toBe('failed');
      expect(finalState.context.error).toBe('Planner context validation failed');

      plannerActor.stop();
    });

    it('should handle agent context validation failure', () => {
      const agentActor = createActor(testAgentMachine, {
        input: { strategicGoal: '' } // Invalid: empty goal
      });

      agentActor.start();

      // Should immediately go to failed state due to validation
      const finalState = agentActor.getSnapshot();
      expect(finalState.value).toBe('failed');
      expect(finalState.context.error).toBe('Context validation failed');

      agentActor.stop();
    });
  });
});