import { logger } from '../logger';
import { MagiName } from './magi';

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
    let lastError: Error;
    const startTime = context.startTime || Date.now();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation();
        
        if (context.startTime) {
          const duration = Date.now() - startTime;
          logger.info(`${context.magiName} ${context.operation} completed in ${duration}ms`);
        }
        
        return result;
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < maxRetries) {
          logger.warn(`${context.magiName} ${context.operation} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying...`);
          continue;
        }
        
        const duration = Date.now() - startTime;
        logger.error(`${context.magiName} ${context.operation} failed after ${duration}ms`, error);
        
        throw this.createContextualError(error, context);
      }
    }
    
    throw lastError!;
  }

  /**
   * Handle tool execution errors with fallback messaging
   */
  static handleToolError(error: unknown, context: ErrorContext, stepDescription: string): string {
    logger.error(`${context.magiName} tool execution failed: ${error}`);
    return `Tool execution failed, proceeding with reasoning-based analysis for: ${stepDescription}`;
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