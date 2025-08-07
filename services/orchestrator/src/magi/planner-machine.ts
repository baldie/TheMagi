import { createMachine, assign, fromPromise } from 'xstate';
import { logger } from '../logger';
import type { ConduitClient } from './conduit-client';
import { agentMachine } from './agent-machine';
import type { MagiName } from '../types/magi-types';
import type { PlannerContext, PlannerEvent } from './types';
import { TIMEOUT_MS } from './types';
import { PERSONAS_CONFIG } from './magi2';
import type { ToolUser } from './tool-user';
import type { ShortTermMemory } from './short-term-memory';
import type { MagiTool } from '../mcp';

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

/**
 * Adapts strategic plan based on agent discoveries
 */
const adaptStrategicPlan = fromPromise(async ({ input }: { 
  input: { 
    originalPlan: string[];
    currentStepIndex: number;
    discovery: any;
    userMessage: string;
    conduitClient: ConduitClient; 
    magiName: MagiName;
  } 
}) => {
  const { originalPlan, currentStepIndex, discovery, userMessage, conduitClient, magiName } = input;
  
  logger.debug(`${magiName} adapting strategic plan based on discovery: ${discovery.type}`);
  
  const systemPrompt = `You are a strategic planner. Adapt an existing strategic plan based on new discoveries made during execution.

Consider:
- The original user request and strategic plan
- Current progress (completed steps)
- The discovery details and implications
- How to best incorporate this new information

Maintain strategic coherence while leveraging the discovery.`;
  
  const userPrompt = `Original User Message: "${userMessage}"

Original Strategic Plan:
${originalPlan.map((step, i) => {
  let status = '';
  if (i < currentStepIndex) {
    status = ' (COMPLETED)';
  } else if (i === currentStepIndex) {
    status = ' (CURRENT)';
  }
  return `${i + 1}. ${step}${status}`;
}).join('\n')}

Discovery Made:
- Type: ${discovery.type}
- Details: ${discovery.details}
- Context: ${discovery.context}

Based on this discovery, should the strategic plan be adapted? If so, provide a revised plan that incorporates this new information.

Respond with JSON:
{
  "shouldAdapt": true/false,
  "reason": "explanation of decision",
  "newPlan": ["revised step 1", "revised step 2", ...] // only if shouldAdapt is true
}`;

  try {
    const { model } = PERSONAS_CONFIG[magiName];
    const response = await conduitClient.contactForJSON(userPrompt, systemPrompt, model, { temperature: 0.3 });
    
    return {
      shouldAdapt: response.shouldAdapt === true,
      reason: response.reason || 'No reason provided',
      newPlan: response.newPlan || originalPlan
    };
  } catch (error) {
    logger.warn(`${magiName} failed to adapt strategic plan:`, error);
    // Fallback: continue with original plan unless discovery indicates impossibility
    return {
      shouldAdapt: discovery.type === 'impossibility',
      reason: discovery.type === 'impossibility' ? 'Cannot continue with impossible goal' : 'Failed to adapt plan, continuing',
      newPlan: discovery.type === 'impossibility' ? [] : originalPlan
    };
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
    logger.warn(`${context.magiName} planner context validation failed: ${errors.join(', ')}`);
    return false;
  }

  return true;
};

/**
 * Checks if plan has more steps
 */
const hasMoreSteps = ({ context }: { context: PlannerContext }): boolean => {
  logger.debug(`${context.magiName} checking if more steps remain: currentStepIndex=${context.currentStepIndex}, planLength=${context.strategicPlan.length}`);
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
    input: {} as {
      userMessage: string;
      magiName: MagiName;
      conduitClient: ConduitClient;
      toolUser: ToolUser;
      shortTermMemory: ShortTermMemory;
      availableTools: MagiTool[];
      workingMemory: string;
    }
  },
  initial: 'validateContext',
  context: ({ input }) => ({
    userMessage: input.userMessage,
    strategicPlan: [],
    currentStepIndex: 0,
    currentGoal: '',
    agentResult: null,
    error: null,
    magiName: input.magiName,
    conduitClient: input.conduitClient,
    toolUser: input.toolUser,
    shortTermMemory: input.shortTermMemory,
    availableTools: input.availableTools,
    workingMemory: input.workingMemory,
    currentDiscovery: null,
    planRevisions: [],
  }),
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
          conduitClient: context.conduitClient,
          toolUser: context.toolUser,
          shortTermMemory: context.shortTermMemory,
          availableTools: context.availableTools,
          workingMemory: context.workingMemory,
        }),
        onDone: [
          {
            guard: ({ event }) => event.output.discovery !== undefined,
            target: 'evaluatingDiscovery',
            actions: assign({
              agentResult: ({ event }) => event.output.result || 'Discovery reported',
              currentDiscovery: ({ event }) => event.output.discovery,
              error: () => null,
            }),
          },
          {
            target: 'evaluatingProgress',
            actions: assign({
              agentResult: ({ event }) => typeof event.output === 'string' ? event.output : JSON.stringify(event.output),
              error: () => null,
            }),
          },
        ],
        onError: {
          target: 'evaluatingProgress',
          actions: assign({
            agentResult: () => null,
            error: ({ event }) => `Agent failed: ${event.error}`,
          }),
        },
      },
    },
    
    evaluatingDiscovery: {
      invoke: {
        src: adaptStrategicPlan,
        input: ({ context }) => ({
          originalPlan: context.strategicPlan,
          currentStepIndex: context.currentStepIndex,
          discovery: context.currentDiscovery,
          userMessage: context.userMessage,
          conduitClient: context.conduitClient,
          magiName: context.magiName,
        }),
        onDone: [
          {
            guard: ({ event }) => event.output.shouldAdapt === true,
            target: 'adaptingPlan',
            actions: assign({
              strategicPlan: ({ event }) => event.output.newPlan || [],
              planRevisions: ({ context, event }) => [
                ...context.planRevisions,
                {
                  reason: event.output.reason || 'Plan adaptation',
                  originalPlan: [...context.strategicPlan],
                  newPlan: event.output.newPlan || context.strategicPlan
                }
              ],
            }),
          },
          {
            target: 'evaluatingProgress',
            actions: assign({
              error: () => null, // Clear any previous errors
            }),
          },
        ],
        onError: {
          target: 'evaluatingProgress',
          actions: assign({
            error: ({ event }) => `Failed to evaluate discovery: ${event.error}`,
          }),
        },
      },
    },

    adaptingPlan: {
      entry: [
        assign({
          currentStepIndex: () => 0, // Reset to start of new plan
          currentGoal: ({ context }) => context.strategicPlan[0] || '',
          error: () => null,
          currentDiscovery: () => null, // Clear processed discovery
        }),
        ({ context }) => {
          logger.info(`${context.magiName} adapted strategic plan based on discovery`);
        }
      ],
      always: [
        {
          guard: isPlanValid,
          target: 'invokingAgent'
        },
        {
          target: 'failed',
          actions: assign({
            error: () => 'Adapted plan is invalid or empty'
          })
        }
      ]
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
        totalSteps: context.strategicPlan.length,
        planRevisions: context.planRevisions
      })
    },
    
    failed: {
      type: 'final',
      output: ({ context }) => ({
        error: context.error,
        completedSteps: context.currentStepIndex,
        totalSteps: context.strategicPlan.length,
        planRevisions: context.planRevisions
      })
    },
  },
}, {
  delays: {
    TIMEOUT: TIMEOUT_MS
  }
});

export type PlannerMachine = typeof plannerMachine;