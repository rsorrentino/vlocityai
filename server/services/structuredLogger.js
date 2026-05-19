/**
 * Structured Logger
 * Provides contextual logging with correlation IDs, timestamps, and metadata
 */

const { v4: uuidv4 } = require('uuid');
const jobMonitor = require('./jobMonitor');

class StructuredLogger {
  constructor() {
    this.logLevels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
      critical: 4,
    };

    this.currentLogLevel = process.env.LOG_LEVEL || 'info';
  }

  /**
   * Create a correlation ID for tracking related operations
   */
  createCorrelationId() {
    return uuidv4();
  }

  /**
   * Create a job logger with correlation context
   */
  createJobLogger(jobId, jobName, username, operation) {
    const correlationId = this.createCorrelationId();

    return {
      correlationId,
      context: {
        jobId,
        jobName,
        username,
        operation,
        startTime: new Date().toISOString(),
      },

      debug: (message, metadata = {}) => {
        this.log('debug', message, { ...this.context, ...metadata });
      },

      info: (message, metadata = {}) => {
        this.log('info', message, { ...this.context, ...metadata });
      },

      warn: (message, metadata = {}) => {
        this.log('warn', message, { ...this.context, ...metadata });
      },

      error: (message, error = null, metadata = {}) => {
        const errorMeta = error ? {
          errorMessage: error.message,
          errorStack: error.stack,
          errorType: error.constructor.name,
        } : {};
        this.log('error', message, { ...this.context, ...metadata, ...errorMeta });
      },

      critical: (message, error = null, metadata = {}) => {
        const errorMeta = error ? {
          errorMessage: error.message,
          errorStack: error.stack,
          errorType: error.constructor.name,
        } : {};
        this.log('critical', message, { ...this.context, ...metadata, ...errorMeta });
      },

      // Job-specific logging with WebSocket broadcast
      logJobProgress: (message, progress = null) => {
        const logEntry = {
          timestamp: new Date().toISOString(),
          correlationId,
          jobId,
          level: 'info',
          message,
          progress,
        };

        console.log(this.formatLogEntry(logEntry));

        // Broadcast to WebSocket clients
        if (jobMonitor && jobMonitor.addJobLog) {
          jobMonitor.addJobLog(jobId, `[${new Date().toLocaleTimeString()}] ${message}`);
        }
      },

      logJobError: (message, error = null) => {
        const logEntry = {
          timestamp: new Date().toISOString(),
          correlationId,
          jobId,
          level: 'error',
          message,
          error: error ? {
            message: error.message,
            stack: error.stack,
            type: error.constructor.name,
          } : null,
        };

        console.error(this.formatLogEntry(logEntry));

        // Broadcast to WebSocket clients
        if (jobMonitor && jobMonitor.addJobLog) {
          jobMonitor.addJobLog(jobId, `[ERROR] ${message}${error ? ': ' + error.message : ''}`);
        }
      },

      logJobCompletion: (success, duration, summary = {}) => {
        const logEntry = {
          timestamp: new Date().toISOString(),
          correlationId,
          jobId,
          level: success ? 'info' : 'error',
          message: `Job ${success ? 'completed successfully' : 'failed'}`,
          duration,
          summary,
        };

        console.log(this.formatLogEntry(logEntry));

        // Broadcast to WebSocket clients
        if (jobMonitor && jobMonitor.addJobLog) {
          const statusIcon = success ? '✓' : '✗';
          jobMonitor.addJobLog(
            jobId,
            `${statusIcon} Job ${success ? 'completed' : 'failed'} in ${(duration / 1000).toFixed(2)}s`
          );
        }
      },
    };
  }

  /**
   * Log a message with structured metadata
   */
  log(level, message, metadata = {}) {
    if (this.logLevels[level] < this.logLevels[this.currentLogLevel]) {
      return; // Skip if below current log level
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...metadata,
    };

    const formatted = this.formatLogEntry(logEntry);

    switch (level) {
      case 'debug':
      case 'info':
        console.log(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      case 'error':
      case 'critical':
        console.error(formatted);
        break;
    }

    // Persist to database or external logging service
    this.persistLog(logEntry);
  }

  /**
   * Format log entry for console output
   */
  formatLogEntry(entry) {
    const levelIcons = {
      debug: '🔍',
      info: 'ℹ️',
      warn: '⚠️',
      error: '❌',
      critical: '🔴',
    };

    const icon = levelIcons[entry.level] || '';
    const timestamp = entry.timestamp;
    const level = entry.level.toUpperCase().padEnd(8);
    const correlationId = entry.correlationId ? `[${entry.correlationId.substring(0, 8)}]` : '';
    const jobContext = entry.jobId ? `[Job:${entry.jobId}]` : '';

    let formatted = `${timestamp} ${icon} ${level} ${correlationId}${jobContext} ${entry.message}`;

    // Add metadata
    const metadataKeys = Object.keys(entry).filter(
      key => !['timestamp', 'level', 'message', 'correlationId', 'jobId', 'jobName', 'username', 'operation', 'startTime'].includes(key)
    );

    if (metadataKeys.length > 0) {
      const metadata = {};
      metadataKeys.forEach(key => {
        metadata[key] = entry[key];
      });
      formatted += `\n  Metadata: ${JSON.stringify(metadata, null, 2)}`;
    }

    return formatted;
  }

  /**
   * Persist log to storage (placeholder for future implementation)
   */
  persistLog(logEntry) {
    // TODO: Implement log persistence to database or external service
    // For now, logs are only in console
  }

  /**
   * Create a CLI command logger with full context
   */
  createCLILogger(command, args, jobId, operation) {
    const correlationId = this.createCorrelationId();
    const startTime = Date.now();

    return {
      correlationId,

      logStart: () => {
        this.log('info', `Starting CLI command: ${command}`, {
          correlationId,
          jobId,
          operation,
          command,
          args: args.filter(arg => !arg.includes('password') && !arg.includes('token')), // Sanitize
          startTime: new Date().toISOString(),
        });
      },

      logOutput: (line, stream = 'stdout') => {
        // Only log significant lines (skip noise)
        if (this.isSignificantOutput(line)) {
          this.log('debug', line, {
            correlationId,
            jobId,
            stream,
            elapsed: Date.now() - startTime,
          });
        }

        // Always broadcast to job monitor
        if (jobId && jobMonitor && jobMonitor.addJobLog) {
          jobMonitor.addJobLog(jobId, line);
        }
      },

      logError: (line) => {
        this.log('error', line, {
          correlationId,
          jobId,
          stream: 'stderr',
          elapsed: Date.now() - startTime,
        });

        if (jobId && jobMonitor && jobMonitor.addJobLog) {
          jobMonitor.addJobLog(jobId, `[ERROR] ${line}`);
        }
      },

      logCompletion: (exitCode, stdout, stderr) => {
        const duration = Date.now() - startTime;
        const success = exitCode === 0;

        this.log(success ? 'info' : 'error', `CLI command ${success ? 'completed' : 'failed'}`, {
          correlationId,
          jobId,
          operation,
          command,
          exitCode,
          duration,
          stdoutLength: stdout?.length || 0,
          stderrLength: stderr?.length || 0,
        });
      },

      logRetry: (attemptNumber, reason, delayMs) => {
        this.log('warn', `Retrying CLI command (attempt ${attemptNumber})`, {
          correlationId,
          jobId,
          operation,
          command,
          reason,
          delayMs,
          elapsed: Date.now() - startTime,
        });

        if (jobId && jobMonitor && jobMonitor.addJobLog) {
          jobMonitor.addJobLog(
            jobId,
            `⟳ Retrying (attempt ${attemptNumber}) - ${reason}. Waiting ${delayMs / 1000}s...`
          );
        }
      },
    };
  }

  /**
   * Determine if output line is significant enough to log
   */
  isSignificantOutput(line) {
    if (!line || line.trim().length === 0) return false;

    // Skip deprecation warnings
    if (line.includes('DeprecationWarning')) return false;
    if (line.includes('punycode')) return false;

    // Skip excessive debug output
    if (line.match(/^\s*at\s+/)) return false; // Stack traces
    if (line.match(/^\s*\d+\s*$/)) return false; // Lone numbers

    // Log important patterns
    if (line.includes('Error') || line.includes('error')) return true;
    if (line.includes('Warning') || line.includes('warning')) return true;
    if (line.includes('Exported') || line.includes('Deployed')) return true;
    if (line.includes('Success') || line.includes('Failed')) return true;
    if (line.includes('%') || line.includes('progress')) return true;

    // Log at 10% sampling rate for other lines to reduce noise
    return Math.random() < 0.1;
  }

  /**
   * Log API request/response
   */
  logAPICall(method, url, statusCode, duration, error = null) {
    const level = statusCode >= 400 || error ? 'error' : 'info';

    this.log(level, `API ${method} ${url}`, {
      method,
      url,
      statusCode,
      duration,
      success: statusCode >= 200 && statusCode < 400,
      error: error ? {
        message: error.message,
        type: error.constructor.name,
      } : null,
    });
  }

  /**
   * Log metrics for monitoring
   */
  logMetric(metricName, value, unit, tags = {}) {
    this.log('info', `Metric: ${metricName}`, {
      metric: metricName,
      value,
      unit,
      tags,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Create performance timer
   */
  createTimer(operation) {
    const startTime = Date.now();

    return {
      end: (metadata = {}) => {
        const duration = Date.now() - startTime;
        this.logMetric('operation_duration', duration, 'ms', {
          operation,
          ...metadata,
        });
        return duration;
      },
    };
  }
}

module.exports = new StructuredLogger();
