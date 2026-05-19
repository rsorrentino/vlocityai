const fs = require('fs-extra');
const path = require('path');
const yaml = require('yaml');
const logger = require('../utils/logger');
const YAML_PARSE_OPTIONS = {
  customTags: [
    {
      tag: 'tag:yaml.org,2002:js/undefined',
      resolve: () => null,
    },
  ],
};

/**
 * Service for parsing and analyzing Vlocity error logs
 */
class ErrorLogParser {
  constructor() {
    this.errorLogPath = path.join(process.cwd(), 'VlocityBuildErrors.log');
    this.buildLogPath = path.join(process.cwd(), 'VlocityBuildLog.yaml');
  }

  /**
   * Parse Vlocity error log and extract all error information
   * @param {string} logPath - Path to VlocityBuildErrors.log (optional)
   * @returns {Object} Parsed error information
   */
  async parseVlocityErrors(logPath = null) {
    try {
      const targetPath = logPath || this.errorLogPath;
      
      if (!await fs.pathExists(targetPath)) {
        logger.info('No VlocityBuildErrors.log found');
        return {
          missingIds: [],
          failedTypes: [],
          settingsMismatch: false,
          authErrors: false,
          errors: [],
          hasErrors: false
        };
      }

      const content = await fs.readFile(targetPath, 'utf8');
      
      const result = {
        missingIds: this.extractMissingIds(content),
        failedTypes: this.extractFailedTypes(content),
        settingsMismatch: this.detectSettingsMismatch(content),
        authErrors: this.detectAuthErrors(content),
        errors: this.extractAllErrors(content),
        hasErrors: content.trim().length > 0
      };

      logger.info('Error log parsed', {
        missingIds: result.missingIds.length,
        failedTypes: result.failedTypes.length,
        settingsMismatch: result.settingsMismatch,
        authErrors: result.authErrors,
        totalErrors: result.errors.length
      });

      return result;
    } catch (error) {
      logger.logError(error, { operation: 'parseVlocityErrors', logPath });
      return {
        missingIds: [],
        failedTypes: [],
        settingsMismatch: false,
        authErrors: false,
        errors: [],
        hasErrors: false
      };
    }
  }

