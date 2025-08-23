import { setup, assign, fromPromise } from 'xstate';
import { logger } from '../logger';
import type { ConduitClient } from './conduit-client';
import { agentMachine } from './agent-machine';
import { MagiName } from '../types/magi-types';
import type { PlannerContext, PlannerEvent } from './types';
import type { MemoryService } from '../memory';

// Constants
const EXECUTION_INIT_DELAY = 100; // Small delay to allow state stabilization
import { PERSONAS_CONFIG } from './magi2';
import { testHooks } from '../testing/test-hooks';
import type { ToolUser } from './tool-user';
import type { MagiTool } from '../mcp';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface PlannerInput {
  message: string;
  magiName: MagiName;
  conduitClient: ConduitClient;
  toolUser: ToolUser;
  availableTools: MagiTool[];
  workingMemory: string;
  memoryService?: MemoryService;
}

interface CreatePlanInput {
  message: string;
  conduitClient: ConduitClient;
  magiName: MagiName;
}

interface CheckMemoryInput {
  message: string;
  conduitClient: ConduitClient;
  magiName: MagiName;
  memoryService?: MemoryService;
}

interface FinalizePlanInput {
  strategicPlan: string[];
}


// ============================================================================
// ASYNC ACTIONS
// ============================================================================

/**
 * Creates a strategic plan from user message using LLM
 */
const createStrategicPlan = fromPromise<string[], CreatePlanInput>(async ({ input }) => {
  const { message, conduitClient, magiName } = input;
  
  const systemPrompt = `PERSONA\nYou are a literal and direct task-planning engine. Your purpose is to create a sequence of computational or data-retrieval actions. You do not provide advice, warnings, or conversational filler. ${PERSONAS_CONFIG[magiName].strategicPersonaInstructions}Consider how you will respond to the user's message.`;
  
  const userPrompt = `INSTRUCTIONS:
1. Create a plan that can be expressed as a sequence of high level goals for how to address the user's message.
2. If the user's request is simple, a single goal may be sufficient.
3. Each goal should express ONLY ONE action that you can take.
4. Do not over-complicate things.
5. A plan can have at most ONE goal that communicates with the user, and it must be the absolute final goal.

EXAMPLE 1:
message: "Tell me a joke"
{"plan": ["Respond with a joke"]}

EXAMPLE 2:
message: "What is 2 + 2?"
{"plan": ["Calculate the answer to the math question", "Respond with the result"]}

${PERSONAS_CONFIG[magiName].strategicPlanExamples}

EXAMPLE 6:
message: "Write a short story about a robot who discovers music."
{"plan": ["Generate a short story with the requested theme", "Review and edit story to make sure it matches user's requirements", "Respond with the story"]}

EXAMPLE 7:
message: "Remind me to take out the trash."
{"plan": ["Ask user what day and time they would like the reminder"]}

EXAMPLE 8:
message: "Help me plan my vacation."
{"plan": ["Ask user for key vacation parameters like destination ideas, budget, travel dates, and who they are traveling with"]}

USER MESSAGE:\n"${message}"

YOUR FORMAT:
{"plan": ["goal1", "goal2", "goal3", ...]}`;

  try {
    const { model } = PERSONAS_CONFIG[magiName];
    const response = await conduitClient.contactForJSON(userPrompt, systemPrompt, model, { temperature: 0.3 });
    return response.plan ?? [`Address the user's message: ${message}`];
  } catch (error) {
    logger.warn(`${magiName} failed to create strategic plan, using fallback:`, error);
    return [`Address the user's message: ${message}`];
  }
});

/**
 * Checks if user message contains memorable information and stores it in memory
 */
const checkAndStoreMemory = fromPromise<void, CheckMemoryInput>(async ({ input }) => {
  const { conduitClient, magiName, message, memoryService } = input;
  
  if (magiName !== MagiName.Melchior || !memoryService) {
    return; // Only Melchior handles memory, and only if service is available
  }

  const { model } = PERSONAS_CONFIG[magiName];

  const systemPrompt = `You are a very observant AI.`;
  const userPrompt = `INSTRUCTIONS:
Check if the user's message reveals a goal, preference, or other personal information worth storing.
Return JSON with "shouldStore" (boolean) and "fact" (string) and "reasoning" (string) properties.

If there is something that should be stored, set shouldStore to true and fact to the information.
Otherwise set shouldStore to false.

Example 1:
{"shouldStore": true, "fact": "user purchased a Pixel 10 on today's date", "reasoning": "User explicitly shared they made a purchase, which is a personal fact worth storing."}

Example 2:
{"shouldStore": false, "fact": "", "reasoning": "This is a question seeking information, not revealing personal information about the user."}

Example 3:
{"shouldStore": true, "fact": "user does not like horror movies", "reasoning": "User explicitly stated a preference that will be useful for future recommendations."}

User Message: ${message}`;
  
  try {
    const jsonResponse = await conduitClient.contactForJSON(
      userPrompt,
      systemPrompt,
      model,
      { temperature: 0.3 }
    );

    if (jsonResponse.shouldStore && jsonResponse.fact) {
      await memoryService.storeFact(jsonResponse.fact);
      logger.debug(`${magiName} stored fact: ${jsonResponse.fact} (reasoning: ${jsonResponse.reasoning})`);
    } else {
      logger.debug(`${magiName} found no memorable information (reasoning: ${jsonResponse.reasoning})`);
    }
  } catch (error) {
    logger.warn(`${magiName} failed to check/store memory:`, error);
  }
});

/**
 * Finalizes the plan without memory concerns
 */
