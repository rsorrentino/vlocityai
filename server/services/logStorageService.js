const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');

class LogStorageService {
  constructor() {
    this.logsDir = path.join(__dirname, '../../logs/jobs');
    this.ensureLogsDirectory();
  }

  async ensureLogsDirectory() {
    try {
      await fs.ensureDir(this.logsDir);
    } catch (error) {
      logger.logError(error, { operation: 'ensureLogsDirectory' });
    }
  }

  /**
   * Get log file path for a job
   */
  getLogFilePath(jobId) {
    return path.join(this.logsDir, `${jobId}.log`);
  }

  /**
   * Append log entry to job's log file
   */
  async appendLog(jobId, logEntry) {
    try {
      // Skip deprecation warnings
      if (this.isDeprecationWarning(logEntry.message)) {
        return;
      }
      
      const logFilePath = this.getLogFilePath(jobId);
      const logLine = this.formatLogEntry(logEntry);
      
      if (logLine) {
        await fs.appendFile(logFilePath, logLine + '\n', 'utf8');
      }
    } catch (error) {
      logger.logError(error, { operation: 'appendLog', jobId });
      throw error;
    }
  }

  /**
   * Append multiple log entries at once (batch write)
   */
  async appendLogs(jobId, logEntries) {
    if (!logEntries || logEntries.length === 0) return;

    try {
      // Filter out deprecation warnings
      const filteredEntries = logEntries.filter(entry => !this.isDeprecationWarning(entry.message));
      if (filteredEntries.length === 0) return;
      
      const logFilePath = this.getLogFilePath(jobId);
      const logLines = filteredEntries
        .map(entry => this.formatLogEntry(entry))
        .filter(line => line !== null)
        .join('\n') + '\n';
      
      if (logLines.trim()) {
        await fs.appendFile(logFilePath, logLines, 'utf8');
      }
    } catch (error) {
      logger.logError(error, { operation: 'appendLogs', jobId, count: logEntries.length });
      throw error;
    }
  }

