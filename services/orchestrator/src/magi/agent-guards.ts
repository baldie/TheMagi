import { logger } from '../logger';
import { ToolExecutor } from './tool-executor';
import type { AgentContext } from './types';
import { MAX_RETRIES } from './types';

// ============================================================================
// AGENT GUARDS - Boolean checks for state machine transitions
// ============================================================================

/**
 * Validates context before state transitions
 */
export const isContextValid = ({ context }: { context: AgentContext }): boolean => {
  const errors: string[] = [];

  if (!context.strategicGoal?.trim()) {
    errors.push('Missing strategic goal');
  }

  if (!context.conduitClient) {
    errors.push('Missing conduit client');
  }

  if (!context.toolUser) {
    errors.push('Missing tool user');
  }

  if (errors.length > 0) {
    logger.warn(`${context.magiName} context validation failed:`, errors);
    return false;
  }

  return true;
};

/**
 * Checks if retry limit has been reached (circuit breaker pattern)
 */
export const canRetry = ({ context }: { context: AgentContext }): boolean => {
  const canRetryResult = context.retryCount < MAX_RETRIES;
  if (!canRetryResult) {
    logger.warn(`${context.magiName} max retries (${MAX_RETRIES}) reached`);
  }
  return canRetryResult;
};

/**
 * Validates tool selection
 */
export const isToolValid = ({ context }: { context: AgentContext }): boolean => {
  if (!context.selectedTool) {
    return false;
  }

  const toolExecutor = new ToolExecutor(context.toolUser, context.magiName);
  const validation = toolExecutor.validateTool(context.selectedTool);
  
  if (!validation.isValid) {
    logger.warn(`${context.magiName} tool validation failed:`, validation.errors);
  }

  return validation.isValid;
};

/**
 * Checks if we should follow up web-search with read-page
 */
export const shouldFollowUpWithRead = ({ context }: { context: AgentContext }): boolean => {
  return context.shouldFollowUpWithRead === true && !!context.followUpUrl?.trim();
};