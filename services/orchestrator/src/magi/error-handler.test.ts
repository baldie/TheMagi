import { MagiErrorHandler } from './error-handler';
import type { ErrorContext } from './error-handler';
import { MagiName } from './magi2';

// Mock logger to capture log calls
jest.mock('../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockLogger = require('../logger').logger;

// Mock Date.now for timing tests
const mockDateNow = jest.spyOn(Date, 'now');

describe('MagiErrorHandler', () => {
  let context: ErrorContext;

  beforeEach(() => {
    context = {
      magiName: MagiName.Caspar,
      operation: 'test-operation'
    };
    jest.clearAllMocks();
    mockDateNow.mockReturnValue(1000);
  });

  afterAll(() => {
    mockDateNow.mockRestore();
  });

  describe('withErrorHandling', () => {
    it('should execute operation successfully without retries', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      
      const result = await MagiErrorHandler.withErrorHandling(operation, context);
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should log success with timing when startTime is provided', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      const contextWithTiming = { ...context, startTime: 500 };
      mockDateNow.mockReturnValue(1500); // 1000ms duration
      
      await MagiErrorHandler.withErrorHandling(operation, contextWithTiming);
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        `${context.magiName} ${context.operation} completed in 1000ms`
      );
    });

    it('should not log success timing when startTime is not provided', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      
      await MagiErrorHandler.withErrorHandling(operation, context);
      
      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should retry on failure and eventually succeed', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockRejectedValueOnce(new Error('Second failure'))
        .mockResolvedValue('success');
      
      const result = await MagiErrorHandler.withErrorHandling(operation, context, 3);
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
      expect(mockLogger.warn).toHaveBeenCalledTimes(2);
      expect(mockLogger.warn).toHaveBeenNthCalledWith(1,
        `${context.magiName} ${context.operation} failed (attempt 1/4), retrying...`
      );
      expect(mockLogger.warn).toHaveBeenNthCalledWith(2,
        `${context.magiName} ${context.operation} failed (attempt 2/4), retrying...`
      );
    });

    it('should throw error after max retries exceeded', async () => {
      const error = new Error('Persistent failure');
      const operation = jest.fn().mockRejectedValue(error);
      
      await expect(
        MagiErrorHandler.withErrorHandling(operation, context, 2)
      ).rejects.toThrow('Caspar test-operation failed: Persistent failure');
      
      expect(operation).toHaveBeenCalledTimes(3); // Initial + 2 retries
      expect(mockLogger.warn).toHaveBeenCalledTimes(2);
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
    });

    it('should handle non-Error objects', async () => {
      const operation = jest.fn().mockRejectedValue('string error');
      
      await expect(
        MagiErrorHandler.withErrorHandling(operation, context)
      ).rejects.toThrow('Caspar test-operation failed: string error');
    });

    it('should log final error with timing', async () => {
      const error = new Error('Test error');
      const operation = jest.fn().mockRejectedValue(error);
      mockDateNow.mockReturnValueOnce(1000).mockReturnValueOnce(1500); // 500ms duration
      
      await expect(
        MagiErrorHandler.withErrorHandling(operation, context)
      ).rejects.toThrow();
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        `${context.magiName} ${context.operation} failed after 500ms`,
        error
      );
    });

    it('should log axios error details when present', async () => {
      const axiosError = {
        response: {
          data: { error: 'API error', code: 500 }
        }
      };
      const operation = jest.fn().mockRejectedValue(axiosError);
      
      await expect(
        MagiErrorHandler.withErrorHandling(operation, context)
      ).rejects.toThrow();
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        `${context.magiName} ${context.operation} API error response: ${JSON.stringify(axiosError.response.data)}`
      );
    });

    it('should not crash when axios error has no response data', async () => {
      const axiosError = { response: {} };
      const operation = jest.fn().mockRejectedValue(axiosError);
      
      await expect(
        MagiErrorHandler.withErrorHandling(operation, context)
      ).rejects.toThrow();
      
      // Should not call the axios error logging since there's no data
      expect(mockLogger.error).toHaveBeenCalledTimes(1); // Only the final error log
    });
  });

  describe('handleToolError', () => {
    it('should log error and return fallback message', () => {
      const error = new Error('Tool failed');
      
      const result = MagiErrorHandler.handleToolError(error, context);
      
      expect(result).toBe('Tool execution failed, proceeding with reasoning-based analysis for');
      expect(mockLogger.error).toHaveBeenCalledWith(
        `${context.magiName} tool execution failed: ${error}`
      );
    });

    it('should handle non-Error objects', () => {
      const error = 'string error';
      
      const result = MagiErrorHandler.handleToolError(error, context);
      
      expect(result).toBe('Tool execution failed, proceeding with reasoning-based analysis for');
      expect(mockLogger.error).toHaveBeenCalledWith(
        `${context.magiName} tool execution failed: ${error}`
      );
    });
  });

  describe('createContextualError', () => {
    it('should create error with contextual message from Error object', () => {
      const originalError = new Error('Original message');
      originalError.stack = 'original stack trace';
      
      const contextualError = MagiErrorHandler.createContextualError(originalError, context);
      
      expect(contextualError.message).toBe('Caspar test-operation failed: Original message');
      expect(contextualError.stack).toBe('original stack trace');
    });

    it('should create error from non-Error object', () => {
      const error = 'string error';
      
      const contextualError = MagiErrorHandler.createContextualError(error, context);
      
      expect(contextualError.message).toBe('Caspar test-operation failed: string error');
      expect(contextualError).toBeInstanceOf(Error);
    });

    it('should handle null/undefined errors', () => {
      const contextualError = MagiErrorHandler.createContextualError(null, context);
      
      expect(contextualError.message).toBe('Caspar test-operation failed: null');
    });

    it('should handle object errors', () => {
      const error = { type: 'custom', message: 'object error' };
      
      const contextualError = MagiErrorHandler.createContextualError(error, context);
      
      expect(contextualError.message).toBe('Caspar test-operation failed: [object Object]');
    });
  });

  describe('handleJsonParseError', () => {
    it('should throw error with context and log details', () => {
      const parseError = new Error('Unexpected token');
      const response = '{"invalid": json}';
      
      expect(() => {
        MagiErrorHandler.handleJsonParseError(parseError, response, context);
      }).toThrow('JSON parsing failed for Caspar: Unexpected token');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        `${context.magiName} failed to parse JSON response. Error: Unexpected token`
      );
      expect(mockLogger.error).toHaveBeenCalledWith(`\n\n${response}\n\n`);
    });

    it('should handle non-Error objects', () => {
      const parseError = 'parse failed';
      const response = 'invalid json';
      
      expect(() => {
        MagiErrorHandler.handleJsonParseError(parseError, response, context);
      }).toThrow('JSON parsing failed for Caspar: Unknown error');
      
      expect(mockLogger.error).toHaveBeenCalledWith(
        `${context.magiName} failed to parse JSON response. Error: Unknown error`
      );
    });

    it('should log the full response for debugging', () => {
      const parseError = new Error('Parse error');
      const response = 'This is a very long response that should be logged';
      
      expect(() => {
        MagiErrorHandler.handleJsonParseError(parseError, response, context);
      }).toThrow();
      
      expect(mockLogger.error).toHaveBeenCalledWith(`\n\n${response}\n\n`);
    });
  });

  describe('edge cases and integration', () => {
    it('should handle zero retries correctly', async () => {
      const error = new Error('Immediate failure');
      const operation = jest.fn().mockRejectedValue(error);
      
      await expect(
        MagiErrorHandler.withErrorHandling(operation, context, 0)
      ).rejects.toThrow();
      
      expect(operation).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).not.toHaveBeenCalled(); // No retry warnings
    });

    it('should handle operation that throws synchronously', async () => {
      const operation = jest.fn().mockImplementation(() => {
        throw new Error('Sync error');
      });
      
      await expect(
        MagiErrorHandler.withErrorHandling(operation, context)
      ).rejects.toThrow('Caspar test-operation failed: Sync error');
    });

    it('should preserve original error properties in contextual error', () => {
      const originalError = new Error('Original');
      (originalError as any).customProperty = 'custom value';
      originalError.stack = 'custom stack';
      
      const contextualError = MagiErrorHandler.createContextualError(originalError, context);
      
      expect(contextualError.message).toBe('Caspar test-operation failed: Original');
      expect(contextualError.stack).toBe('custom stack');
      // Note: customProperty won't be preserved as we create a new Error object
    });

    it('should work with different magi names', () => {
      const melchiorContext = { ...context, magiName: MagiName.Melchior };
      const error = new Error('Test');
      
      const contextualError = MagiErrorHandler.createContextualError(error, melchiorContext);
      
      expect(contextualError.message).toBe('Melchior test-operation failed: Test');
    });

    it('should handle very large retry counts', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');
      
      const result = await MagiErrorHandler.withErrorHandling(operation, context, 100);
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2); // Should succeed on second attempt
    });
  });
});