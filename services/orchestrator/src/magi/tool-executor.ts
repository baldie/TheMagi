import { logger } from '../logger';
import type { ToolUser } from './tool-user';
import type { MagiName } from '../types/magi-types';
import type { AgenticTool } from './magi2';
import type { ToolExecutionResult } from './types';
import { testHooks } from '../testing/test-hooks';

/**
 * Service class for tool execution with timeout and error handling
 */
export class ToolExecutor {
  constructor(
    private readonly toolUser: ToolUser,
    private readonly magiName: MagiName,
    private readonly timeoutMs: number = 30000
  ) {}

  /**
   * Execute a tool with timeout and proper error handling
   */
  async execute(tool: AgenticTool): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    logger.debug(`${this.magiName} executing tool: ${tool.name}`);
    
    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Tool execution timed out after ${this.timeoutMs}ms`));
        }, this.timeoutMs);
      });

      // Execute tool with timeout
      const executionPromise = this.executeToolInternal(tool);
      const output = await Promise.race([executionPromise, timeoutPromise]);
      
      const duration = Date.now() - startTime;
      logger.debug(`${this.magiName} tool execution completed in ${duration}ms`);
      
      return {
        success: true,
        output: output
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      logger.error(`${this.magiName} tool execution failed after ${duration}ms:`, errorMessage);
      
      return {
        success: false,
        output: '',
        error: errorMessage
      };
    }
  }

  /**
   * Internal tool execution logic
   */
  private async executeToolInternal(tool: AgenticTool): Promise<string> {
    // Handle special tool cases
    if (tool.name === 'answer-user') {
      const answerText = (tool.parameters.answer as string) || 'No answer provided';
      try { testHooks.recordToolCall('answer-user', { answer: answerText }); } catch { /* no-op in non-test mode */ }
      return answerText;
    }
    
    if (tool.name === 'ask-user') {
      const questionText = (tool.parameters.question as string) || 'No question provided';
      try { testHooks.recordToolCall('ask-user', { question: questionText }); } catch { /* no-op in non-test mode */ }
      return questionText;
    }

    if (tool.name === 'process-info') {
      const rawInfo = (tool.parameters.raw_info as string) || 'No information provided';
      try { testHooks.recordToolCall('process-info', { raw_info: rawInfo }); } catch { /* no-op in non-test mode */ }
      return rawInfo;
    }
    
    // Execute regular tools through ToolUser
    return await this.toolUser.executeWithTool(tool.name, tool.parameters);
  }

  /**
   * Validate tool before execution
   */
  validateTool(tool: AgenticTool | null): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!tool) {
      errors.push('No tool selected');
      return { isValid: false, errors };
    }

    // Validate tool name
    if (!tool.name || typeof tool.name !== 'string') {
      errors.push('Invalid tool name');
    }

    // Validate tool parameters
    if (!tool.parameters || typeof tool.parameters !== 'object') {
      errors.push('Invalid tool parameters');
    }

    if (tool.name === 'read-page') {
      if (!Array.isArray(tool.parameters?.urls) || tool.parameters.urls.length === 0) {
        errors.push('read-page tool requires a non-empty urls array parameter');
      }
    }

    if (tool.name === 'search-web') {
      if (typeof tool.parameters?.query !== 'string' || !tool.parameters?.query.trim()) {
        errors.push('search-web tool requires a valid query parameter');
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
}