  /**
   * Extract missing Salesforce IDs from error log
   * @param {string} content - Error log content
   * @returns {Array<string>} Array of missing Salesforce IDs
   */
  extractMissingIds(content) {
    const patterns = [
      // Pattern 1: SObject/Id: 01t8s00000A8ZPRAA3
      /SObject\/Id:\s*([A-Za-z0-9]{15,18})/gi,
      // Pattern 2: orgUrl: /01t8s00000A8ZPRAA3
      /orgUrl:\s*\/([A-Za-z0-9]{15,18})/gi,
      // Pattern 3: Id '01t8s00000A8ZPRAA3' not found
      /Id\s+'([A-Za-z0-9]{15,18})'\s+not\s+found/gi,
      // Pattern 4: Missing record: 01t8s00000A8ZPRAA3
      /Missing\s+record:\s*([A-Za-z0-9]{15,18})/gi,
      // Pattern 5: Could not find: 01t8s00000A8ZPRAA3
      /Could\s+not\s+find:\s*([A-Za-z0-9]{15,18})/gi
    ];

    const ids = new Set();
    
    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const id = match[1];
        // Validate Salesforce ID format (15 or 18 characters)
        if (id && (id.length === 15 || id.length === 18)) {
          ids.add(id);
        }
      }
    });

    return Array.from(ids);
  }

  /**
   * Extract failed DataPack types from error log
   * @param {string} content - Error log content
   * @returns {Array<string>} Array of failed DataPack type names
   */
  extractFailedTypes(content) {
    // Pattern: Product2/My-Product-Name or VlocityUITemplate/MyTemplate
    const pattern = /^([A-Za-z0-9_-]+)\/([A-Za-z0-9_\s-]+)/gm;
    const types = new Set();

    let match;
    while ((match = pattern.exec(content)) !== null) {
      const typeName = match[1];
      if (typeName && !typeName.includes('http') && !typeName.includes('www')) {
        types.add(typeName);
      }
    }

    return Array.from(types);
  }

  /**
   * Detect settings mismatch errors
   * @param {string} content - Error log content
   * @returns {boolean} True if settings mismatch detected
   */
  detectSettingsMismatch(content) {
    const settingsPatterns = [
      /setting.*mismatch/i,
      /settings.*do not match/i,
      /configuration.*mismatch/i,
      /DataPack settings/i,
      /updateSettings/i
    ];

    return settingsPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Detect authentication errors
   * @param {string} content - Error log content
   * @returns {boolean} True if authentication error detected
   */
  detectAuthErrors(content) {
    const authPatterns = [
      /InvalidAuthToken/i,
      /INVALID_SESSION_ID/i,
      /Session expired/i,
      /Authentication failed/i,
      /Not authorized/i,
      /No AuthInfo found/i,
      /Please Login Again/i
    ];

    return authPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Returns true when the line (or its immediate context) belongs to a
   * DUPLICATE_DEVELOPER_NAME block.  These are not real failures — the record
   * already exists in the target org, so they must be excluded from counts.
   * @param {string[]} lines - All lines in the log
   * @param {number} index  - Current line index
   * @returns {boolean}
   */
  isInDuplicateDevNameBlock(lines, index) {
    // Walk a small window around this line and check for the marker
    const window = 8;
    const start = Math.max(0, index - window);
    const end = Math.min(lines.length - 1, index + window);
    for (let i = start; i <= end; i++) {
      if (lines[i].includes('DUPLICATE_DEVELOPER_NAME')) return true;
    }
    return false;
  }

  /**
   * Extract all error lines from log
   * @param {string} content - Error log content
   * @returns {Array<Object>} Array of error objects
   */
  extractAllErrors(content) {
    const lines = content.split('\n');
    const errors = [];

    lines.forEach((line, index) => {
      const trimmedLine = line.trim();
      if (trimmedLine.length > 0 && !this.isInDuplicateDevNameBlock(lines, index)) {
        errors.push({
          line: index + 1,
          message: trimmedLine,
          type: this.categorizeError(trimmedLine)
        });
      }
    });

    return errors;
  }

  /**
   * Categorize error type
   * @param {string} errorLine - Single error line
   * @returns {string} Error category
   */
  categorizeError(errorLine) {
    if (/missing|not found|could not find/i.test(errorLine)) {
      return 'missing_dependency';
    }
    if (/setting|configuration/i.test(errorLine)) {
      return 'settings_mismatch';
    }
    if (/auth|session|login/i.test(errorLine)) {
      return 'authentication';
    }
    if (/timeout|timed out/i.test(errorLine)) {
      return 'timeout';
    }
    if (/permission|access denied/i.test(errorLine)) {
      return 'permission';
    }
    if (/validation|invalid/i.test(errorLine)) {
      return 'validation';
    }
    return 'unknown';
  }

  /**
   * Check if error log exists and has errors
   * @param {string} logPath - Path to error log
   * @returns {Promise<boolean>} True if errors exist
   */
  async hasErrors(logPath = null) {
    try {
      const targetPath = logPath || this.errorLogPath;
      
      if (!await fs.pathExists(targetPath)) {
        return false;
      }

      const stats = await fs.stat(targetPath);
      return stats.size > 0;
    } catch (error) {
      logger.logError(error, { operation: 'hasErrors', logPath });
      return false;
    }
  }

  /**
   * Clear error log file
   * @param {string} logPath - Path to error log
   */
  async clearErrorLog(logPath = null) {
    try {
      const targetPath = logPath || this.errorLogPath;
      
      if (await fs.pathExists(targetPath)) {
        await fs.remove(targetPath);
        logger.info('Error log cleared', { path: targetPath });
      }
    } catch (error) {
      logger.logError(error, { operation: 'clearErrorLog', logPath });
    }
  }

  /**
   * Get error log statistics
   * @param {string} logPath - Path to error log
   * @returns {Promise<Object>} Error log statistics
   */
  async getErrorLogStats(logPath = null) {
    try {
      const targetPath = logPath || this.errorLogPath;
      
      if (!await fs.pathExists(targetPath)) {
        return {
          exists: false,
          size: 0,
          lineCount: 0,
          errors: []
        };
      }

      const content = await fs.readFile(targetPath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim().length > 0);
      const stats = await fs.stat(targetPath);

      return {
        exists: true,
        size: stats.size,
        lineCount: lines.length,
        modifiedAt: stats.mtime,
        errors: this.extractAllErrors(content)
      };
    } catch (error) {
      logger.logError(error, { operation: 'getErrorLogStats', logPath });
      return {
        exists: false,
        size: 0,
        lineCount: 0,
        errors: []
      };
    }
  }

  /**
   * Build targeted retry job from failed types
   * @param {string} originalJobPath - Path to original job file
   * @param {string} logPath - Path to error log (optional)
   * @returns {Promise<string|null>} Path to retry job or null if no failed types
   */
  async buildRetryJob(originalJobPath, logPath = null) {
    try {
      const errorAnalysis = await this.parseVlocityErrors(logPath);
      
      if (errorAnalysis.failedTypes.length === 0) {
        logger.info('No failed types to retry');
        return null;
      }

      // Read original job to get projectPath and other settings
      const yaml = require('yaml');
      const originalContent = await fs.readFile(originalJobPath, 'utf8');
      const originalJob = yaml.parse(originalContent);

      // Create retry job with only failed types
      const retryJob = {
        projectPath: originalJob.projectPath || './deploy',
        queries: errorAnalysis.failedTypes.map(type => type)
      };

      // Copy other relevant settings from original job
      if (originalJob.defaultMaxParallel) {
        retryJob.defaultMaxParallel = originalJob.defaultMaxParallel;
      }
      if (originalJob.exportPacksMaxSize) {
        retryJob.exportPacksMaxSize = originalJob.exportPacksMaxSize;
      }
      if (originalJob.maxDepth !== undefined) {
        retryJob.maxDepth = originalJob.maxDepth;
      }

      // Generate retry job path
      const retryJobPath = originalJobPath.replace('.yaml', '-retry.yaml').replace('.yml', '-retry.yml');
      
      // Write retry job
      await fs.writeFile(retryJobPath, yaml.stringify(retryJob), 'utf8');
      
      logger.info('Retry job generated', {
        originalJob: originalJobPath,
        retryJob: retryJobPath,
        failedTypes: errorAnalysis.failedTypes.length
      });

      return retryJobPath;
    } catch (error) {
      logger.logError(error, { operation: 'buildRetryJob', originalJobPath });
      return null;
    }
  }
  /**
   * Parse VlocityBuildLog.yaml for additional error detection
   * **NEW FEATURE**: More accurate error detection from build log
   * @param {string} logPath - Path to VlocityBuildLog.yaml (optional)
   * @returns {Object|null} Parsed build log statistics or null if file doesn't exist
   */
  async parseVlocityBuildLog(logPath = null) {
    try {
      const targetPath = logPath || this.buildLogPath;
      
      if (!await fs.pathExists(targetPath)) {
        logger.debug('No VlocityBuildLog.yaml found');
        return null;
      }

      const content = await fs.readFile(targetPath, 'utf8');
      const buildLog = yaml.parse(content, YAML_PARSE_OPTIONS);
      
      // Extract error count from YAML structure
      // Look for patterns like "Error: <number>" or errors field
      let errorCount = 0;
      let warningCount = 0;
      let successCount = 0;
      let totalRecords = 0;

      // Build log structure: Count.Error/Count.Remaining are objects (type -> count)
      const sumObjectValues = (obj) =>
        obj && typeof obj === 'object'
          ? Object.values(obj).reduce((s, v) => s + (parseInt(v) || 0), 0)
          : (parseInt(obj) || 0);

      const countSection = buildLog.Count || {};
      errorCount = sumObjectValues(countSection.Error || buildLog.Error || buildLog.error || 0);
      const remainingCount = sumObjectValues(countSection.Remaining || 0);
      successCount = sumObjectValues(countSection.Success || buildLog.Success || buildLog.success || 0);
      warningCount = sumObjectValues(countSection.Warning || buildLog.Warning || buildLog.warning || 0);

      const result = {
        totalRecords,
        successCount,
        errorCount,
        remainingCount,
        warningCount,
        hasErrors: errorCount > 0 || remainingCount > 0,
        hasWarnings: warningCount > 0,
        buildLog: buildLog // Include full log for reference
      };

      logger.info('VlocityBuildLog.yaml parsed', result);
      return result;
    } catch (error) {
      logger.logError(error, { operation: 'parseVlocityBuildLog', logPath });
      return null;
    }
  }

  /**
   * Check if job has errors by examining both error log and build log
   * **NEW FEATURE**: Combined error detection from multiple sources
   * @returns {Object} Comprehensive error status
   */
  async hasErrors() {
    const errorLogExists = await fs.pathExists(this.errorLogPath);
    const buildLogResult = await this.parseVlocityBuildLog();
    
    // Check VlocityBuildErrors.log (if it has content, there are errors)
    const errorLogHasErrors = errorLogExists && (await fs.stat(this.errorLogPath)).size > 0;
    
    // Check VlocityBuildLog.yaml for error count
    const buildLogHasErrors = buildLogResult && buildLogResult.hasErrors;
    
    return {
      hasErrors: errorLogHasErrors || buildLogHasErrors,
      errorLogExists,
      errorLogHasErrors,
      buildLogHasErrors,
      buildLogStats: buildLogResult
    };
  }
}

module.exports = new ErrorLogParser();

