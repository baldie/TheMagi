import { logger } from '../logger';
import type { 
  CircuitBreakerState, 
  CircuitBreakerConfig, 
  CircuitBreakerContext 
} from './types';

/**
 * Circuit breaker implementation to prevent infinite retry loops
 */
export class CircuitBreaker {
  private context: CircuitBreakerContext;

  constructor(config: CircuitBreakerConfig) {
    this.context = {
      state: CircuitBreakerState.CLOSED,
      failureCount: 0,
      lastFailureTime: 0,
      config
    };
  }

  /**
   * Check if the circuit breaker allows the operation to proceed
   */
  canExecute(): boolean {
    const now = Date.now();

    switch (this.context.state) {
      case CircuitBreakerState.CLOSED:
        return true;

      case CircuitBreakerState.OPEN:
        if (now - this.context.lastFailureTime >= this.context.config.recoveryTimeout) {
          logger.info('Circuit breaker transitioning to HALF_OPEN state');
          this.context.state = CircuitBreakerState.HALF_OPEN;
          return true;
        }
        return false;

      case CircuitBreakerState.HALF_OPEN:
        return true;

      default:
        return false;
    }
  }

  /**
   * Record a successful operation
   */
  recordSuccess(): void {
    this.context.failureCount = 0;
    this.context.state = CircuitBreakerState.CLOSED;
    logger.debug('Circuit breaker recorded success, state: CLOSED');
  }

  /**
   * Record a failed operation
   */
  recordFailure(): void {
    this.context.failureCount++;
    this.context.lastFailureTime = Date.now();

    if (this.context.state === CircuitBreakerState.HALF_OPEN) {
      logger.warn('Circuit breaker failed in HALF_OPEN state, opening circuit');
      this.context.state = CircuitBreakerState.OPEN;
    } else if (this.context.failureCount >= this.context.config.failureThreshold) {
      logger.warn(`Circuit breaker opening after ${this.context.failureCount} failures`);
      this.context.state = CircuitBreakerState.OPEN;
    }
  }

  /**
   * Get current circuit breaker state
   */
  getState(): CircuitBreakerState {
    return this.context.state;
  }

  /**
   * Get failure count
   */
  getFailureCount(): number {
    return this.context.failureCount;
  }

  /**
   * Reset the circuit breaker to initial state
   */
  reset(): void {
    this.context.state = CircuitBreakerState.CLOSED;
    this.context.failureCount = 0;
    this.context.lastFailureTime = 0;
    logger.info('Circuit breaker reset to CLOSED state');
  }

  /**
   * Get time until recovery (in ms) if circuit is open
   */
  getTimeUntilRecovery(): number {
    if (this.context.state !== CircuitBreakerState.OPEN) {
      return 0;
    }

    const elapsed = Date.now() - this.context.lastFailureTime;
    const remaining = this.context.config.recoveryTimeout - elapsed;
    return Math.max(0, remaining);
  }
}

/**
 * Default circuit breaker configuration
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  recoveryTimeout: 30000, // 30 seconds
  monitoringWindow: 60000  // 1 minute
};