  /**
   * Strip ANSI color codes from string
   */
  stripAnsi(str) {
    // eslint-disable-next-line no-control-regex
    return str ? str.replace(/\x1b\[[0-9;]*m/g, '').replace(/\u001b\[[0-9;]*m/g, '') : '';
  }

  /**
   * Check if a log message should be filtered (deprecation warnings, numeric-only errors, etc.)
   */
  isDeprecationWarning(message) {
    if (!message) return false;
    
    // Node.js deprecation warnings
    if (/\(node:\d+\)\s*\[DEP\d+\]/.test(message) ||
        /DeprecationWarning|DEP00\d{2}/i.test(message) ||
        /The `util\.is(?:NullOrUndefined|Object|Array)` API is deprecated/i.test(message) ||
        /Please use `arg === null \|\| arg === undefined`/i.test(message) ||
        /Please use `arg !== null && typeof arg === "object"`/i.test(message) ||
        /Please use `Array\.isArray\(\)`/i.test(message) ||
        /\(Use `node --trace-deprecation/i.test(message)) {
      return true;
    }
    
    // Filter out numeric-only error messages like "Error >> 18", "Error: 18", "Error 18", etc.
    // Also match variations with spaces, tabs, or other separators
    const trimmed = message.trim();
    // Match patterns like:
    // - "Error >> 18"
    // - "Error: 18"
    // - "Error 18"
    // - "Error\t>>\t18" (with tabs)
    // - "Error >>18" (no space)
    // - "Error>> 18"
    // - "ERROR >> 18" (case insensitive)
    if (/^Error\s*[>:]+\s*\d+$/i.test(trimmed) ||
        /^Error\s+\d+$/i.test(trimmed) ||
        /^Error\s*>>\s*\d+$/i.test(trimmed)) {
      return true;
    }
    
    // Also check if the entire message is just "Error >> N" pattern (even with surrounding text)
    // This catches cases where the message might have a prefix like "[INFO] Error >> 18"
    if (/\bError\s*[>:]+\s*\d+\s*$/i.test(trimmed) ||
        /\bError\s+\d+\s*$/i.test(trimmed)) {
      return true;
    }
    
    return false;
  }

  /**
   * Format a log entry as a string
   */
  formatLogEntry(logEntry) {
    const timestamp = logEntry.timestamp || new Date().toISOString();
    const level = (logEntry.level || 'INFO').toUpperCase().padEnd(5);
    const message = this.stripAnsi(logEntry.message || '');
    
    // Skip deprecation warnings
    if (this.isDeprecationWarning(message)) {
      return null;
    }
    
    return `[${timestamp}] [${level}] ${message}`;
  }

  /**
   * Read all logs for a job
   */
  async readLogs(jobId) {
    try {
      const logFilePath = this.getLogFilePath(jobId);
      
      if (!await fs.pathExists(logFilePath)) {
        return [];
      }

      const content = await fs.readFile(logFilePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      // Parse log lines back to structured format and filter out deprecation warnings
      return lines
        .map(line => this.parseLogLine(line))
        .filter(log => log !== null);
    } catch (error) {
      logger.logError(error, { operation: 'readLogs', jobId });
      return [];
    }
  }

  /**
   * Read logs with pagination
   */
  async readLogsPaginated(jobId, offset = 0, limit = 100) {
    try {
      const allLogs = await this.readLogs(jobId);
      const total = allLogs.length;
      const logs = allLogs.slice(offset, offset + limit);
      
      return {
        logs,
        total,
        offset,
        limit,
        hasMore: offset + limit < total
      };
    } catch (error) {
      logger.logError(error, { operation: 'readLogsPaginated', jobId });
      return {
        logs: [],
        total: 0,
        offset,
        limit,
        hasMore: false
      };
    }
  }

  /**
   * Read last N logs (tail)
   */
  async readLastLogs(jobId, count = 100) {
    try {
      const allLogs = await this.readLogs(jobId);
      return allLogs.slice(-count);
    } catch (error) {
      logger.logError(error, { operation: 'readLastLogs', jobId });
      return [];
    }
  }

  /**
   * Parse a log line back to structured format
   */
  parseLogLine(line) {
    // Skip deprecation warnings during parsing
    if (this.isDeprecationWarning(line)) {
      return null;
    }
    
    // Format: [2025-10-28T17:12:06.127Z] [INFO ] Message text
    const match = line.match(/^\[(.+?)\]\s+\[(.+?)\]\s+(.*)$/);
    
    if (match) {
      const parsed = {
        timestamp: match[1].trim(),
        level: match[2].trim().toLowerCase(),
        message: match[3]
      };
      
      // Double-check parsed message for deprecation warnings
      if (this.isDeprecationWarning(parsed.message)) {
        return null;
      }
      
      return parsed;
    }
    
    // Fallback for malformed lines - but still check for deprecation warnings
    if (this.isDeprecationWarning(line)) {
      return null;
    }
    
    return {
      timestamp: new Date().toISOString(),
      level: 'info',
      message: line
    };
  }

  /**
   * Get log file stats
   */
  async getLogStats(jobId) {
    try {
      const logFilePath = this.getLogFilePath(jobId);
      
      if (!await fs.pathExists(logFilePath)) {
        return {
          exists: false,
          size: 0,
          lines: 0
        };
      }

      const stats = await fs.stat(logFilePath);
      const content = await fs.readFile(logFilePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim()).length;
      
      return {
        exists: true,
        size: stats.size,
        sizeFormatted: this.formatBytes(stats.size),
        lines,
        created: stats.birthtime,
        modified: stats.mtime
      };
    } catch (error) {
      logger.logError(error, { operation: 'getLogStats', jobId });
      return {
        exists: false,
        size: 0,
        lines: 0
      };
    }
  }

  /**
   * Delete log file for a job
   */
  async deleteLogs(jobId) {
    try {
      const logFilePath = this.getLogFilePath(jobId);
      
      if (await fs.pathExists(logFilePath)) {
        await fs.remove(logFilePath);
        logger.logOperation('Log file deleted', { jobId, path: logFilePath });
      }
    } catch (error) {
      logger.logError(error, { operation: 'deleteLogs', jobId });
      throw error;
    }
  }

  /**
   * Stream log file (for downloading) with filtering
   */
  async streamLogFile(jobId) {
    try {
      const logFilePath = this.getLogFilePath(jobId);
      
      if (!await fs.pathExists(logFilePath)) {
        return null;
      }

      // Create a filtered read stream that removes unwanted messages
      const { Transform } = require('stream');
      const self = this; // Capture reference to the service instance
      
      const filterStream = new Transform({
        objectMode: false,
        transform(chunk, encoding, callback) {
          const lines = chunk.toString().split('\n');
          const filteredLines = lines.filter(line => {
            // Check if the line contains a filtered message
            // We need to check both the full line and just the message part
            const trimmed = line.trim();
            if (!trimmed) return true; // Keep empty lines
            
            // Try to extract just the message part (after timestamp and level)
            const messageMatch = trimmed.match(/^\[.+?\]\s+\[.+?\]\s+(.+)$/);
            const message = messageMatch ? messageMatch[1] : trimmed;
            
            // Filter out unwanted messages
            return !self.isDeprecationWarning(message) && !self.isDeprecationWarning(trimmed);
          });
          
          callback(null, filteredLines.join('\n'));
        }
      });

      const readStream = fs.createReadStream(logFilePath, 'utf8');
      return readStream.pipe(filterStream);
    } catch (error) {
      logger.logError(error, { operation: 'streamLogFile', jobId });
      return null;
    }
  }

  /**
   * Format bytes to human-readable size
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Clean up old log files (for maintenance)
   */
  async cleanupOldLogs(daysOld = 30) {
    try {
      const files = await fs.readdir(this.logsDir);
      const now = Date.now();
      const maxAge = daysOld * 24 * 60 * 60 * 1000;
      let deletedCount = 0;

      for (const file of files) {
        if (!file.endsWith('.log')) continue;

        const filePath = path.join(this.logsDir, file);
        const stats = await fs.stat(filePath);
        const age = now - stats.mtime.getTime();

        if (age > maxAge) {
          await fs.remove(filePath);
          deletedCount++;
        }
      }

      logger.logOperation('Old log files cleaned up', { 
        daysOld, 
        deletedCount 
      });

      return deletedCount;
    } catch (error) {
      logger.logError(error, { operation: 'cleanupOldLogs' });
      return 0;
    }
  }
}

module.exports = new LogStorageService();

