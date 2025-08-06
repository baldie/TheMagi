import { createMachine, assign, fromPromise } from 'xstate';
import { logger } from '../logger';
import type { ConduitClient } from './conduit-client';
import { agentMachine } from './agent-machine';
import type { MagiName } from '../types/magi-types';
import type { PlannerContext, PlannerEvent } from './types';
import { TIMEOUT_MS } from './types';
import { PERSONAS_CONFIG } from './magi2';

// ============================================================================
// ASYNC ACTIONS
// ============================================================================

/**
 * Creates a strategic plan from user message using LLM
 */
const createStrategicPlan = fromPromise(async ({ input }: { 
  input: { 
    userMessage: string; 
    conduitClient: ConduitClient; 
    magiName: MagiName;
  } 
}) => {
  const { userMessage, conduitClient, magiName } = input;
  
  logger.debug(`${magiName} creating strategic plan for: ${userMessage}`);
  
  const systemPrompt = `You are a strategic planner. Break down the user's message into 2-5 high-level strategic goals.
Each goal should be actionable and specific. Return as a JSON array of strings.`;
  
  const userPrompt = `User message: "${userMessage}"

Create a strategic plan to address this message. Each step should be a clear, actionable goal.

Format your response as JSON:
{
  "plan": ["goal1", "goal2", "goal3"]
}`;

  try {
    const { model } = PERSONAS_CONFIG[magiName];
    const response = await conduitClient.contactForJSON(userPrompt, systemPrompt, model, { temperature: 0.3 });
    return response.plan ?? [`Address the user's message: ${userMessage}`];
  } catch (error) {
    logger.warn(`${magiName} failed to create strategic plan, using fallback:`, error);
    return [`Address the user's message: ${userMessage}`];
  }
});

// ============================================================================
// GUARDS
// ============================================================================

/**
 * Validates planner context
 */
const isPlannerContextValid = ({ context }: { context: PlannerContext }): boolean => {
  const errors: string[] = [];

  if (!context.userMessage?.trim()) {
    errors.push('Missing user message');
  }

  if (!context.magiName) {
    errors.push('Missing magi name');
  }

  if (errors.length > 0) {
    logger.warn(`${context.magiName} planner context validation failed:`, errors);
    return false;
  }

  return true;
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

/**
 * Validates strategic plan
 */
const isPlanValid = ({ context }: { context: PlannerContext }): boolean => {
  return Array.isArray(context.strategicPlan) && 
         context.strategicPlan.length > 0 && 
         context.strategicPlan.every(step => typeof step === 'string' && step.trim().length > 0);
};

// ============================================================================
// PLANNER MACHINE
// ============================================================================

export const plannerMachine = createMachine({
  id: 'planner',
  types: {
    context: {} as PlannerContext,
    events: {} as PlannerEvent,
  },
  initial: 'validateContext',
  context: {
    userMessage: '',
    strategicPlan: [],
    currentStepIndex: 0,
    currentGoal: '',
    agentResult: null,
    error: null,
    magiName: 'Balthazar' as MagiName, // will be overridden by the planner context
    conduitClient: {} as ConduitClient, // will be overridden by the planner context
  },
  states: {
    validateContext: {
      always: [
        {
          guard: isPlannerContextValid,
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
        src: createStrategicPlan,
        input: ({ context }) => ({
          userMessage: context.userMessage,
          conduitClient: context.conduitClient,
          magiName: context.magiName,
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
            error: ({ event }) => `Failed to create plan: ${event.error}`,
          }),
        },
      },
    },

    validatePlan: {
      always: [
        {
          guard: isPlanValid,
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
        src: agentMachine,
        input: ({ context }) => ({
          strategicGoal: context.currentGoal,
          magiName: context.magiName,
          // Additional context would be provided here in real implementation
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
          guard: agentSucceeded,
          target: 'checkingPlanCompletion',
        },
        {
          target: 'handleFailure',
        },
      ],
    },

    handleFailure: {
      entry: [
        ({ context }) => {
          logger.warn(`${context.magiName} agent failed for goal: ${context.currentGoal}`, context.error);
        }
      ],
      always: {
        target: 'failed'
      }
    },
    
    checkingPlanCompletion: {
      always: [
        {
          guard: hasMoreSteps,
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
}, {
  delays: {
    TIMEOUT: TIMEOUT_MS
  }
});

export type PlannerMachine = typeof plannerMachine;