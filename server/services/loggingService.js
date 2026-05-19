const winston = require('winston');
const path = require('path');
const fs = require('fs-extra');

/**
 * Enhanced Logging Service with Verbose and Debug Modes
 * Supports user-controlled logging levels and detailed operation tracking
 */
class LoggingService {
  constructor() {
    this.loggers = new Map();
    this.verboseMode = false;
    this.debugMode = false;
    this.jobLoggers = new Map();
    
    // Ensure logs directory exists
    this.logsDir = path.join(__dirname, '../../logs');
    fs.ensureDirSync(this.logsDir);
    fs.ensureDirSync(path.join(this.logsDir, 'jobs'));
    fs.ensureDirSync(path.join(this.logsDir, 'verbose'));
    fs.ensureDirSync(path.join(this.logsDir, 'debug'));
    
    this.initializeMainLogger();
  }

  /**
   * Initialize the main application logger
   */
  initializeMainLogger() {
    const mainLogger = winston.createLogger({
      level: this.getLogLevel(),
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: 'vlocity-manager' },
      transports: [
        // Console transport
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
              let log = `${timestamp} [${level}]: ${message}`;
              if (Object.keys(meta).length > 0) {
                log += ` ${JSON.stringify(meta)}`;
              }
              return log;
            })
          ),
        }),
        
        // File transport for all logs
        new winston.transports.File({
          filename: path.join(this.logsDir, 'vlocity-manager.log'),
          maxsize: 5242880, // 5MB
          maxFiles: 5,
        }),
        
        // Separate file for errors
        new winston.transports.File({
          filename: path.join(this.logsDir, 'error.log'),
          level: 'error',
          maxsize: 5242880, // 5MB
          maxFiles: 5,
        }),
      ],
    });

    // Add helper methods
    mainLogger.logRequest = (req, res, responseTime) => {
      mainLogger.info('HTTP Request', {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        responseTime: `${responseTime}ms`,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
      });
    };

    mainLogger.logOperation = (operation, details = {}) => {
      mainLogger.info(`Operation: ${operation}`, {
        operation,
        timestamp: new Date().toISOString(),
        ...details,
      });
    };

    mainLogger.logError = (error, context = {}) => {
      mainLogger.error('Application Error', {
        message: error.message,
        stack: error.stack,
        ...context,
      });
    };

    mainLogger.logVlocityOperation = (operation, username, details = {}) => {
      mainLogger.info(`Vlocity Operation: ${operation}`, {
        operation,
        username,
        timestamp: new Date().toISOString(),
        ...details,
      });
    };

    this.loggers.set('main', mainLogger);
  }

  /**
   * Get the appropriate log level based on current mode
   */
  getLogLevel() {
    if (this.debugMode) return 'debug';
    if (this.verboseMode) return 'verbose';
    return process.env.LOG_LEVEL || 'info';
  }

  /**
   * Enable verbose mode
   */
  enableVerboseMode() {
    this.verboseMode = true;
    this.updateLoggerLevels();
    this.log('info', 'Verbose mode enabled', { service: 'logging' });
  }

  /**
   * Disable verbose mode
   */
  disableVerboseMode() {
    this.verboseMode = false;
    this.updateLoggerLevels();
    this.log('info', 'Verbose mode disabled', { service: 'logging' });
  }

  /**
   * Enable debug mode
   */
  enableDebugMode() {
    this.debugMode = true;
    this.updateLoggerLevels();
    this.log('info', 'Debug mode enabled', { service: 'logging' });
  }

  /**
   * Disable debug mode
   */
  disableDebugMode() {
    this.debugMode = false;
    this.updateLoggerLevels();
    this.log('info', 'Debug mode disabled', { service: 'logging' });
  }

  /**
   * Set both verbose and debug modes
   */
  setLoggingMode(verbose = false, debug = false) {
    this.verboseMode = verbose;
    this.debugMode = debug;
    this.updateLoggerLevels();
    
    const mode = debug ? 'debug' : (verbose ? 'verbose' : 'normal');
    this.log('info', `Logging mode set to: ${mode}`, { 
      service: 'logging',
      verbose,
      debug 
    });
  }

  /**
   * Update all logger levels
   */
  updateLoggerLevels() {
    const newLevel = this.getLogLevel();
    
    // Update main logger
    const mainLogger = this.loggers.get('main');
    if (mainLogger) {
      mainLogger.level = newLevel;
    }

    // Update job loggers
    this.jobLoggers.forEach((logger, jobId) => {
      logger.level = newLevel;
    });
  }

  /**
   * Create a job-specific logger
   */
  createJobLogger(jobId, jobType = 'unknown') {
    const jobLogger = winston.createLogger({
      level: this.getLogLevel(),
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { 
        service: 'vlocity-manager',
        jobId,
        jobType 
      },
      transports: [
        // Job-specific file
        new winston.transports.File({
          filename: path.join(this.logsDir, 'jobs', `job-${jobId}.log`),
          maxsize: 10485760, // 10MB
          maxFiles: 3,
        }),
        
        // Verbose file if verbose mode is enabled
        ...(this.verboseMode ? [new winston.transports.File({
          filename: path.join(this.logsDir, 'verbose', `job-${jobId}-verbose.log`),
          maxsize: 10485760, // 10MB
          maxFiles: 2,
        })] : []),
        
        // Debug file if debug mode is enabled
        ...(this.debugMode ? [new winston.transports.File({
          filename: path.join(this.logsDir, 'debug', `job-${jobId}-debug.log`),
          maxsize: 10485760, // 10MB
          maxFiles: 2,
        })] : []),
      ],
    });

    this.jobLoggers.set(jobId, jobLogger);
    return jobLogger;
  }

  /**
   * Get or create a job logger
   */
  getJobLogger(jobId, jobType = 'unknown') {
    if (!this.jobLoggers.has(jobId)) {
      return this.createJobLogger(jobId, jobType);
    }
    return this.jobLoggers.get(jobId);
  }

  /**
   * Remove a job logger
   */
  removeJobLogger(jobId) {
    const logger = this.jobLoggers.get(jobId);
    if (logger) {
      logger.close();
      this.jobLoggers.delete(jobId);
    }
  }

  /**
   * Log a message with the main logger
   */
  log(level, message, meta = {}) {
    const logger = this.loggers.get('main');
    if (logger) {
      logger.log(level, message, meta);
    }
  }

  /**
   * Log a verbose message (only if verbose mode is enabled)
   */
  logVerbose(message, meta = {}) {
    if (this.verboseMode || this.debugMode) {
      this.log('verbose', message, { ...meta, verbose: true });
    }
  }

  /**
   * Log a debug message (only if debug mode is enabled)
   */
  logDebug(message, meta = {}) {
    if (this.debugMode) {
      this.log('debug', message, { ...meta, debug: true });
    }
  }

  /**
   * Log a job-specific message
   */
  logJob(jobId, level, message, meta = {}) {
    const logger = this.getJobLogger(jobId);
    logger.log(level, message, meta);
  }

  /**
   * Log a verbose job message
   */
  logJobVerbose(jobId, message, meta = {}) {
    if (this.verboseMode || this.debugMode) {
      this.logJob(jobId, 'verbose', message, { ...meta, verbose: true });
    }
  }

  /**
   * Log a debug job message
   */
  logJobDebug(jobId, message, meta = {}) {
    if (this.debugMode) {
      this.logJob(jobId, 'debug', message, { ...meta, debug: true });
    }
  }

  /**
   * Log Vlocity command execution with detailed output
   */
  logVlocityCommand(jobId, command, output, exitCode, duration) {
    const logger = this.getJobLogger(jobId);
    
    // Always log basic command info
    logger.info('Vlocity Command Executed', {
      command,
      exitCode,
      duration: `${duration}ms`,
      outputLength: output.length
    });

    // Log detailed output in verbose mode
    if (this.verboseMode || this.debugMode) {
      logger.verbose('Vlocity Command Output', {
        command,
        output: output.substring(0, 10000), // Limit to 10KB
        fullOutput: output.length > 10000
      });
    }

    // Log debug information in debug mode
    if (this.debugMode) {
      logger.debug('Vlocity Command Debug Info', {
        command,
        fullOutput: output,
        exitCode,
        duration,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Log file operations with detailed tracking
   */
  logFileOperation(jobId, operation, filePath, details = {}) {
    const logger = this.getJobLogger(jobId);
    
    logger.info('File Operation', {
      operation,
      filePath,
      ...details
    });

    if (this.debugMode) {
      logger.debug('File Operation Debug', {
        operation,
        filePath,
        fullPath: path.resolve(filePath),
        exists: fs.existsSync(filePath),
        stats: fs.existsSync(filePath) ? fs.statSync(filePath) : null,
        ...details
      });
    }
  }

  /**
   * Log API requests with detailed information
   */
  logApiRequest(req, res, responseTime, jobId = null) {
    const logger = jobId ? this.getJobLogger(jobId) : this.loggers.get('main');
    
    const logData = {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      jobId
    };

    logger.info('API Request', logData);

    if (this.debugMode) {
      logger.debug('API Request Debug', {
        ...logData,
        headers: req.headers,
        body: req.body,
        query: req.query,
        params: req.params
      });
    }
  }

  /**
   * Get current logging configuration
   */
  getLoggingConfig() {
    return {
      verboseMode: this.verboseMode,
      debugMode: this.debugMode,
      logLevel: this.getLogLevel(),
      activeJobLoggers: this.jobLoggers.size,
      logsDirectory: this.logsDir
    };
  }

  /**
   * Clean up old log files
   */
  async cleanupLogs(olderThanDays = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    
    const logFiles = await fs.readdir(this.logsDir, { recursive: true });
    let cleanedCount = 0;

    for (const file of logFiles) {
      const filePath = path.join(this.logsDir, file);
      const stats = await fs.stat(filePath);
      
      if (stats.isFile() && stats.mtime < cutoffDate) {
        await fs.remove(filePath);
        cleanedCount++;
      }
    }

    this.log('info', `Cleaned up ${cleanedCount} old log files`, {
      service: 'logging',
      cutoffDate: cutoffDate.toISOString()
    });

    return cleanedCount;
  }
}

// Create singleton instance
const loggingService = new LoggingService();

module.exports = loggingService;
