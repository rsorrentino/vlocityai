/**
 * Circuit Breaker Service
 * Implements circuit breaker pattern for fault tolerance and resilience
 */

const logger = require('../utils/logger');

class CircuitBreakerService {
  constructor() {
    this.circuits = new Map();
    this.defaultConfig = {
      failureThreshold: 5, // Open circuit after 5 failures
      successThreshold: 2, // Close circuit after 2 successes
      timeout: 60000, // 60 seconds timeout
      resetTimeout: 30000, // 30 seconds before attempting half-open
    };
  }

  /**
   * Create or get a circuit breaker
   */
  getCircuit(name, config = {}) {
    if (!this.circuits.has(name)) {
      this.circuits.set(name, {
        name,
        state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
        failureCount: 0,
        successCount: 0,
        lastFailureTime: null,
        lastSuccessTime: null,
        config: { ...this.defaultConfig, ...config },
        stats: {
          totalRequests: 0,
          totalFailures: 0,
          totalSuccesses: 0,
          totalTimeouts: 0,
        },
      });
    }
    return this.circuits.get(name);
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute(circuitName, operation, options = {}) {
    const circuit = this.getCircuit(circuitName, options.config);
    const startTime = Date.now();

    // Check circuit state
    if (circuit.state === 'OPEN') {
      // Check if we should attempt half-open
      if (this.shouldAttemptHalfOpen(circuit)) {
        circuit.state = 'HALF_OPEN';
        circuit.successCount = 0;
        logger.info(`Circuit ${circuitName} entering HALF_OPEN state`);
      } else {
        circuit.stats.totalRequests++;
        throw new CircuitBreakerOpenError(
          `Circuit breaker ${circuitName} is OPEN. Last failure: ${circuit.lastFailureTime}`,
          circuit
        );
      }
    }

    circuit.stats.totalRequests++;

    let timeoutId = null;
    try {
      // Execute with timeout
      const timeoutPromise = this.createTimeout(circuit.config.timeout, circuitName);
      timeoutId = timeoutPromise.timeoutId;
      
      const result = await Promise.race([
        operation(),
        timeoutPromise,
      ]);

      // Clear timeout if operation completed first
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      // Success
      this.recordSuccess(circuit);
      circuit.stats.totalSuccesses++;
      circuit.stats.totalTime += Date.now() - startTime;

      return result;
    } catch (error) {
      // Clear timeout on error
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      
      // Check if it's a timeout
      if (error instanceof CircuitBreakerTimeoutError) {
        circuit.stats.totalTimeouts++;
        this.recordFailure(circuit, error);
        throw error;
      }

      // Check if it's a circuit breaker error (don't count as failure)
      if (error instanceof CircuitBreakerOpenError) {
        throw error;
      }

      // Regular failure
      circuit.stats.totalFailures++;
      this.recordFailure(circuit, error);
      throw error;
    }
  }

  /**
   * Record success
   */
  recordSuccess(circuit) {
    circuit.lastSuccessTime = new Date();
    circuit.successCount++;
    circuit.failureCount = 0;

    // If in HALF_OPEN and we have enough successes, close the circuit
    if (circuit.state === 'HALF_OPEN' && circuit.successCount >= circuit.config.successThreshold) {
      circuit.state = 'CLOSED';
      circuit.successCount = 0;
      logger.info(`Circuit ${circuit.name} CLOSED after ${circuit.successCount} successes`);
    }
  }

  /**
   * Record failure
   */
  recordFailure(circuit, error) {
    circuit.lastFailureTime = new Date();
    circuit.failureCount++;
    circuit.successCount = 0;

    // If we've exceeded the failure threshold, open the circuit
    if (circuit.failureCount >= circuit.config.failureThreshold) {
      circuit.state = 'OPEN';
      logger.warn(`Circuit ${circuit.name} OPENED after ${circuit.failureCount} failures. Last error: ${error.message}`);
    }
  }

  /**
   * Check if we should attempt half-open
   */
  shouldAttemptHalfOpen(circuit) {
    if (!circuit.lastFailureTime) return true;

    const timeSinceLastFailure = Date.now() - circuit.lastFailureTime.getTime();
    return timeSinceLastFailure >= circuit.config.resetTimeout;
  }

  /**
   * Create timeout promise
   */
  createTimeout(timeoutMs, circuitName) {
    let timeoutId;
    const promise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new CircuitBreakerTimeoutError(
          `Circuit breaker ${circuitName} operation timed out after ${timeoutMs}ms`
        ));
      }, timeoutMs);
    });
    // Attach timeoutId to promise for cleanup
    promise.timeoutId = timeoutId;
    return promise;
  }

  /**
   * Get circuit state
   */
  getCircuitState(name) {
    const circuit = this.circuits.get(name);
    if (!circuit) return null;

    return {
      name: circuit.name,
      state: circuit.state,
      failureCount: circuit.failureCount,
      successCount: circuit.successCount,
      lastFailureTime: circuit.lastFailureTime,
      lastSuccessTime: circuit.lastSuccessTime,
      stats: { ...circuit.stats },
    };
  }

  /**
   * Get all circuit states
   */
  getAllCircuitStates() {
    const states = {};
    for (const [name, circuit] of this.circuits.entries()) {
      states[name] = this.getCircuitState(name);
    }
    return states;
  }

  /**
   * Reset a circuit
   */
  resetCircuit(name) {
    const circuit = this.circuits.get(name);
    if (circuit) {
      circuit.state = 'CLOSED';
      circuit.failureCount = 0;
      circuit.successCount = 0;
      circuit.lastFailureTime = null;
      circuit.lastSuccessTime = null;
      logger.info(`Circuit ${name} manually reset`);
    }
  }

  /**
   * Force open a circuit (for maintenance)
   */
  forceOpen(name) {
    const circuit = this.circuits.get(name);
    if (circuit) {
      circuit.state = 'OPEN';
      logger.info(`Circuit ${name} manually opened`);
    }
  }

  /**
   * Get circuit statistics
   */
  getCircuitStats(name) {
    const circuit = this.circuits.get(name);
    if (!circuit) return null;

    const stats = circuit.stats;
    const successRate = stats.totalRequests > 0
      ? (stats.totalSuccesses / stats.totalRequests) * 100
      : 0;
    const avgResponseTime = stats.totalSuccesses > 0
      ? stats.totalTime / stats.totalSuccesses
      : 0;

    return {
      ...stats,
      successRate: successRate.toFixed(2),
      avgResponseTime: avgResponseTime.toFixed(2),
      currentState: circuit.state,
    };
  }
}

/**
 * Circuit Breaker Open Error
 */
class CircuitBreakerOpenError extends Error {
  constructor(message, circuit) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
    this.circuit = circuit;
    this.statusCode = 503; // Service Unavailable
  }
}

/**
 * Circuit Breaker Timeout Error
 */
class CircuitBreakerTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CircuitBreakerTimeoutError';
    this.statusCode = 504; // Gateway Timeout
  }
}

// Singleton instance
let instance = null;

module.exports = function getCircuitBreakerService() {
  if (!instance) {
    instance = new CircuitBreakerService();
  }
  return instance;
};

module.exports.CircuitBreakerService = CircuitBreakerService;
module.exports.CircuitBreakerOpenError = CircuitBreakerOpenError;
module.exports.CircuitBreakerTimeoutError = CircuitBreakerTimeoutError;

