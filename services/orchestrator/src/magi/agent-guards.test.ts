import { 
  isContextValid, 
  canRetry, 
  isToolValid, 
  shouldFollowUpWithRead, 
  shouldStopForStagnation 
} from './agent-guards';
import { MagiName } from './magi2';
import type { AgentContext } from './types';
import { MAX_RETRIES } from './types';

// Mock logger to avoid console output during tests
jest.mock('../logger', () => ({
  logger: {
    warn: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn()
  }
}));

// Mock ToolExecutor
jest.mock('./tool-executor', () => ({
  ToolExecutor: jest.fn().mockImplementation(() => ({
    validateTool: jest.fn().mockReturnValue({ isValid: true, errors: [] })
  }))
}));

describe('Agent Guards', () => {
  const createMockContext = (overrides: Partial<AgentContext> = {}): AgentContext => ({
    userMessage: 'test message',
    strategicGoal: 'test goal',
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
    goalCompletionResult: null,
    magiName: MagiName.Caspar,
    conduitClient: {} as any,
    toolUser: {} as any,
    shortTermMemory: {} as any,
    availableTools: [],
    circuitBreakerContext: null,
    lastExecutionTime: 0,
    cycleCount: 1,
    maxCycles: 30,
    lastProgressCycle: 0,
    shouldFollowUpWithRead: false,
    followUpUrl: '',
    ...overrides
  });

  describe('isContextValid', () => {
    it('should return true for valid context', () => {
      const context = createMockContext();
      const result = isContextValid({ context });
      expect(result).toBe(true);
    });

    it('should return false when strategic goal is missing', () => {
      const context = createMockContext({ strategicGoal: '' });
      const result = isContextValid({ context });
      expect(result).toBe(false);
    });

    it('should return false when strategic goal is only whitespace', () => {
      const context = createMockContext({ strategicGoal: '   ' });
      const result = isContextValid({ context });
      expect(result).toBe(false);
    });

    it('should return false when conduit client is missing', () => {
      const context = createMockContext({ conduitClient: null as any });
      const result = isContextValid({ context });
      expect(result).toBe(false);
    });

    it('should return false when tool user is missing', () => {
      const context = createMockContext({ toolUser: null as any });
      const result = isContextValid({ context });
      expect(result).toBe(false);
    });

    it('should return false when multiple fields are invalid', () => {
      const context = createMockContext({ 
        strategicGoal: '', 
        conduitClient: null as any,
        toolUser: null as any
      });
      const result = isContextValid({ context });
      expect(result).toBe(false);
    });
  });

  describe('canRetry', () => {
    it('should return true when retry count is below max', () => {
      const context = createMockContext({ retryCount: 1 });
      const result = canRetry({ context });
      expect(result).toBe(true);
    });

    it('should return true when retry count equals zero', () => {
      const context = createMockContext({ retryCount: 0 });
      const result = canRetry({ context });
      expect(result).toBe(true);
    });

    it('should return false when retry count equals max', () => {
      const context = createMockContext({ retryCount: MAX_RETRIES });
      const result = canRetry({ context });
      expect(result).toBe(false);
    });

    it('should return false when retry count exceeds max', () => {
      const context = createMockContext({ retryCount: MAX_RETRIES + 1 });
      const result = canRetry({ context });
      expect(result).toBe(false);
    });
  });

  describe('isToolValid', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mockToolExecutor = require('./tool-executor').ToolExecutor;

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return false when no tool is selected', () => {
      const context = createMockContext({ selectedTool: null });
      const result = isToolValid({ context });
      expect(result).toBe(false);
    });

    it('should return true when tool validation passes', () => {
      const mockTool = { name: 'test-tool', parameters: {} };
      const context = createMockContext({ selectedTool: mockTool });
      
      mockToolExecutor.mockImplementation(() => ({
        validateTool: jest.fn().mockReturnValue({ isValid: true, errors: [] })
      }));

      const result = isToolValid({ context });
      expect(result).toBe(true);
    });

    it('should return false when tool validation fails', () => {
      const mockTool = { name: 'invalid-tool', parameters: {} };
      const context = createMockContext({ selectedTool: mockTool });
      
      mockToolExecutor.mockImplementation(() => ({
        validateTool: jest.fn().mockReturnValue({ 
          isValid: false, 
          errors: ['Tool not found'] 
        })
      }));

      const result = isToolValid({ context });
      expect(result).toBe(false);
    });

    it('should create ToolExecutor with correct parameters', () => {
      const mockTool = { name: 'test-tool', parameters: {} };
      const context = createMockContext({ selectedTool: mockTool });
      
      isToolValid({ context });
      
      expect(mockToolExecutor).toHaveBeenCalledWith(
        context.toolUser,
        context.magiName,
        expect.any(Number)
      );
    });
  });

  describe('shouldFollowUpWithRead', () => {
    it('should return true when followUp flag is true and URL is provided', () => {
      const context = createMockContext({ 
        shouldFollowUpWithRead: true,
        followUpUrl: 'https://example.com'
      });
      const result = shouldFollowUpWithRead({ context });
      expect(result).toBe(true);
    });

    it('should return false when followUp flag is false', () => {
      const context = createMockContext({ 
        shouldFollowUpWithRead: false,
        followUpUrl: 'https://example.com'
      });
      const result = shouldFollowUpWithRead({ context });
      expect(result).toBe(false);
    });

    it('should return false when URL is empty', () => {
      const context = createMockContext({ 
        shouldFollowUpWithRead: true,
        followUpUrl: ''
      });
      const result = shouldFollowUpWithRead({ context });
      expect(result).toBe(false);
    });

    it('should return false when URL is only whitespace', () => {
      const context = createMockContext({ 
        shouldFollowUpWithRead: true,
        followUpUrl: '   '
      });
      const result = shouldFollowUpWithRead({ context });
      expect(result).toBe(false);
    });

    it('should return false when URL is null', () => {
      const context = createMockContext({ 
        shouldFollowUpWithRead: true,
        followUpUrl: null as any
      });
      const result = shouldFollowUpWithRead({ context });
      expect(result).toBe(false);
    });
  });

  describe('shouldStopForStagnation', () => {
    it('should return true when cycle count exceeds max cycles', () => {
      const context = createMockContext({ 
        cycleCount: 31,
        maxCycles: 30,
        lastProgressCycle: 25
      });
      const result = shouldStopForStagnation({ context });
      expect(result).toBe(true);
    });

    it('should return true when cycle count equals max cycles', () => {
      const context = createMockContext({ 
        cycleCount: 30,
        maxCycles: 30,
        lastProgressCycle: 25
      });
      const result = shouldStopForStagnation({ context });
      expect(result).toBe(true);
    });

    it('should return true when no progress for more than 5 cycles', () => {
      const context = createMockContext({ 
        cycleCount: 20,
        maxCycles: 30,
        lastProgressCycle: 14  // 20 - 14 = 6 cycles without progress
      });
      const result = shouldStopForStagnation({ context });
      expect(result).toBe(true);
    });

    it('should return true when no progress for exactly 6 cycles', () => {
      const context = createMockContext({ 
        cycleCount: 10,
        maxCycles: 30,
        lastProgressCycle: 4   // 10 - 4 = 6 cycles without progress
      });
      const result = shouldStopForStagnation({ context });
      expect(result).toBe(true);
    });

    it('should return false when within max cycles and recent progress', () => {
      const context = createMockContext({ 
        cycleCount: 15,
        maxCycles: 30,
        lastProgressCycle: 12  // 15 - 12 = 3 cycles without progress
      });
      const result = shouldStopForStagnation({ context });
      expect(result).toBe(false);
    });

    it('should return false when exactly 5 cycles without progress', () => {
      const context = createMockContext({ 
        cycleCount: 10,
        maxCycles: 30,
        lastProgressCycle: 5   // 10 - 5 = 5 cycles without progress
      });
      const result = shouldStopForStagnation({ context });
      expect(result).toBe(false);
    });

    it('should return false when progress was made in current cycle', () => {
      const context = createMockContext({ 
        cycleCount: 5,
        maxCycles: 30,
        lastProgressCycle: 5   // Progress in current cycle
      });
      const result = shouldStopForStagnation({ context });
      expect(result).toBe(false);
    });
  });
});