const finalizePlan = fromPromise<string[], FinalizePlanInput>(async ({ input }) => {
  // Plan finalization no longer handles memory - just returns the plan as-is
  return input.strategicPlan;
});


// ============================================================================
// GUARDS
// ============================================================================

/**
 * Validates planner context
 */
const isPlannerContextValid = ({ context }: { context: PlannerContext }): boolean => {
  const errors: string[] = [];

  if (!context.message?.trim()) {
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

/**
 * Checks if the last executed tool should trigger early termination
 */
export const shouldTerminateEarly = ({ context }: { context: PlannerContext }): boolean => {
  return context.lastExecutedTool !== null && context.lastExecutedTool === 'communicate';
};


// ============================================================================
// PLANNER MACHINE
// ============================================================================

export const plannerMachine = setup({
  types: {
    context: {} as PlannerContext,
    events: {} as PlannerEvent,
    input: {} as PlannerInput,
  },
  actors: {
    createStrategicPlan,
    checkAndStoreMemory,
    finalizePlan,
    agentMachine,
  },
}).createMachine({
  id: 'planner',
  initial: 'validateContext',
  context: ({ input }) => ({
    message: input.message,
    strategicPlan: [],
    currentStepIndex: 0,
    currentGoal: '',
    agentResult: null,
    error: null,
    magiName: input.magiName,
    conduitClient: input.conduitClient,
    toolUser: input.toolUser,
    availableTools: input.availableTools,
    workingMemory: input.workingMemory,
    memoryService: input.memoryService,
    planRevisions: [],
    accumulatedResults: [],
    lastExecutedTool: null,
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
        src: 'createStrategicPlan',
        input: ({ context }) => ({
          message: context.message,
          conduitClient: context.conduitClient,
          magiName: context.magiName,
        }),
        onDone: {
          target: 'checkingMemory',
          actions: [
            assign({
              strategicPlan: ({ event }) => event.output,
            }),
            ({ event, context }) => {
              testHooks.recordPlan(event.output, context.magiName);
            }
          ],
        },
        onError: {
          target: 'failed',
          actions: assign({
            error: ({ event }) => `Failed to create plan: ${event.error}`,
          }),
        },
      },
    },

    checkingMemory: {
      invoke: {
        src: 'checkAndStoreMemory',
        input: ({ context }) => ({
          message: context.message,
          conduitClient: context.conduitClient,
          magiName: context.magiName,
          memoryService: context.memoryService,
        }),
        onDone: {
          target: 'finalizingPlan',
        },
        onError: {
          target: 'finalizingPlan',
          actions: [
            ({ context }) => {
              logger.warn(`${context.magiName} memory check failed, continuing with plan`);
            }
          ],
        },
      },
    },

    finalizingPlan: {
      invoke: {
        src: 'finalizePlan',
        input: ({ context }) => ({
          strategicPlan: context.strategicPlan,
        }),
        onDone: {
          target: 'validatePlan',
          actions: assign({
            strategicPlan: ({ event }) => event.output,
          }),
        },
        onError: {
          target: 'validatePlan',
          actions: [
            ({ context }) => {
              logger.warn(`${context.magiName} finalizePlan failed, continuing with original plan`);
            }
          ],
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
        [EXECUTION_INIT_DELAY]: {
          target: 'invokingAgent'
        }
      }
    },
    
    invokingAgent: {
      invoke: {
        src: 'agentMachine',
        input: ({ context }) => {
          // Build enhanced working memory with accumulated results
          const baseMemory = context.workingMemory;
          const accumulatedContext = context.accumulatedResults.length > 0 
            ? `\n\n${context.accumulatedResults.map((item, index) => 
                `Strategic Goal #${index + 1}: "${item.goal}"\nStrategic Goal #${index + 1} Result: ${item.result}`
              ).join('\n\n')}`
            : '';
          
          return {
            message: context.message,
            strategicGoal: context.currentGoal,
            magiName: context.magiName,
            conduitClient: context.conduitClient,
            toolUser: context.toolUser,
            availableTools: context.availableTools,
            workingMemory: baseMemory + accumulatedContext,
          };
        },
        onDone: [
          {
            target: 'evaluatingProgress',
            actions: assign({
              agentResult: ({ event }) => {
                return 'result' in event.output ? event.output.result : 'Agent completed';
              },
              accumulatedResults: ({ context, event }) => {
                const result = 'result' in event.output ? event.output.result : 'Agent completed';
                return [...context.accumulatedResults, { goal: context.currentGoal, result }];
              },
              lastExecutedTool: ({ event }) => {
                return 'result' in event.output ? (event.output.lastExecutedTool || null) : null;
              },
              error: () => null,
            }),
          },
        ],
        onError: {
          target: 'handleFailure',
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
          guard: shouldTerminateEarly,
          target: 'done',
        },
        {
          guard: hasMoreSteps,
          target: 'invokingAgent',
          actions: assign({
            currentStepIndex: ({ context }) => context.currentStepIndex + 1,
            currentGoal: ({ context }) => context.strategicPlan[context.currentStepIndex + 1] || '',
            agentResult: () => null,
            error: () => null,
            lastExecutedTool: () => null,
          }),
        },
        {
          target: 'done',
        },
      ],
    },
    
    done: {
      type: 'final',
      output: ({ context }) => {
        const result = context.agentResult;
        logger.debug(`${context.magiName} planner-machine done state result: ${result}`);
        return { result };
      }
    },
    
    failed: {
      type: 'final',
      output: ({ context }) => {
        const error = context.error;
        logger.debug(`${context.magiName} planner-machine failed state error: ${error}`);
        return { error };
      }
    },
  },
});

export type PlannerMachine = typeof plannerMachine;