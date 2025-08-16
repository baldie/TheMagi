import { CircuitBreaker, DEFAULT_CIRCUIT_BREAKER_CONFIG } from './circuit-breaker';
import { CircuitBreakerState } from './types';
import type { CircuitBreakerConfig } from './types';

// Mock logger to avoid console output during tests
jest.mock('../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn()
  }
}));

// Mock Date.now for consistent timing tests
const mockDateNow = jest.spyOn(Date, 'now');

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;
  let config: CircuitBreakerConfig;

  beforeEach(() => {
    config = {
      failureThreshold: 3,
      recoveryTimeout: 5000,
      monitoringWindow: 10000
    };
    circuitBreaker = new CircuitBreaker(config);
    mockDateNow.mockReturnValue(1000); // Fixed timestamp for consistent tests
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    mockDateNow.mockRestore();
  });

  describe('constructor', () => {
    it('should initialize with CLOSED state', () => {
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should initialize with zero failure count', () => {
      expect(circuitBreaker.getFailureCount()).toBe(0);
    });

    it('should use provided config', () => {
      const customConfig = { failureThreshold: 5, recoveryTimeout: 10000, monitoringWindow: 20000 };
      const customBreaker = new CircuitBreaker(customConfig);
      expect(customBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });
  });

  describe('canExecute', () => {
    it('should allow execution when circuit is CLOSED', () => {
      expect(circuitBreaker.canExecute()).toBe(true);
    });

    it('should deny execution when circuit is OPEN and recovery time not elapsed', () => {
      // Force circuit to OPEN state
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitBreaker.recordFailure();
      }
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
      expect(circuitBreaker.canExecute()).toBe(false);
    });

    it('should transition to HALF_OPEN and allow execution after recovery timeout', () => {
      // Force circuit to OPEN state
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitBreaker.recordFailure();
      }
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);

      // Advance time past recovery timeout
      mockDateNow.mockReturnValue(1000 + config.recoveryTimeout + 1);
      
      expect(circuitBreaker.canExecute()).toBe(true);
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);
    });

    it('should allow execution when circuit is HALF_OPEN', () => {
      // Manually set to HALF_OPEN state
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure(); // Should be OPEN now
      
      // Advance time to trigger transition to HALF_OPEN
      mockDateNow.mockReturnValue(1000 + config.recoveryTimeout + 1);
      circuitBreaker.canExecute(); // This should transition to HALF_OPEN
      
      expect(circuitBreaker.canExecute()).toBe(true);
    });
  });

  describe('recordSuccess', () => {
    it('should reset failure count to zero', () => {
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      expect(circuitBreaker.getFailureCount()).toBe(2);

      circuitBreaker.recordSuccess();
      expect(circuitBreaker.getFailureCount()).toBe(0);
    });

    it('should set state to CLOSED', () => {
      // Force to OPEN state
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitBreaker.recordFailure();
      }
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);

      circuitBreaker.recordSuccess();
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should transition from HALF_OPEN to CLOSED on success', () => {
      // Get to HALF_OPEN state
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitBreaker.recordFailure();
      }
      mockDateNow.mockReturnValue(1000 + config.recoveryTimeout + 1);
      circuitBreaker.canExecute(); // Transition to HALF_OPEN

      circuitBreaker.recordSuccess();
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });
  });

  describe('recordFailure', () => {
    it('should increment failure count', () => {
      expect(circuitBreaker.getFailureCount()).toBe(0);
      
      circuitBreaker.recordFailure();
      expect(circuitBreaker.getFailureCount()).toBe(1);
      
      circuitBreaker.recordFailure();
      expect(circuitBreaker.getFailureCount()).toBe(2);
    });

    it('should open circuit when failure threshold is reached', () => {
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);

      for (let i = 0; i < config.failureThreshold - 1; i++) {
        circuitBreaker.recordFailure();
        expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
      }

      circuitBreaker.recordFailure(); // This should open the circuit
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });

    it('should immediately open circuit if failure occurs in HALF_OPEN state', () => {
      // Get to HALF_OPEN state
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitBreaker.recordFailure();
      }
      mockDateNow.mockReturnValue(1000 + config.recoveryTimeout + 1);
      circuitBreaker.canExecute(); // Transition to HALF_OPEN
      
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);

      circuitBreaker.recordFailure();
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });

    it('should update last failure time', () => {
      const timestamp1 = 2000;
      const timestamp2 = 3000;

      mockDateNow.mockReturnValue(timestamp1);
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure(); // Should open circuit

      mockDateNow.mockReturnValue(timestamp2);
      circuitBreaker.recordFailure();

      // The last failure time should be updated to timestamp2
      // We can verify this indirectly by checking time until recovery
      expect(circuitBreaker.getTimeUntilRecovery()).toBeGreaterThan(0);
    });
  });

  describe('getState', () => {
    it('should return current state', () => {
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
      
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitBreaker.recordFailure();
      }
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });
  });

  describe('getFailureCount', () => {
    it('should return current failure count', () => {
      expect(circuitBreaker.getFailureCount()).toBe(0);
      
      circuitBreaker.recordFailure();
      expect(circuitBreaker.getFailureCount()).toBe(1);
      
      circuitBreaker.recordFailure();
      expect(circuitBreaker.getFailureCount()).toBe(2);
    });
  });

  describe('reset', () => {
    it('should reset to CLOSED state', () => {
      // Force to OPEN state
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitBreaker.recordFailure();
      }
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);

      circuitBreaker.reset();
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should reset failure count to zero', () => {
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      expect(circuitBreaker.getFailureCount()).toBe(2);

      circuitBreaker.reset();
      expect(circuitBreaker.getFailureCount()).toBe(0);
    });

    it('should reset last failure time', () => {
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure(); // Should be OPEN now

      circuitBreaker.reset();
      expect(circuitBreaker.getTimeUntilRecovery()).toBe(0);
    });
  });

  describe('getTimeUntilRecovery', () => {
    it('should return 0 when circuit is CLOSED', () => {
      expect(circuitBreaker.getTimeUntilRecovery()).toBe(0);
    });

    it('should return 0 when circuit is HALF_OPEN', () => {
      // Get to HALF_OPEN state
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitBreaker.recordFailure();
      }
      mockDateNow.mockReturnValue(1000 + config.recoveryTimeout + 1);
      circuitBreaker.canExecute(); // Transition to HALF_OPEN

      expect(circuitBreaker.getTimeUntilRecovery()).toBe(0);
    });

    it('should return remaining time when circuit is OPEN', () => {
      const failureTime = 2000;
      mockDateNow.mockReturnValue(failureTime);

      // Force to OPEN state
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitBreaker.recordFailure();
      }

      // Check immediately after failure
      const remaining = circuitBreaker.getTimeUntilRecovery();
      expect(remaining).toBe(config.recoveryTimeout);

      // Advance time partially
      mockDateNow.mockReturnValue(failureTime + 1000);
      expect(circuitBreaker.getTimeUntilRecovery()).toBe(config.recoveryTimeout - 1000);

      // Advance time past recovery timeout
      mockDateNow.mockReturnValue(failureTime + config.recoveryTimeout + 1000);
      expect(circuitBreaker.getTimeUntilRecovery()).toBe(0);
    });

    it('should not return negative values', () => {
      const failureTime = 2000;
      mockDateNow.mockReturnValue(failureTime);

      // Force to OPEN state
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitBreaker.recordFailure();
      }

      // Advance time way past recovery timeout
      mockDateNow.mockReturnValue(failureTime + config.recoveryTimeout * 2);
      expect(circuitBreaker.getTimeUntilRecovery()).toBe(0);
    });
  });

  describe('DEFAULT_CIRCUIT_BREAKER_CONFIG', () => {
    it('should have reasonable default values', () => {
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold).toBeGreaterThan(0);
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.recoveryTimeout).toBeGreaterThan(0);
      expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.monitoringWindow).toBeGreaterThan(0);
    });

    it('should be usable to create a circuit breaker', () => {
      const defaultBreaker = new CircuitBreaker(DEFAULT_CIRCUIT_BREAKER_CONFIG);
      expect(defaultBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
      expect(defaultBreaker.canExecute()).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle very small recovery timeout', () => {
      const quickConfig = { ...config, recoveryTimeout: 1 };
      const quickBreaker = new CircuitBreaker(quickConfig);

      // Force to OPEN
      for (let i = 0; i < quickConfig.failureThreshold; i++) {
        quickBreaker.recordFailure();
      }

      // Advance time by 2ms (past the 1ms recovery timeout)
      mockDateNow.mockReturnValue(1000 + 2);
      expect(quickBreaker.canExecute()).toBe(true);
      expect(quickBreaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);
    });

    it('should handle zero failure threshold edge case', () => {
      const zeroConfig = { ...config, failureThreshold: 0 };
      const zeroBreaker = new CircuitBreaker(zeroConfig);

      // Even one failure should open it
      zeroBreaker.recordFailure();
      expect(zeroBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });

    it('should handle multiple transitions correctly', () => {
      // CLOSED -> OPEN
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitBreaker.recordFailure();
      }
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);

      // OPEN -> HALF_OPEN
      mockDateNow.mockReturnValue(1000 + config.recoveryTimeout + 1);
      circuitBreaker.canExecute();
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.HALF_OPEN);

      // HALF_OPEN -> CLOSED (success)
      circuitBreaker.recordSuccess();
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);

      // CLOSED -> OPEN again
      for (let i = 0; i < config.failureThreshold; i++) {
        circuitBreaker.recordFailure();
      }
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);

      // OPEN -> HALF_OPEN -> OPEN (failure in half-open)
      mockDateNow.mockReturnValue(2000 + config.recoveryTimeout + 1);
      circuitBreaker.canExecute(); // HALF_OPEN
      circuitBreaker.recordFailure(); // Back to OPEN
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });
  });
});