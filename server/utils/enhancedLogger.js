const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');

/**
 * Enhanced Logger
 * Provides structured logging with categories and color coding
 * Based on patterns from official Vlocity Build Tool
 */
class EnhancedLogger {
  constructor() {
    this.categories = {
      'EXPORT': '\x1b[36m',      // Cyan
      'DEPLOY': '\x1b[32m',       // Green
      'ERROR': '\x1b[31m',        // Red
      'VALIDATION': '\x1b[33m',   // Yellow
      'AUTH': '\x1b[35m',         // Magenta
      'CONFIG': '\x1b[34m',       // Blue
      'RETRY': '\x1b[90m',        // Gray
      'DEPENDENCY': '\x1b[96m'   // Bright Cyan
    };
    this.reset = '\x1b[0m';
    this.verboseEnabled = process.env.VERBOSE_LOGGING === 'true';
    this.logDir = path.join(__dirname, '../../logs');
    fs.ensureDirSync(this.logDir);
  }

  /**
   * Log with category
   * @param {string} level - Log level (info, warn, error, debug)
   * @param {string} category - Log category
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  log(level, category, message, context = {}) {
    const color = this.categories[category] || '';
    const timestamp = new Date().toISOString();
    
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      category,
      message,
      context,
      pid: process.pid
    };

    // Format console output
    const formattedMessage = `${color}[${category}]${this.reset} ${message}`;
    
    switch (level.toLowerCase()) {
      case 'error':
        console.error(formattedMessage, context);
        logger.logError(new Error(message), { category, ...context });
        break;
      case 'warn':
        console.warn(formattedMessage, context);
        logger.warn(message, context);
        break;
      case 'debug':
        if (this.verboseEnabled) {
          console.log(formattedMessage, context);
          logger.debug(message, { category, ...context });
        }
        break;
      default:
        console.log(formattedMessage, context);
        logger.info(message, { category, ...context });
    }

    // Write to file
    this.writeToFile(logEntry);
  }

  /**
   * Verbose logging (only if enabled)
   * @param {string} category - Log category
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  verbose(category, message, context = {}) {
    if (this.verboseEnabled) {
      this.log('debug', category, message, context);
    }
  }

  /**
   * Info logging
   * @param {string} category - Log category
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  info(category, message, context = {}) {
    this.log('info', category, message, context);
  }

  /**
   * Warning logging
   * @param {string} category - Log category
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  warn(category, message, context = {}) {
    this.log('warn', category, message, context);
  }

  /**
   * Error logging
   * @param {string} category - Log category
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  error(category, message, context = {}) {
    this.log('error', category, message, context);
  }

  /**
   * Success logging (green)
   * @param {string} category - Log category
   * @param {string} message - Log message
   * @param {Object} context - Additional context
   */
  success(category, message, context = {}) {
    const formattedMessage = `\x1b[32m[${category}] ✓ ${message}\x1b[0m`;
    console.log(formattedMessage, context);
    logger.info(message, { category, success: true, ...context });
  }

  /**
   * Write log entry to file
   * @param {Object} logEntry - Log entry object
   */
  writeToFile(logEntry) {
    // Use existing logger for file writing
    const logPath = path.join(__dirname, '../../logs/enhanced.log');
    const logLine = JSON.stringify(logEntry) + '\n';
    
    try {
      fs.appendFileSync(logPath, logLine, 'utf8');
    } catch (error) {
      // Silently fail if file write fails
    }
  }

  /**
   * Set verbose mode
   * @param {boolean} enabled - Enable/disable verbose logging
   */
  setVerbose(enabled) {
    this.verboseEnabled = enabled;
    process.env.VERBOSE_LOGGING = enabled ? 'true' : 'false';
  }
}

module.exports = new EnhancedLogger();

