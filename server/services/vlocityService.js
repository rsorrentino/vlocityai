const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const yaml = require('yaml');
const logger = require('../utils/logger');
const { NotFoundError, ValidationError } = require('../middleware/errorHandler');
const jobMonitor = require('./jobMonitor');
const jobExecutionService = require('./jobExecutionService');
const tempFileService = require('./tempFileService');
const jobConfigService = require('./jobConfigService');
const vlocityVersionService = require('./vlocityVersionService');

class VlocityService {
  constructor() {
    this.vlocityVersion = process.env.VLOCITY_VERSION || '1.17.18';
    this.timeout = parseInt(process.env.VLOCITY_TIMEOUT) || 300000;
    this.tempDir = tempFileService.tempDir; // Use temp file service
  }

  /**
   * Execute Vlocity CLI command
   * @param {string} command - Vlocity command to execute
   * @param {Object} options - Command options
   * @param {string} options.username - Salesforce username
   * @param {string} options.jobFile - Job file path
   * @param {string} options.jobId - Job ID for WebSocket streaming (optional)
   * @param {Object} options.extraArgs - Additional command arguments
   * @returns {Promise<Object>} Command result
   */
  async executeCommand(command, options = {}) {
    const { username, jobFile, jobId, extraArgs = {}, version = null } = options;
    
    if (!username) {
      throw new ValidationError('Salesforce username is required');
    }

    // Validate and get version info
    const versionInfo = await vlocityVersionService.validateJobVersion(version, jobId);
    const vlocityCommand = versionInfo.command;

    const startTime = Date.now();
    const args = [];

    if (username) {
      args.push('-sfdx.username', `"${username}"`);
    }

    if (jobFile) {
      // Convert absolute path to relative path for Vlocity CLI
      const relativePath = path.relative(process.cwd(), jobFile).replace(/\\/g, '/');
      args.push('-job', `"${relativePath}"`);
      
      // Log file operation
      if (jobId) {
        logger.logFileOperation(jobId, 'job_file_loaded', jobFile, {
          relativePath,
          absolutePath: jobFile
        });
      }
    }

    // Add extra arguments
    Object.entries(extraArgs).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        args.push(key, value);
      }
    });

    args.push(command);

    logger.logVlocityOperation(command, username, { args });

    // Log verbose command details
    if (jobId) {
      logger.logJobVerbose(jobId, 'Vlocity command preparation', {
        command,
        username,
        jobFile,
        args,
        timeout: this.timeout,
        version: versionInfo.version,
        vlocityCommand
      });
    }

    const runCommand = (controls = {}) => new Promise((resolve, reject) => {
      const setProcess = controls.setProcess || (() => {});
      const isAborted = controls.isAborted || (() => false);
      const getAbortReason = controls.getAbortReason || (() => 'Aborted by user');

      // Use versioned vlocity command with shell for better Windows compatibility
      const commandString = `${vlocityCommand} ${args.join(' ')}`;
      
      // Set environment variables for Vlocity CLI
      const env = { ...process.env };
      if (username) {
        env.SFDX_USERNAME = username;
      }
      // Suppress Node.js deprecation warnings in child processes
      env.NODE_NO_WARNINGS = '1';
      
      logger.info(`Executing command: ${commandString}`);
      
      // Log debug information
      if (jobId) {
        // Store the full command string for later reference
        jobMonitor.addJobLog(jobId, `📋 Command: ${commandString}`, 'debug');
        
        logger.logJobDebug(jobId, 'Vlocity command execution details', {
          commandString,
          workingDirectory: process.cwd(),
          environment: env,
          timeout: this.timeout,
          version: versionInfo.version,
          vlocityCommand
        });
      }
      
      const child = spawn(commandString, [], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: this.timeout,
        shell: true, // Use shell on Windows to handle .cmd files
        windowsHide: true, // Hide Windows command window
        env: env, // Pass environment variables
      });
      setProcess(child);

      let stdout = '';
      let stderr = '';

      // Helper function to filter out deprecation warnings and numeric-only errors
      const isDeprecationWarning = (line) => {
        if (!line) return false;
        
        // Node.js deprecation warnings
        if (/\(node:\d+\)\s*\[DEP\d+\]/.test(line) ||
            /DeprecationWarning|DEP00\d{2}/i.test(line) ||
            /The `util\.is(?:NullOrUndefined|Object|Array)` API is deprecated/i.test(line) ||
            /Please use `arg === null \|\| arg === undefined`/i.test(line) ||
            /Please use `arg !== null && typeof arg === "object"`/i.test(line) ||
            /Please use `Array\.isArray\(\)`/i.test(line) ||
            /\(Use `node --trace-deprecation/i.test(line)) {
          return true;
        }
        
        // Filter out numeric-only error messages like "Error >> 18" or "Error: 18"
        const trimmed = line.trim();
        if (/^Error\s*[>:]\s*\d+$/i.test(trimmed) ||
            /^Error\s+\d+$/i.test(trimmed)) {
          return true;
        }
        
        return false;
      };

      child.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        
        // Emit log to WebSocket if jobId is provided
        if (jobId) {
          const lines = output.split('\n').filter(line => line.trim() && !isDeprecationWarning(line));
          lines.forEach(line => {
            jobMonitor.addJobLog(jobId, line, 'info');
            
            // Log verbose output
            logger.logJobVerbose(jobId, 'Vlocity output', { line });
            
            // Check if job completed successfully
            const completedMatch = line.match(/(\d+)\s+Completed/i);
            if (completedMatch) {
              const count = parseInt(completedMatch[1]);
              if (count > 0) {
                // Job has completed successfully
                jobMonitor.updateJobProgress(jobId, 100, `${count} items completed successfully`);
              }
            }
            
            // Also check for "Export success:" message
            if (line.match(/Export\s+success:/i) || line.match(/Deploy\s+success:/i)) {
              jobMonitor.updateJobProgress(jobId, 100, 'Operation completed successfully');
            }
          });
        }
      });

      child.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        
        // Emit error log to WebSocket if jobId is provided (filter deprecation warnings)
        if (jobId) {
          const lines = output.split('\n').filter(line => line.trim() && !isDeprecationWarning(line));
          lines.forEach(line => {
            jobMonitor.addJobLog(jobId, line, 'error');
          });
        }
      });

      child.on('close', (code) => {
        if (isAborted()) {
          const abortedError = new Error(getAbortReason());
          abortedError.code = 'JOB_ABORTED';
          return reject(abortedError);
        }

        const duration = Date.now() - startTime;
        const result = {
          code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          success: code === 0,
        };

        // Log command completion with enhanced details
        if (jobId) {
          logger.logVlocityCommand(jobId, command, stdout + stderr, code, duration);
        }

        if (code === 0) {
          logger.logVlocityOperation(`${command} completed`, username, { 
            success: true,
            outputLength: stdout.length,
            duration: `${duration}ms`
          });
          resolve(result);
        } else {
          // Check for authentication errors
          const combinedOutput = stdout + stderr;
          const authError = this.detectAuthError(combinedOutput, username);
          
          logger.logVlocityOperation(`${command} failed`, username, { 
            success: false,
            code,
            error: stderr,
            authError: authError ? true : false,
            duration: `${duration}ms`
          });
          
          const error = new Error(`Vlocity command failed with code ${code}: ${stderr}`);
          error.authError = authError;
          reject(error);
        }
      });

      child.on('error', (error) => {
        logger.logError(error, { command, username });
        reject(error);
      });

      child.on('timeout', () => {
        child.kill();
        reject(new Error(`Vlocity command timed out after ${this.timeout}ms`));
      });
    });

    if (jobId) {
      return jobExecutionService.enqueueExecution({
        jobId,
        label: `vlocity:${command}`,
        execute: runCommand,
      });
    }

    return runCommand();
  }

  /**
   * Detect authentication errors and provide re-login instructions
   */
  detectAuthError(output, username) {
    const authErrorPatterns = [
      /Error Salesforce DX Org Info Invalid - Please Login Again/i,
      /InvalidAuthToken/i,
      /INVALID_SESSION_ID/i,
      /Session expired or invalid/i,
      /Authentication failed/i,
      /Not authorized/i,
      /No AuthInfo found/i
    ];

    for (const pattern of authErrorPatterns) {
      if (pattern.test(output)) {
        return this.getReloginInstructions(username);
      }
    }

    return null;
  }

  /**
   * Get org configuration (alias and instance URL) from environments.properties
   */
  getOrgConfig(username) {
    try {
      const fs = require('fs');
      const path = require('path');
      const propertiesPath = path.join(__dirname, '../../environments.properties');
      
      if (!fs.existsSync(propertiesPath)) {
        return { alias: username, instanceUrl: null }; // Fallback if file doesn't exist
      }

      const content = fs.readFileSync(propertiesPath, 'utf8');
      const lines = content.split('\n');
      
      // Look for SOURCE_SFDX_USERNAME or TARGET_SFDX_USERNAME matching this username
      for (const line of lines) {
        if (line.includes(`_USERNAME.`) && line.includes(username)) {
          // Extract environment (dev, uat, prod)
          const match = line.match(/_USERNAME\.([^=]+)=/);
          if (match) {
            const env = match[1];
            let alias = null;
            let instanceUrl = null;
            
            // Determine if this is SOURCE or TARGET
            const isSource = line.startsWith('SOURCE_SFDX_USERNAME');
            const prefix = isSource ? 'SOURCE' : 'TARGET';
            
            // Look for corresponding alias and URL
            for (const configLine of lines) {
              if (configLine.includes(`${prefix}_SFDX_ALIAS.${env}=`)) {
                const aliasValue = configLine.split('=')[1]?.trim();
                if (aliasValue) alias = aliasValue;
              }
              if (configLine.includes(`${prefix}_SFDX_URL.${env}=`)) {
                let urlValue = configLine.split('=')[1]?.trim();
                if (urlValue) {
                  // Fix double dashes in hostname (common configuration error)
                  // e.g., https://myamplifonglobal--mastcatdev.sandbox.my.salesforce.com
                  // should be https://myamplifonglobal-mastcatdev.sandbox.my.salesforce.com
                  urlValue = urlValue.replace(/--+/g, '-'); // Replace multiple dashes with single dash
                  instanceUrl = urlValue;
                }
              }
            }
            
            return {
              alias: alias || username,
              instanceUrl: instanceUrl
            };
          }
        }
      }
      
      return { alias: username, instanceUrl: null }; // Fallback to username
    } catch (error) {
      logger.logError(error, { operation: 'getOrgConfig', username });
      return { alias: username, instanceUrl: null };
    }
  }

  /**
   * Generate re-login instructions for authentication errors
   */
  getReloginInstructions(username) {
    const orgConfig = this.getOrgConfig(username);
    
    // Build the command with alias and instance URL
    let command = `sf org login web --alias ${orgConfig.alias}`;
    if (orgConfig.instanceUrl) {
      command += ` --instance-url ${orgConfig.instanceUrl}`;
    }
    
    return {
      message: 'Salesforce authentication expired or invalid',
      username: username,
      alias: orgConfig.alias,
      instanceUrl: orgConfig.instanceUrl,
      command: command,
      instructions: [
        'Open a terminal and run the command below',
        'Complete the authentication in your browser',
        'Retry the job after successful authentication'
      ]
    };
  }

  /**
   * Export DataPacks using a job file
   * @param {string} username - Salesforce username
   * @param {string} jobFilePath - Path to job file
   * @param {string} jobId - Job ID for WebSocket streaming (optional)
   * @returns {Promise<Object>} Export result
   */
  async exportDataPacks(username, jobFilePath, jobId = null) {
    try {
      const result = await this.executeCommand('packExport', {
        username,
        jobFile: jobFilePath,
        jobId,
      });

      // Parse export results
      const exportResult = this.parseExportResult(result.stdout);
      
      // Fix malformed JSON files after export (even if export had errors)
      try {
        const dataPackFileFixer = require('./dataPackFileFixer');
        const jobConfig = await this.readJobFile(jobFilePath);
        const projectPath = jobConfig.projectPath || './export';
        
        // Fix JSON files in the export directory
        const fixResults = await dataPackFileFixer.fixExportDirectory(projectPath);
        
        if (fixResults.totalFixed > 0) {
          logger.info('Fixed malformed JSON files after export', {
            username,
            projectPath,
            fixed: fixResults.totalFixed,
            failed: fixResults.totalFailed,
            totalFiles: fixResults.totalFiles
          });
          
          // Add fix results to export result
          exportResult.jsonFilesFixed = fixResults.totalFixed;
          exportResult.jsonFilesFailed = fixResults.totalFailed;
        }
      } catch (fixError) {
        // Don't fail the export if fix fails, just log it
        logger.warn('Failed to fix JSON files after export', {
          username,
          error: fixError.message
        });
      }
      
      return {
        success: true,
        result: exportResult,
        rawOutput: result.stdout,
      };
    } catch (error) {
      logger.logError(error, { operation: 'exportDataPacks', username, jobFilePath });
      throw error;
    }
  }

  /**
   * Deploy DataPacks using a job file
   * @param {string} username - Salesforce username
   * @param {string} jobFilePath - Path to job file
   * @param {string} jobId - Job ID for WebSocket streaming (optional)
   * @returns {Promise<Object>} Deploy result
   */
  async deployDataPacks(username, jobFilePath, jobId = null, version = null) {
    try {
      const result = await this.executeCommand('packDeploy', {
        username,
        jobFile: jobFilePath,
        jobId,
        version,
      });

      const deployResult = this.parseDeployResult(result.stdout);
      
      return {
        success: true,
        result: deployResult,
        rawOutput: result.stdout,
      };
    } catch (error) {
      logger.logError(error, { operation: 'deployDataPacks', username, jobFilePath });
      throw error;
    }
  }

  /**
   * Validate DataPacks using a job file
   * @param {string} username - Salesforce username
   * @param {string} jobFilePath - Path to job file
   * @param {string} jobId - Job ID for WebSocket streaming (optional)
   * @returns {Promise<Object>} Validation result
   */
  async validateDataPacks(username, jobFilePath, jobId = null) {
    try {
      const result = await this.executeCommand('validateLocalData', {
        username,
        jobFile: jobFilePath,
        jobId,
      });

      return {
        success: true,
        result: this.parseValidationResult(result.stdout),
        rawOutput: result.stdout,
      };
    } catch (error) {
      // validateLocalData may not be available in all Vlocity CLI versions
      // Log a warning but don't fail - validation is optional
      // Check for various error patterns including typos like "packaValidated"
      const errorMessage = error.message || '';
      const errorStderr = error.stderr || '';
      const errorText = errorMessage.toLowerCase();
      const stderrText = errorStderr.toLowerCase();
      const combinedError = `${errorText} ${stderrText}`;
      
      // Check for command not found errors, including typos in Vlocity CLI error messages
      // Check both original (case-sensitive) and lowercased versions
      const isCommandNotFound = 
        combinedError.includes('command not found') || 
        combinedError.includes('validateLocalData') || 
        combinedError.includes('packavalidated') ||
        combinedError.includes('packavalidate') ||
        combinedError.includes('packavalid') ||
        errorMessage.includes('packaValidated') || // Case-sensitive check for exact typo
        errorMessage.includes('packaValidate') ||
        errorStderr.includes('packaValidated') ||
        errorStderr.includes('packaValidate');
      
      if (isCommandNotFound) {
        logger.warn('validateLocalData command not available in this Vlocity CLI version. Skipping validation.', {
          username,
          jobFilePath,
          error: errorMessage || errorStderr || 'Command not found',
          originalError: errorMessage
        });
        return {
          success: true,
          result: {
            isValid: true,
            message: 'Validation skipped - validateLocalData command not available',
            skipped: true
          },
          rawOutput: '',
          skipped: true
        };
      }
      logger.logError(error, { operation: 'validateDataPacks', username, jobFilePath });
      throw error;
    }
  }

  /**
   * Update DataPack settings
   * @param {string} username - Salesforce username
   * @returns {Promise<Object>} Update result
   */
  async updateSettings(username) {
    try {
      const result = await this.executeCommand('packUpdateSettings', {
        username,
      });

      return {
        success: true,
        result: this.parseSettingsUpdateResult(result.stdout),
        rawOutput: result.stdout,
      };
    } catch (error) {
      logger.logError(error, { operation: 'updateSettings', username });
      throw error;
    }
  }

  /**
   * Create a job file from configuration
   * @param {Object} jobConfig - Job configuration
   * @param {string} outputPath - Output file path
   * @returns {Promise<string>} Created file path
   */
  async createJobFile(jobConfig, outputPath) {
    try {
      // Merge with defaults using jobConfigService
      const mergedConfig = jobConfigService.mergeWithDefaults(jobConfig);
      
      // Resolve query definitions (convert shorthand to full queries)
      if (mergedConfig.queries) {
        mergedConfig.queries = jobConfigService.resolveQueries(mergedConfig.queries);
      }

      // Validate configuration
      const validation = jobConfigService.validateConfig(mergedConfig);
      if (!validation.valid) {
        logger.warn('Job configuration has errors', { 
          errors: validation.errors,
          outputPath 
        });
        throw new ValidationError(`Job configuration invalid: ${validation.errors.join(', ')}`);
      }
      
      if (validation.warnings.length > 0) {
        logger.warn('Job configuration warnings', { 
          warnings: validation.warnings,
          outputPath 
        });
      }

      // Serialize queries in compact Vlocity YAML format:
      //   type-only  → plain string  (- AttributeAssignmentRule)
      //   with query → mapping       (- VlocityDataPackType: DataRaptor\n  query: ...)
      if (mergedConfig.queries) {
        mergedConfig.queries = mergedConfig.queries.map(q => {
          if (typeof q === 'object' && q.VlocityDataPackType && !q.query) {
            return q.VlocityDataPackType;
          }
          return q;
        });
      }

      const yamlContent = yaml.stringify(mergedConfig, {
        indent: 2,
        lineWidth: 0,
      });

      await fs.writeFile(outputPath, yamlContent, 'utf8');
      
      logger.logOperation('Job file created', { 
        outputPath, 
        queriesCount: mergedConfig.queries?.length || 0,
        mergedSettings: Object.keys(mergedConfig).length
      });

      return outputPath;
    } catch (error) {
      logger.logError(error, { operation: 'createJobFile', outputPath });
      throw error;
    }
  }

  /**
   * Read job file and parse YAML
   * @param {string} jobFilePath - Path to job file
   * @returns {Promise<Object>} Parsed job configuration
   */
  async readJobFile(jobFilePath) {
    try {
      const fs = require('fs-extra');
      const yaml = require('yaml');
      const content = await fs.readFile(jobFilePath, 'utf8');
      return yaml.parse(content);
    } catch (error) {
      logger.logError(error, { operation: 'readJobFile', jobFilePath });
      throw error;
    }
  }

  /**
   * Parse export result from stdout
   * @param {string} stdout - Command stdout
   * @returns {Object} Parsed result
   */
  parseExportResult(stdout) {
    // Basic parsing - can be enhanced based on actual Vlocity output format
    const lines = stdout.split('\n');
    const result = {
      exportedPacks: 0,
      errors: [],
      warnings: [],
      summary: {},
    };

    lines.forEach(line => {
      if (line.includes('exported') || line.includes('pack')) {
        const match = line.match(/(\d+)/);
        if (match) {
          result.exportedPacks = parseInt(match[1]);
        }
      }
      
      if (line.toLowerCase().includes('error')) {
        result.errors.push(line.trim());
      }
      
      if (line.toLowerCase().includes('warning')) {
        result.warnings.push(line.trim());
      }
    });

    return result;
  }

  /**
   * Parse deploy result from stdout
   * @param {string} stdout - Command stdout
   * @returns {Object} Parsed result
   */
  parseDeployResult(stdout) {
    const lines = stdout.split('\n');
    const result = {
      deployedPacks: 0,
      errors: [],
      warnings: [],
      summary: {},
    };

    lines.forEach(line => {
      if (line.includes('deployed') || line.includes('pack')) {
        const match = line.match(/(\d+)/);
        if (match) {
          result.deployedPacks = parseInt(match[1]);
        }
      }
      
      if (line.toLowerCase().includes('error')) {
        result.errors.push(line.trim());
      }
      
      if (line.toLowerCase().includes('warning')) {
        result.warnings.push(line.trim());
      }
    });

    return result;
  }

  /**
   * Parse validation result from stdout
   * @param {string} stdout - Command stdout
   * @returns {Object} Parsed result
   */
  parseValidationResult(stdout) {
    const lines = stdout.split('\n');
    const result = {
      validatedPacks: 0,
      errors: [],
      warnings: [],
      isValid: true,
    };

    lines.forEach(line => {
      if (line.includes('validated') || line.includes('pack')) {
        const match = line.match(/(\d+)/);
        if (match) {
          result.validatedPacks = parseInt(match[1]);
        }
      }
      
      if (line.toLowerCase().includes('error')) {
        result.errors.push(line.trim());
        result.isValid = false;
      }
      
      if (line.toLowerCase().includes('warning')) {
        result.warnings.push(line.trim());
      }
    });

    return result;
  }

  /**
   * Parse settings update result from stdout
   * @param {string} stdout - Command stdout
   * @returns {Object} Parsed result
   */
  parseSettingsUpdateResult(stdout) {
    return {
      success: true,
      message: stdout.trim(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Check if Vlocity CLI is available
   * @returns {Promise<boolean>} Availability status
   */
  async checkAvailability() {
    try {
      const { spawn } = require('child_process');
      
      // Try multiple approaches to check Vlocity CLI availability
      const approaches = [
        // Approach 1: Try direct vlocity command with shell (most reliable on Windows)
        () => this.checkWithCommandShell('vlocity', ['--version']),
        // Approach 2: Try npx.cmd vlocity --version
        () => this.checkWithCommandShell('npx.cmd', ['vlocity', '--version']),
        // Approach 3: Try npx vlocity --version
        () => this.checkWithCommandShell('npx', ['vlocity', '--version']),
      ];

      for (const approach of approaches) {
        try {
          const result = await approach();
          if (result) {
            // Only log once when CLI is found, suppress individual approach success
            return true;
          }
        } catch (error) {
          // Continue to next approach silently
        }
      }

      logger.logOperation('Vlocity CLI not found after trying all approaches');
      return false;
    } catch (error) {
      logger.logError(error, { operation: 'checkAvailability' });
      return false;
    }
  }

  /**
   * Helper method to check CLI availability with specific command using shell
   * @param {string} command - Command to run
   * @param {Array} args - Command arguments
   * @returns {Promise<boolean>} Success status
   */
  async checkWithCommandShell(command, args) {
    return new Promise((resolve) => {
      const { spawn } = require('child_process');
      
      // Use shell mode for better Windows compatibility
      const commandString = `${command} ${args.join(' ')}`;
      const child = spawn(commandString, [], { 
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        windowsHide: true,
        timeout: 10000 // 10 second timeout
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        const success = code === 0;
        if (!success) {
          logger.logOperation('CLI command failed', { command, args, code, stderr: stderr.trim() });
        }
        // Suppress all success logging - only log failures
        resolve(success);
      });

      child.on('error', (error) => {
        logger.logOperation('CLI command error', { command, args, error: error.message });
        resolve(false);
      });
    });
  }

  /**
   * Helper method to check CLI availability with specific command
   * @param {string} command - Command to run
   * @param {Array} args - Command arguments
   * @returns {Promise<boolean>} Success status
   */
  async checkWithCommand(command, args) {
    return new Promise((resolve) => {
      const { spawn } = require('child_process');
      
      // Use proper argument handling without shell
      const child = spawn(command, args, { 
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
        timeout: 10000 // 10 second timeout
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        const success = code === 0;
        if (!success) {
          logger.logOperation('CLI command failed', { command, args, code, stderr: stderr.trim() });
        }
        // Suppress all success logging - only log failures
        resolve(success);
      });

      child.on('error', (error) => {
        logger.logOperation('CLI command error', { command, args, error: error.message });
        resolve(false);
      });

      // Handle timeout
      setTimeout(() => {
        child.kill();
        logger.logOperation('CLI command timeout', { command, args });
        resolve(false);
      }, 10000);
    });
  }

  /**
   * Get Vlocity CLI version
   * @returns {Promise<string>} Version string
   */
  async getVersion() {
    try {
      // First check if CLI is available
      const isAvailable = await this.checkAvailability();
      if (!isAvailable) {
        throw new Error('Vlocity CLI not available');
      }

      // Get the actual version from the command output
      const { spawn } = require('child_process');
      
      return new Promise((resolve, reject) => {
        // Use direct vlocity command with shell for better Windows compatibility
        const commandString = 'vlocity --version';
        const child = spawn(commandString, [], { 
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: true,
          windowsHide: true,
          timeout: 10000
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        child.on('close', (code) => {
          if (code === 0) {
            resolve(stdout.trim());
          } else {
            reject(new Error(`Failed to get version: ${stderr.trim()}`));
          }
        });

        child.on('error', (error) => {
          reject(error);
        });

        // Handle timeout
        setTimeout(() => {
          child.kill();
          reject(new Error('Version check timeout'));
        }, 10000);
      });
    } catch (error) {
      logger.logError(error, { operation: 'getVersion' });
      throw error;
    }
  }

  /**
   * Clean up temporary files for a job
   * @param {string} jobId - Job ID
   * @param {boolean} force - Force cleanup regardless of KEEP_TMP mode
   * @returns {Promise<Object>} Cleanup result
   */
  async cleanupJobTempFiles(jobId, force = false) {
    try {
      const result = await tempFileService.cleanupJobTempFiles(jobId, force);
      
      logger.log('info', `Cleaned up temporary files for job ${jobId}`, {
        jobId,
        ...result,
        service: 'vlocityService'
      });
      
      return result;
    } catch (error) {
      logger.logError(error, {
        operation: 'cleanupJobTempFiles',
        jobId,
        service: 'vlocityService'
      });
      throw error;
    }
  }

  /**
   * Create a temporary file for a job
   * @param {string} jobId - Job ID
   * @param {string} filename - Filename
   * @param {string} content - File content
   * @param {Object} options - Options
   * @returns {Promise<string>} File path
   */
  async createJobTempFile(jobId, filename, content = '', options = {}) {
    try {
      const filePath = await tempFileService.createTempFile(jobId, filename, content, options);
      
      logger.logFileOperation(jobId, 'job_temp_file_created', filePath, {
        filename,
        size: content.length,
        service: 'vlocityService'
      });
      
      return filePath;
    } catch (error) {
      logger.logError(error, {
        operation: 'createJobTempFile',
        jobId,
        filename,
        service: 'vlocityService'
      });
      throw error;
    }
  }
}

module.exports = new VlocityService();
