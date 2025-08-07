import type { ConduitClient } from './conduit-client';
import type { ToolUser } from './tool-user';
import type { ShortTermMemory } from './short-term-memory';
import type { MagiName } from '../types/magi-types';
import type { MagiTool } from '../mcp';
import type { AgenticTool } from './magi';

// Constants
export const MAX_RETRIES = 3;
export const TIMEOUT_MS = 30000; // 30 seconds

// ============================================================================
// SHARED TYPE DEFINITIONS
// ============================================================================

/**
 * Context for the high-level Planner machine
 */
export interface PlannerContext {
  userMessage: string;
  strategicPlan: string[];
  currentStepIndex: number;
  currentGoal: string;
  agentResult: string | null;
  error: string | null;
  magiName: MagiName;
  conduitClient: ConduitClient;
  toolUser: ToolUser;
  shortTermMemory: ShortTermMemory;
  availableTools: MagiTool[];
  workingMemory: string;
  // Discovery tracking
  currentDiscovery: Discovery | null;
  planRevisions: Array<{ reason: string; originalPlan: string[]; newPlan: string[] }>;
}

/**
 * Context for the tactical Agent machine
 */
export interface AgentContext {
  // Goal and planning
  strategicGoal: string;
  currentSubGoal: string;
  
  // Memory and context
  fullContext: string;
  promptContext: string;
  workingMemory: string;
  
  // Tool execution
  selectedTool: AgenticTool | null;
  toolInput: Record<string, unknown>;
  toolOutput: string;
  processedOutput: string;
  
  // Web-search follow-up flags
  shouldFollowUpWithRead?: boolean;
  followUpUrl?: string;
  
  // Tracking and control
  completedSubGoals: string[];
  retryCount: number;
  error: string | null;
  
  // Discovery reporting
  goalCompletionResult: GoalCompletionResult | null;
  
  // Circuit breaker and reliability
  circuitBreakerContext: CircuitBreakerContext | null;
  lastExecutionTime: number;
  
  // Integration points
  magiName: MagiName;
  conduitClient: ConduitClient;
  toolUser: ToolUser;
  shortTermMemory: ShortTermMemory;
  availableTools: MagiTool[];
}

/**
 * Events for the Planner machine - using discriminated unions
 */
export type PlannerEvent = 
  | { type: 'START' }
  | { type: 'PLAN_CREATED'; strategicPlan: string[] }
  | { type: 'AGENT_COMPLETED'; result: string }
  | { type: 'AGENT_FAILED'; error: string }
  | { type: 'DISCOVERY_REPORTED'; discovery: Discovery; result: string }
  | { type: 'PLAN_EVALUATION_COMPLETE'; shouldAdapt: boolean }
  | { type: 'PLAN_ADAPTED'; newPlan: string[] }
  | { type: 'RETRY_REQUESTED' }
  | { type: 'PLAN_COMPLETE' }
  | { type: 'PLAN_FAILED'; reason: string }
  | { type: 'TIMEOUT'; duration: number }
  | { type: 'CIRCUIT_BREAKER_OPEN' };

/**
 * Events for the Agent machine - using discriminated unions
 */
export type AgentEvent = 
  | { type: 'START' }
  | { type: 'CONTEXT_GATHERED'; context: string }
  | { type: 'SYNTHESIZED'; promptContext: string }
  | { type: 'SUBGOAL_DETERMINED'; subGoal: string }
  | { type: 'TOOL_SELECTED'; tool: AgenticTool }
  | { type: 'INPUT_VALIDATED'; isValid: boolean }
  | { type: 'TOOL_EXECUTED'; output: string }
  | { type: 'OUTPUT_PROCESSED'; processedOutput: string }
  | { type: 'SUBGOAL_COMPLETE' }
  | { type: 'SUBGOAL_INCOMPLETE'; reason: string }
  | { type: 'GOAL_COMPLETE' }
  | { type: 'GOAL_INCOMPLETE'; reason: string }
  | { type: 'RETRY_REQUESTED' }
  | { type: 'VALIDATION_FAILED'; errors: string[] }
  | { type: 'MAX_RETRIES_REACHED'; attemptCount: number }
  | { type: 'TIMEOUT'; duration: number }
  | { type: 'CIRCUIT_BREAKER_OPEN' };

/**
 * Tool execution result
 */
export interface ToolExecutionResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * State validation result
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Circuit breaker states
 */
export enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  monitoringWindow: number;
}

/**
 * Circuit breaker context
 */
export interface CircuitBreakerContext {
  state: CircuitBreakerState;
  failureCount: number;
  lastFailureTime: number;
  config: CircuitBreakerConfig;
}

/**
 * Discovery types that agents can report to planners
 */
export type DiscoveryType = 'opportunity' | 'obstacle' | 'impossibility';

/**
 * Discovery information reported by agents
 */
export interface Discovery {
  type: DiscoveryType;
  details: string;
  context: string;
}

/**
 * Enhanced goal completion result with discovery reporting
 */
export interface GoalCompletionResult {
  achieved: boolean;
  confidence: number;
  reason: string;
  hasDiscovery?: boolean;
  discovery?: Discovery;
}

/**
 * Runtime type validation functions
 */
export const TypeValidators = {
  isString: (value: unknown): value is string => typeof value === 'string',
  isNonEmptyString: (value: unknown): value is string => 
    typeof value === 'string' && value.trim().length > 0,
  isObject: (value: unknown): value is Record<string, unknown> => 
    value !== null && typeof value === 'object' && !Array.isArray(value),
  isArray: (value: unknown): value is unknown[] => Array.isArray(value),
  isStringArray: (value: unknown): value is string[] => 
    Array.isArray(value) && value.every(item => typeof item === 'string'),
  
  validatePlannerContext: (context: Partial<PlannerContext>): ValidationResult => {
    const errors: string[] = [];
    
    if (!TypeValidators.isNonEmptyString(context.userMessage)) {
      errors.push('userMessage must be a non-empty string');
    }
    
    if (!context.magiName || !TypeValidators.isNonEmptyString(context.magiName)) {
      errors.push('magiName must be a non-empty string');
    }
    
    if (context.strategicPlan && !TypeValidators.isStringArray(context.strategicPlan)) {
      errors.push('strategicPlan must be an array of strings');
    }
    
    if (!context.conduitClient) {
      errors.push('conduitClient is required');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  },
  
  validateAgentContext: (context: Partial<AgentContext>): ValidationResult => {
    const errors: string[] = [];
    
    if (!TypeValidators.isNonEmptyString(context.strategicGoal)) {
      errors.push('strategicGoal must be a non-empty string');
    }
    
    if (!context.magiName || !TypeValidators.isNonEmptyString(context.magiName)) {
      errors.push('magiName must be a non-empty string');
    }
    
    if (!context.conduitClient) {
      errors.push('conduitClient is required');
    }
    
    if (!context.toolUser) {
      errors.push('toolUser is required');
    }
    
    if (context.availableTools && !Array.isArray(context.availableTools)) {
      errors.push('availableTools must be an array');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
};