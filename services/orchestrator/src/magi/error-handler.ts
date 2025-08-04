import { logger } from '../logger';
import type { MagiName } from './magi';

export interface ErrorContext {
  magiName: MagiName;
  operation: string;
  startTime?: number;
}

export class MagiErrorHandler {
  /**
   * Execute an operation with unified error handling and optional retry logic
   */
  static async withErrorHandling<T>(
    operation: () => Promise<T>,
    context: ErrorContext,
    maxRetries: number = 0
  ): Promise<T> {
    const startTime = context.startTime ?? Date.now();
    let lastError: Error;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation();
        this.logSuccessIfNeeded(context, startTime);
        return result;
      } catch (error) {
        lastError = error as Error;
        
        if (this.shouldRetry(attempt, maxRetries)) {
          this.logRetryAttempt(context, attempt, maxRetries);
          continue;
        }
        
        this.logFinalError(error, context, startTime);
        throw this.createContextualError(error, context);
      }
    }
    lastError = new Error(`Operation failed after ${maxRetries + 1} attempts`);
    throw lastError;
  }

  /**
   * Log successful operation completion if timing is tracked
   */
  private static logSuccessIfNeeded(context: ErrorContext, startTime: number): void {
    if (context.startTime) {
      const duration = Date.now() - startTime;
      logger.info(`${context.magiName} ${context.operation} completed in ${duration}ms`);
    }
  }

  /**
   * Check if operation should be retried
   */
  private static shouldRetry(attempt: number, maxRetries: number): boolean {
    return attempt < maxRetries;
  }

  /**
   * Log retry attempt
   */
  private static logRetryAttempt(context: ErrorContext, attempt: number, maxRetries: number): void {
    logger.warn(`${context.magiName} ${context.operation} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying...`);
  }

  /**
   * Log final error with additional details
   */
  private static logFinalError(error: unknown, context: ErrorContext, startTime: number): void {
    const duration = Date.now() - startTime;
    
    this.logAxiosErrorDetails(error, context);
    logger.error(`${context.magiName} ${context.operation} failed after ${duration}ms`, error);
  }

  /**
   * Log axios error details if available
   */
  private static logAxiosErrorDetails(error: unknown, context: ErrorContext): void {
    if (error && typeof error === 'object' && 'response' in error) {
      const axiosError = error as any;
      if (axiosError.response?.data) {
        logger.error(`${context.magiName} ${context.operation} API error response: ${JSON.stringify(axiosError.response.data)}`);
      }
    }
  }

  /**
   * Handle tool execution errors with fallback messaging
   */
  static handleToolError(error: unknown, context: ErrorContext): string {
    logger.error(`${context.magiName} tool execution failed: ${error}`);
    return 'Tool execution failed, proceeding with reasoning-based analysis for';
  }

  /**
   * Create a contextual error with enhanced messaging
   */
  static createContextualError(error: unknown, context: ErrorContext): Error {
    const originalMessage = error instanceof Error ? error.message : String(error);
    const contextualMessage = `${context.magiName} ${context.operation} failed: ${originalMessage}`;
    
    if (error instanceof Error) {
      const contextualError = new Error(contextualMessage);
      contextualError.stack = error.stack;
      return contextualError;
    }
    
    return new Error(contextualMessage);
  }

  /**
   * Handle JSON parsing errors with enhanced context
   */
  static handleJsonParseError(error: unknown, response: string, context: ErrorContext): never {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`${context.magiName} failed to parse JSON response. Error: ${errorMessage}`);
    logger.error(`\n\n${response}\n\n`);
    
    throw new Error(`JSON parsing failed for ${context.magiName}: ${errorMessage}`);
  }
}