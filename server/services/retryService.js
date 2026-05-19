const logger = require('../utils/logger');

/**
 * Retry Service
 * Provides retry logic with exponential backoff for handling transient errors
 * Based on patterns from official Vlocity Build Tool
 */
class RetryService {
  constructor() {
    this.maxRetries = 3;
    this.baseDelay = 1000; // 1 second base delay
    this.maxDelay = 30000; // 30 seconds max delay
    this.retryableErrors = [
      'ECONNRESET',
      'REQUEST_LIMIT_EXCEEDED',
      'ConcurrentPerOrgLongTxn',
      'TIMEOUT',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNREFUSED'
    ];
    this.retryableErrorMessages = [
      'System.LimitException',
      'REQUEST_LIMIT_EXCEEDED',
      'ConcurrentPerOrgLongTxn',
      'Too many SOQL queries'
    ];
  }

  /**
   * Execute a function with retry logic
   * @param {Function} fn - Function to execute
   * @param {Object} context - Context information for logging
   * @param {Object} options - Retry options
   * @returns {Promise<any>} Result of the function
   */
  async executeWithRetry(fn, context = {}, options = {}) {
    let tries = 0;
    const maxTries = options.maxRetries || this.maxRetries;
    const baseDelay = options.baseDelay || this.baseDelay;
    const maxDelay = options.maxDelay || this.maxDelay;
    const lastError = null;

    while (true) {
      try {
        const result = await fn();
        return result;
      } catch (err) {
        const isRetryable = this.isRetryableError(err);
        const errorInfo = this.extractErrorInfo(err);

        // If error is not retryable or we've exhausted retries, throw
        if (!isRetryable || tries >= maxTries) {
          if (tries > 0) {
            logger.warn('Retry exhausted', {
              ...context,
              tries,
              maxTries,
              error: errorInfo
            });
          }
          throw err;
        }

        // Calculate exponential backoff delay
        const delay = Math.min(
          baseDelay * Math.pow(2, tries),
          maxDelay
        );

        logger.warn(`Retrying after ${delay}ms (attempt ${tries + 1}/${maxTries})`, {
          ...context,
          error: errorInfo.message || errorInfo,
          errorCode: errorInfo.code,
          delay,
          attempt: tries + 1
        });

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, delay));
        tries++;
      }
    }
  }

  /**
   * Check if an error is retryable
   * @param {Error|Object} err - Error object
   * @returns {boolean} True if error is retryable
   */
  isRetryableError(err) {
    const errorInfo = this.extractErrorInfo(err);
    const errorCode = errorInfo.code;
    const errorMessage = errorInfo.message || '';

    // Check error code
    if (errorCode && this.retryableErrors.includes(errorCode)) {
      return true;
    }

    // Check error message for retryable patterns
    const isRetryableMessage = this.retryableErrorMessages.some(pattern =>
      errorMessage.includes(pattern)
    );

    if (isRetryableMessage) {
      return true;
    }

    // Special case: REQUEST_LIMIT_EXCEEDED with ConcurrentPerOrgLongTxn
    if (errorCode === 'REQUEST_LIMIT_EXCEEDED' &&
        errorMessage.includes('ConcurrentPerOrgLongTxn')) {
      return true;
    }

    return false;
  }

  /**
   * Extract error information from various error formats
   * @param {Error|Object} err - Error object
   * @returns {Object} Normalized error information
   */
  extractErrorInfo(err) {
    if (!err) {
      return { message: 'Unknown error' };
    }

    // Handle Error objects
    if (err instanceof Error) {
      return {
        code: err.code,
        message: err.message,
        stack: err.stack,
        name: err.name
      };
    }

    // Handle JSForce errors
    if (err.errorCode) {
      return {
        code: err.errorCode,
        message: err.message || err.errorCode,
        fields: err.fields
      };
    }

    // Handle plain objects
    if (typeof err === 'object') {
      return {
        code: err.code || err.errorCode,
        message: err.message || err.error || JSON.stringify(err),
        ...err
      };
    }

    // Handle strings
    return {
      message: String(err)
    };
  }

  /**
   * Execute multiple functions in parallel with retry logic
   * @param {Array<Function>} functions - Array of functions to execute
   * @param {Object} context - Context information
   * @param {Object} options - Retry options
   * @param {number} concurrency - Maximum concurrent executions
   * @returns {Promise<Array>} Results array
   */
  async executeWithRetryParallel(functions, context = {}, options = {}, concurrency = 5) {
    const results = [];
    const executing = [];

    for (let i = 0; i < functions.length; i++) {
      const fn = functions[i];
      const promise = this.executeWithRetry(
        fn,
        { ...context, index: i, total: functions.length },
        options
      ).then(result => {
        executing.splice(executing.indexOf(promise), 1);
        return { index: i, result, success: true };
      }).catch(error => {
        executing.splice(executing.indexOf(promise), 1);
        return { index: i, error, success: false };
      });

      executing.push(promise);

      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }

    const allResults = await Promise.all([...executing]);
    allResults.forEach(r => {
      results[r.index] = r;
    });

    return results;
  }

  /**
   * Set retry configuration
   * @param {Object} config - Configuration object
   */
  configure(config) {
    if (config.maxRetries !== undefined) {
      this.maxRetries = config.maxRetries;
    }
    if (config.baseDelay !== undefined) {
      this.baseDelay = config.baseDelay;
    }
    if (config.maxDelay !== undefined) {
      this.maxDelay = config.maxDelay;
    }
    if (config.retryableErrors) {
      this.retryableErrors = [...this.retryableErrors, ...config.retryableErrors];
    }
    if (config.retryableErrorMessages) {
      this.retryableErrorMessages = [...this.retryableErrorMessages, ...config.retryableErrorMessages];
    }
  }
}

module.exports = new RetryService();

