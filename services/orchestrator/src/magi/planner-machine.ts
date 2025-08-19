import { createMachine, assign, fromPromise } from 'xstate';
import { logger } from '../logger';
import type { ConduitClient } from './conduit-client';
import { agentMachine } from './agent-machine';
import { MagiName } from '../types/magi-types';
import type { PlannerContext, PlannerEvent } from './types';
import { TIMEOUT_MS } from './types';

// Constants
const EXECUTION_INIT_DELAY = 100; // Small delay to allow state stabilization
import { PERSONAS_CONFIG } from './magi2';
import { testHooks } from '../testing/test-hooks';
import type { ToolUser } from './tool-user';
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
  
  const systemPrompt = `PERSONA\nYou are a quick strategic planner. ${PERSONAS_CONFIG[magiName].strategicPersonaInstructions}Consider how you will respond to the user's message.`;
  
  const userPrompt = `INSTRUCTIONS:
Create a high-level plan for how to address the user's message.
If the user's request is simple, a single goal may be sufficient.
Each goal should be actionable. Do not over-complicate things.

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

USER MESSAGE:\n"${userMessage}"

YOUR FORMAT:
{"plan": ["goal1", "goal2", "goal3", ...]}`;

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
 * Finalizes the current sub-goal by making a call to the conduit
 */
const finalizePlan = fromPromise(async ({ input }: { input: {
  strategicPlan: string[];
  userMessage: string;
  conduitClient: ConduitClient;
  magiName: MagiName;
}}) => {
  const { strategicPlan, conduitClient, magiName, userMessage } = input;
  if (magiName === MagiName.Melchior) {
    const { model } = PERSONAS_CONFIG[magiName];

    const systemPrompt = `You are a very observant AI.`;
    const userPrompt = `INSTRUCTIONS:
Check if the user's message reveals a goal, preference, or other personal information worth storing.
Return JSON with "response" and "reasoning" properties.

If there is something that should be stored, set response to:
'Store <information here>'

Otherwise set response to:
'N/A'

Example 1:
{"response": "Store user purchased a Pixel 10 on today's date", "reasoning": "User explicitly shared they made a purchase, which is a personal fact worth storing."}

Example 2:
{"response": "N/A", "reasoning": "This is a question seeking information, not revealing personal information about the user."}

Example 3:
{"response": "Store user does not like horror movies", "reasoning": "User explicitly stated a preference that will be useful for future recommendations."}

Example 4:
{"response": "N/A", "reasoning": "User is not explicitly sharing their height, just asking for a comparison."}

Example 5:
{"response": "Store user's dog's name is Lucky and he's 6 years old", "reasoning": "User shared specific personal facts about their pet that could be referenced in future conversations."}

Example 6:
{"response": "N/A", "reasoning": "This is a question seeking information about something they already own, not revealing new information."}

Example 7:
{"response": "Store user's goal to lose 20 pounds by summer", "reasoning": "User shared a specific personal goal with timeline that should be tracked."}

Example 8:
{"response": "Store user is allergic to peanuts", "reasoning": "This is important health information that affects food recommendations and safety."}

Example 9:
{"response": "N/A", "reasoning": "This is a temporary state, not a permanent fact or preference worth storing long-term."}

Example 10:
{"response": "Store user works as a software engineer in Seattle", "reasoning": "User shared their profession and work location, which are stable personal facts."}

User Message: ${userMessage}`;
    
    const jsonResponse = await conduitClient.contactForJSON(
      userPrompt,
      systemPrompt,
      model,
      { temperature: 0.3 }
    );

    logger.debug(`${magiName} has prepended a new strategic goal: ${jsonResponse.response} with reasoning: ${jsonResponse.reasoning}`);

    if (jsonResponse.response !== 'N/A') {
      strategicPlan.unshift(jsonResponse.response);
    }
  }
  return strategicPlan;
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

/**
 * Checks if the last executed tool should trigger early termination
 */
export const shouldTerminateEarly = ({ context }: { context: PlannerContext }): boolean => {
  const userInteractionTools = ['answer-user', 'ask-user'];
  return context.lastExecutedTool !== null && userInteractionTools.includes(context.lastExecutedTool);
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
    availableTools: input.availableTools,
    workingMemory: input.workingMemory,
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
        src: createStrategicPlan,
        input: ({ context }) => ({
          userMessage: context.userMessage,
          conduitClient: context.conduitClient,
          magiName: context.magiName,
        }),
        onDone: {
          target: 'finalizingPlan',
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

    finalizingPlan: {
      invoke: {
        src: finalizePlan,
        input: ({ context }) => ({
          strategicPlan: context.strategicPlan,
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
        src: agentMachine,
        input: ({ context }) => {
          // Build enhanced working memory with accumulated results
          const baseMemory = context.workingMemory;
          const accumulatedContext = context.accumulatedResults.length > 0 
            ? `\n\nPrevious strategic goals and results:\n${context.accumulatedResults.map((result, index) => 
                `Strategic Goal #${index + 1}: "${context.strategicPlan[index]}"\n\nResult:\n${result}`
              ).join('\n\n')}`
            : '';
          
          return {
            userMessage: context.userMessage,
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
                return event.output?.result || 'Agent completed';
              },
              accumulatedResults: ({ context, event }) => {
                const result = event.output?.result || 'Agent completed';
                return [...context.accumulatedResults, result];
              },
              lastExecutedTool: ({ event }) => {
                return event.output?.lastExecutedTool || null;
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
}, {
  delays: {
    TIMEOUT: TIMEOUT_MS
  }
});

export type PlannerMachine = typeof plannerMachine;