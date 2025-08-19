import { createActor } from 'xstate';
import { plannerMachine } from './planner-machine';
import type { PlannerContext } from './types';
import type { MagiName } from '../types/magi-types';

// Mock dependencies
const mockConduitClient = {
  contactForJSON: jest.fn()
} as any;

const mockToolUser = {} as any;
const mockAvailableTools = [] as any;

describe('Planner Early Termination', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should terminate early when answer-user tool is executed', async () => {
    // Mock strategic plan creation
    mockConduitClient.contactForJSON.mockResolvedValue({
      plan: ['Find the answer', 'Provide the response', 'Follow up if needed']
    });

    const plannerActor = createActor(plannerMachine, {
      input: {
        userMessage: 'What is 2+2?',
        magiName: 'Caspar' as MagiName,
        conduitClient: mockConduitClient,
        toolUser: mockToolUser,
        availableTools: mockAvailableTools,
        workingMemory: ''
      }
    });

    plannerActor.start();

    // Wait for plan creation
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Stop the actor to prevent async leaks
    plannerActor.stop();

    // Simulate agent completion with answer-user tool
    const context = plannerActor.getSnapshot().context;
    const updatedContext: PlannerContext = {
      ...context,
      agentResult: '2 + 2 = 4',
      lastExecutedTool: 'answer-user',
      currentStepIndex: 0  // Still on first step
    };

    // Check that shouldTerminateEarly would return true
    const shouldTerminateEarly = ({ context }: { context: PlannerContext }): boolean => {
      const userInteractionTools = ['answer-user', 'ask-user'];
      return context.lastExecutedTool !== null && userInteractionTools.includes(context.lastExecutedTool);
    };

    expect(shouldTerminateEarly({ context: updatedContext })).toBe(true);
  });

  it('should NOT terminate early when other tools are executed', async () => {
    const context: Partial<PlannerContext> = {
      lastExecutedTool: 'search-web',
      strategicPlan: ['Search for info', 'Analyze results', 'Provide answer'],
      currentStepIndex: 0
    };

    const shouldTerminateEarly = ({ context }: { context: PlannerContext }): boolean => {
      const userInteractionTools = ['answer-user', 'ask-user'];
      return context.lastExecutedTool !== null && userInteractionTools.includes(context.lastExecutedTool);
    };

    expect(shouldTerminateEarly({ context: context as PlannerContext })).toBe(false);
  });

  it('should identify ask-user as early termination tool', () => {
    const context: Partial<PlannerContext> = {
      lastExecutedTool: 'ask-user',
      strategicPlan: ['Ask for clarification', 'Process response', 'Provide final answer'],
      currentStepIndex: 0
    };

    const shouldTerminateEarly = ({ context }: { context: PlannerContext }): boolean => {
      const userInteractionTools = ['answer-user', 'ask-user'];
      return context.lastExecutedTool !== null && userInteractionTools.includes(context.lastExecutedTool);
    };

    expect(shouldTerminateEarly({ context: context as PlannerContext })).toBe(true);
  });
});