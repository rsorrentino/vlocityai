const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');
const { NotFoundError, ValidationError } = require('../middleware/errorHandler');
const jobMonitor = require('./jobMonitor');
const jobExecutionService = require('./jobExecutionService');

/**
 * SF CLI Service
 * Handles export and deploy operations using Salesforce CLI (sf) instead of Vlocity CLI
 * Used primarily for custom objects like GT_ProductSKU__c, GT_RateCode__c, GT_RateTable__c
 */
class SfCliService {
  constructor() {
    this.timeout = parseInt(process.env.SF_CLI_TIMEOUT) || 300000; // 5 minutes default
    this.tempDir = path.join(process.cwd(), 'temp');
  }

  /**
   * Check if SF CLI is available
   * @returns {Promise<boolean>}
   */
  async isCliAvailable() {
    try {
      const result = await this.executeCommand(['--version']);
      return result.trim().length > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get SF CLI version
   * @returns {Promise<string>}
   */
  async getVersion() {
    try {
      const result = await this.executeCommand(['--version']);
      return result.trim();
    } catch (error) {
      throw new Error(`Failed to get SF CLI version: ${error.message}`);
    }
  }

  /**
   * Execute SF CLI command
   * @param {Array} args - Command arguments
   * @param {Object} options - Command options
   * @param {string} options.username - Salesforce username
   * @param {string} options.jobId - Job ID for WebSocket streaming (optional)
   * @param {string} options.cwd - Working directory
   * @returns {Promise<string>} Command output
   */
  async executeCommand(args, options = {}) {
    const { username, jobId, cwd = process.cwd() } = options;

    // Determine which SF CLI command to use (sf or sfdx)
    let cliCommand = 'sf';
    try {
      await this.executeCommandWithShell(['sf', '--version']);
    } catch (error) {
      try {
        await this.executeCommandWithShell(['sfdx', '--version']);
        cliCommand = 'sfdx';
      } catch (sfdxError) {
        throw new ValidationError('Neither sf nor sfdx CLI found. Please install Salesforce CLI.');
      }
    }

    const runCommand = (controls = {}) => new Promise((resolve, reject) => {
      const setProcess = controls.setProcess || (() => {});
      const isAborted = controls.isAborted || (() => false);
      const getAbortReason = controls.getAbortReason || (() => 'Aborted by user');

      const startTime = Date.now();
      
      // Set environment variables
      const env = { ...process.env };
      if (username) {
        env.SF_USERNAME = username;
        if (cliCommand === 'sfdx') {
          env.SFDX_USERNAME = username;
        }
      }

      const commandString = `${cliCommand} ${args.join(' ')}`;
      logger.info(`Executing SF CLI: ${commandString}`);

      if (jobId) {
        // Store the full command string for later reference
        const fullCommand = `${cliCommand} ${args.map(arg => arg.includes(' ') ? `"${arg}"` : arg).join(' ')}`;
        jobMonitor.addJobLog(jobId, `📋 Executing: ${fullCommand}`, 'info');
        
        logger.logJobVerbose(jobId, 'SF CLI command preparation', {
          command: cliCommand,
          args,
          fullCommand,
          username,
          cwd,
          timeout: this.timeout
        });
      }

      // On Windows with shell mode, construct full command string for better compatibility
      // This avoids issues with comma-separated SOQL queries being parsed incorrectly
      let child;
      if (process.platform === 'win32' && args.some(arg => typeof arg === 'string' && arg.includes(',') && arg.length > 100)) {
        // For Windows with complex queries, use command string approach
        const commandString = `${cliCommand} ${args.map(arg => {
          // Properly escape and quote arguments that contain commas or spaces
          if (typeof arg === 'string' && (arg.includes(',') || arg.includes(' '))) {
            // Escape internal quotes and wrap in quotes
            return `"${arg.replace(/"/g, '\\"')}"`;
          }
          return arg;
        }).join(' ')}`;
        
        child = spawn(commandString, [], {
          cwd,
          env,
          shell: true,
          windowsHide: true
        });
      } else {
        // Use standard spawn with args array
        child = spawn(cliCommand, args, {
          cwd,
          env,
          shell: process.platform === 'win32',
          windowsHide: true
        });
      }
      setProcess(child);

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        
        // Log to console for visibility
        process.stdout.write(data);
        
        if (jobId) {
          // Split output into lines and add each line as a log entry
          const lines = output.split('\n');
          
          // Process each line (including empty lines for progress indicators)
          lines.forEach((line, index) => {
            // Strip ANSI codes for cleaner log display
            const cleanLine = line.replace(/\u001b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*m/g, '');
            
            // Log non-empty lines, or if it's the last line and output was small (might be progress)
            if (cleanLine.trim() || (index === lines.length - 1 && output.length < 100 && output.trim())) {
              if (cleanLine.trim() || output.trim()) {
                jobMonitor.addJobLog(jobId, cleanLine.trim() || cleanLine, 'info');
              }
            }
          });
          
          // If no lines were logged and output exists, log it anyway (might be progress indicators)
          if (lines.length === 0 && output.trim()) {
            const cleanLine = output.replace(/\u001b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*m/g, '').trim();
            if (cleanLine) {
              jobMonitor.addJobLog(jobId, cleanLine, 'info');
            }
          }
        }
      });

      child.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        
        // Log to console for visibility
        process.stderr.write(data);
        
        if (jobId) {
          // Split output into lines and add each line as a log entry
          const lines = output.split('\n');
          
          // Process each line (including empty lines for progress indicators)
          lines.forEach((line, index) => {
            // Strip ANSI codes for cleaner log display
            const cleanLine = line.replace(/\u001b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*m/g, '');
            
            // Filter out common warnings that aren't real errors
            const isWarning = cleanLine.toLowerCase().includes('warning') ||
                             cleanLine.toLowerCase().includes('could not find typescript') ||
                             cleanLine.toLowerCase().includes('error plugin') ||
                             cleanLine.toLowerCase().includes('could not find package.json');
            
            // Log non-empty lines, or if it's the last line and output was small
            if ((cleanLine.trim() || (index === lines.length - 1 && output.length < 100 && output.trim())) && !isWarning) {
              if (cleanLine.trim() || output.trim()) {
                jobMonitor.addJobLog(jobId, cleanLine.trim() || cleanLine, 'error');
              }
            } else if (isWarning && cleanLine.trim()) {
              // Log warnings as debug level
              jobMonitor.addJobLog(jobId, cleanLine.trim(), 'debug');
            }
          });
          
          // If no lines were logged and output exists, log it anyway
          if (lines.length === 0 && output.trim()) {
            const cleanLine = output.replace(/\u001b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*m/g, '').trim();
            if (cleanLine) {
              jobMonitor.addJobLog(jobId, cleanLine, 'error');
            }
          }
        }
      });

      child.on('close', (code) => {
        if (isAborted()) {
          const abortedError = new Error(getAbortReason());
          abortedError.code = 'JOB_ABORTED';
          return reject(abortedError);
        }

        const duration = Date.now() - startTime;
        
        if (code === 0) {
          logger.info(`SF CLI command completed in ${duration}ms`);
          if (jobId) {
            jobMonitor.addJobLog(jobId, `✅ SF CLI command completed successfully in ${duration}ms`, 'info');
            logger.logJobVerbose(jobId, 'SF CLI command completed', {
              duration,
              exitCode: code
            });
          }
          resolve(stdout);
        } else {
          // Extract actual error message from stderr/stdout
          // Strip ANSI codes first
          let cleanStdout = stdout.replace(/\u001b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*m/g, '');
          let cleanStderr = stderr.replace(/\u001b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*m/g, '');
          
          // Try to extract JSON error details from stdout if available
          let errorDetails = '';
          try {
            // Look for JSON error response in stdout (status: 1 indicates error)
            // Try multiple patterns to find JSON
            const jsonPatterns = [
              /\{[\s\S]*"status"\s*:\s*1[\s\S]*\}/,  // Status 1 error
              /\{[\s\S]*"errors"[\s\S]*\}/,  // Has errors array
              /\{[\s\S]*"errorCode"[\s\S]*\}/,  // Has errorCode
              /\{[\s\S]{0,250000}\}/  // Very large JSON object (up to 250KB for detailed error responses)
            ];
            
            for (const pattern of jsonPatterns) {
              const jsonMatch = cleanStdout.match(pattern);
              if (jsonMatch) {
                try {
                  const errorJson = JSON.parse(jsonMatch[0]);
                  // Extract error messages from various possible structures
                  if (errorJson.result && errorJson.result.errors) {
                    errorDetails = errorJson.result.errors.map(e => 
                      e.message || e.errorCode || e.statusCode || JSON.stringify(e)
                    ).join('; ');
                  } else if (errorJson.errors && Array.isArray(errorJson.errors)) {
                    errorDetails = errorJson.errors.map(e => 
                      e.message || e.errorCode || e.statusCode || JSON.stringify(e)
                    ).join('; ');
                  } else if (errorJson.result && errorJson.result.message) {
                    errorDetails = errorJson.result.message;
                  } else if (errorJson.message) {
                    errorDetails = errorJson.message;
                  } else if (errorJson.errorCode) {
                    errorDetails = `${errorJson.errorCode}: ${errorJson.message || errorJson.fields || ''}`;
                  }
                  
                  if (errorDetails) break;
                } catch (parseErr) {
                  // Try next pattern
                  continue;
                }
              }
            }
          } catch (e) {
            // Not JSON, continue with text extraction
          }
          
          // Also try to extract error messages from text patterns in stdout
          if (!errorDetails && cleanStdout) {
            // Look for common error message patterns
            const textErrorPatterns = [
              /We couldn't process your request because[^\n]+/i,
              /duplicate value[^\n]+/i,
              /required field[^\n]+/i,
              /validation rule[^\n]+/i,
              /field-level security[^\n]+/i,
              /INVALID_FIELD[^\n]+/i,
              /REQUIRED_FIELD_MISSING[^\n]+/i
            ];
            
            for (const pattern of textErrorPatterns) {
              const match = cleanStdout.match(pattern);
              if (match) {
                errorDetails = match[0].trim();
                break;
              }
            }
          }
          
          // Try to extract specific error details from large stdout
          // Look for error patterns in the full stdout (not just beginning)
          let extractedError = '';
          if (cleanStdout && cleanStdout.length > 1000) {
            // For large stdout, look for specific error sections
            // SF CLI data tree import often has errors in a structured format
            const errorSectionPatterns = [
              /"errors"\s*:\s*\[([^\]]+)\]/i,  // errors array
              /"errorCode"\s*:\s*"([^"]+)"/i,  // errorCode field
              /"message"\s*:\s*"([^"]+)"/i,  // message field
              /INVALID_FIELD[^\n]*\n[^\n]*\n[^\n]*/i,  // INVALID_FIELD with context
              /REQUIRED_FIELD_MISSING[^\n]*\n[^\n]*\n[^\n]*/i,  // REQUIRED_FIELD_MISSING with context
              /duplicate value[^\n]*\n[^\n]*/i,  // duplicate value with context
              /field-level security[^\n]*\n[^\n]*/i  // field-level security with context
            ];
            
            for (const pattern of errorSectionPatterns) {
              const matches = cleanStdout.match(pattern);
              if (matches) {
                extractedError = matches[0].substring(0, 1000); // Limit to 1000 chars
                break;
              }
            }
            
            // Also try to find the last occurrence of "Error" or "error" in the output
            if (!extractedError) {
              const lastErrorIndex = cleanStdout.lastIndexOf('Error');
              if (lastErrorIndex > 0) {
                extractedError = cleanStdout.substring(Math.max(0, lastErrorIndex - 100), Math.min(cleanStdout.length, lastErrorIndex + 1000));
              }
            }
          }
          
          // Extract error message from stderr or stdout
          let errorMessage = cleanStderr || cleanStdout || 'Unknown error';
          
          // Try to extract the actual error message after "Error (SfError):" or similar patterns
          const errorMatch = errorMessage.match(/Error\s*\([^)]+\):\s*(.+)/i);
          if (errorMatch && errorMatch[1]) {
            errorMessage = errorMatch[1].trim();
          }
          
          // Look for common error patterns
          const errorPatterns = [
            /Data Import failed/i,
            /duplicate value/i,
            /required field/i,
            /invalid field/i,
            /validation rule/i
          ];
          
          if (!extractedError) {
            for (const pattern of errorPatterns) {
              const match = errorMessage.match(pattern);
              if (match) {
                // Extract surrounding context (next 200 chars)
                const index = errorMessage.indexOf(match[0]);
                extractedError = errorMessage.substring(index, Math.min(index + 500, errorMessage.length));
                break;
              }
            }
          }
          
          // Use extracted error details if available, otherwise use error message
          let finalError = errorDetails || extractedError || errorMessage;
          
          // Log extracted error details to job logs for better visibility
          if (errorDetails && jobId) {
            logger.logJobVerbose(jobId, 'Extracted error details from SF CLI output', {
              errorDetails: errorDetails.substring(0, 500), // Log first 500 chars
              stdoutLength: cleanStdout.length,
              stderrLength: cleanStderr.length
            });
            jobMonitor.addJobLog(jobId, `🔍 Error Details: ${errorDetails.substring(0, 500)}`, 'error');
          }
          
          // If we have a large stdout but no error details, log a sample
          if (!errorDetails && cleanStdout && cleanStdout.length > 10000 && jobId) {
            // Log last 2000 chars of stdout (where errors often appear)
            const stdoutSample = cleanStdout.substring(Math.max(0, cleanStdout.length - 2000));
            logger.logJobVerbose(jobId, 'Large stdout but no error details extracted, logging sample', {
              stdoutSample: stdoutSample.substring(0, 1000),
              totalLength: cleanStdout.length
            });
            // Also add to job logs for visibility
            jobMonitor.addJobLog(jobId, `📋 Error sample from stdout: ${stdoutSample.substring(0, 1000)}`, 'error');
          }
          
          // If extractedError has useful info, add it to job logs
          if (extractedError && extractedError.length > 50 && jobId) {
            jobMonitor.addJobLog(jobId, `🔍 Extracted Error: ${extractedError.substring(0, 500)}`, 'error');
          }
          
          // Extract inaccessible Product2 IDs from INSUFFICIENT_ACCESS errors
          const insufficientAccessPattern = /insufficient access rights on cross-reference id: ([a-zA-Z0-9]{15,18})/gi;
          const inaccessibleMatches = [...cleanStdout.matchAll(insufficientAccessPattern)];
          const inaccessibleIds = [...new Set(inaccessibleMatches.map(m => m[1]))];
          
          if (inaccessibleIds.length > 0) {
            logger.warn(`Found ${inaccessibleIds.length} inaccessible Product2 IDs in target org`, {
              inaccessibleIds: inaccessibleIds.slice(0, 10), // Log first 10
              totalInaccessible: inaccessibleIds.length,
              jobId
            });
            if (jobId) {
              jobMonitor.addJobLog(jobId, `⚠️  ${inaccessibleIds.length} Product2 records are inaccessible (sharing/permissions issue)`, 'warn');
              jobMonitor.addJobLog(jobId, `   Sample inaccessible Product2 IDs: ${inaccessibleIds.slice(0, 5).join(', ')}`, 'warn');
              if (inaccessibleIds.length > 5) {
                jobMonitor.addJobLog(jobId, `   Grant access to these Product2 records in the target org to resolve the errors`, 'warn');
              }
            }
          }
          
          // Remove common warnings that aren't actual errors
          const warningsToRemove = [
            'Warning: Could not find typescript',
            'Error Plugin:',
            'could not find package.json',
            'See more details with DEBUG',
            'module: @oclif/core',
            'plugin: @salesforce/cli'
          ];
          
          let cleanedError = finalError;
          warningsToRemove.forEach(warning => {
            // Remove lines containing these warnings
            cleanedError = cleanedError.split('\n')
              .filter(line => !line.toLowerCase().includes(warning.toLowerCase()))
              .join('\n');
          });
          
          // If we removed all content, use original error
          if (!cleanedError.trim()) {
            cleanedError = finalError || errorMessage;
          }
          
          // Limit error message length but include key details
          const maxErrorLength = 1000;
          let errorMsg = cleanedError.trim();
          if (errorMsg.length > maxErrorLength) {
            errorMsg = errorMsg.substring(0, maxErrorLength) + '... (truncated)';
          }
          
          const error = new Error(`SF CLI command failed with code ${code}: ${errorMsg}`);
          // Attach stdout and stderr to error for error recovery
          error.stdout = cleanStdout;
          error.stderr = cleanStderr;
          error.exitCode = code;
          
          logger.error(`SF CLI command failed: ${error.message}`, {
            exitCode: code,
            stderrLength: stderr?.length || 0,
            stdoutLength: stdout?.length || 0,
            errorDetails: errorDetails || 'none',
            hasErrorDetails: !!errorDetails
          });
          
          if (jobId) {
            logger.logError(error, { jobId, operation: 'SF CLI command', exitCode: code });
            // Log the error details
            if (errorDetails) {
              jobMonitor.addJobLog(jobId, `❌ Error Details: ${errorDetails}`, 'error');
            }
            jobMonitor.addJobLog(jobId, `❌ SF CLI Error: ${errorMsg}`, 'error');
            // Also log a portion of stdout for debugging if it's large
            if (cleanStdout.length > 0 && cleanStdout.length < 5000) {
              jobMonitor.addJobLog(jobId, `📋 Output: ${cleanStdout.substring(0, 1000)}`, 'debug');
            }
          }
          reject(error);
        }
      });

      child.on('error', (error) => {
        logger.error(`SF CLI spawn error: ${error.message}`);
        if (jobId) {
          logger.logError(error, { jobId, operation: 'SF CLI spawn' });
        }
        reject(error);
      });

      // Set timeout
      const timeout = setTimeout(() => {
        child.kill();
        const error = new Error(`SF CLI command timed out after ${this.timeout}ms`);
        logger.error(error.message);
        if (jobId) {
          logger.logError(error, { jobId, operation: 'SF CLI timeout' });
        }
        reject(error);
      }, this.timeout);

      child.on('close', () => {
        clearTimeout(timeout);
      });
    });

    if (jobId) {
      return jobExecutionService.enqueueExecution({
        jobId,
        label: 'sf-cli',
        execute: runCommand,
      });
    }

    return runCommand();
  }

  /**
   * Helper to execute command with shell for version check
   */
  async executeCommandWithShell(commandArgs) {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === 'win32';
      const child = spawn(commandArgs[0], commandArgs.slice(1), {
        shell: isWindows,
        windowsHide: true,
        timeout: 5000
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
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Command failed with code ${code}`));
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Export custom objects using SF CLI
   * @param {Object} config - Export configuration
   * @param {string} config.username - Salesforce username
   * @param {string} config.projectPath - Project path for export
   * @param {Array} config.queries - Array of SOQL queries
   * @param {string} config.jobId - Job ID (optional)
   * @returns {Promise<Object>} Export result
   */
  async exportCustomObjects(config) {
    const { username, projectPath = './export', queries = [], jobId } = config;

    if (!username) {
      throw new ValidationError('Salesforce username is required');
    }

    if (!queries || queries.length === 0) {
      throw new ValidationError('At least one query is required');
    }

    // Ensure project path exists
    const absProjectPath = path.resolve(projectPath);
    await fs.ensureDir(absProjectPath);

    const results = [];
    const errors = [];

    // Performance optimization: Execute queries in parallel with concurrency limit
    // This significantly improves performance when exporting multiple objects
    const maxConcurrency = parseInt(process.env.SF_CLI_MAX_CONCURRENT_QUERIES) || 5;
    
    // Helper function to execute a single query
    const executeQuery = async (queryConfig, index, total) => {
      try {
        if (jobId) {
          jobMonitor.addJobLog(jobId, `🔄 Processing query ${index + 1}/${total}: ${queryConfig.object || queryConfig.name || 'Unknown'}`, 'info');
        }
        
        // Extract SOQL query
        let soqlQuery = queryConfig.query || queryConfig.soql_query;
        if (!soqlQuery) {
          throw new Error('Query or soql_query is required for each query config');
        }
        
        // Auto-fix: Replace Product__r.GT_GlobalKey__c with Product__r.vlocity_cmt__GlobalKey__c
        // Product2 uses Vlocity GlobalKey field, not GT custom field
        if (soqlQuery.includes('Product__r.GT_GlobalKey__c')) {
          soqlQuery = soqlQuery.replace(/Product__r\.GT_GlobalKey__c/g, 'Product__r.vlocity_cmt__GlobalKey__c');
          logger.info('Auto-fixed Product2 GlobalKey field in SOQL query', {
            original: queryConfig.query || queryConfig.soql_query,
            fixed: soqlQuery,
            object: queryConfig.object
          });
        }

        // Handle query placeholders
        if (queryConfig.object) {
          // For custom objects, check if query includes relationship fields
          // If it does, use data query instead of data tree export to preserve relationship queries
          const objectName = queryConfig.object;
          const hasRelationshipQuery = soqlQuery.includes('__r.') || soqlQuery.match(/[\w]+__r\./);
          
          if (hasRelationshipQuery) {
            // Use data query for queries with relationship fields (preserves relationship query results)
            const outputFile = path.join(absProjectPath, `${objectName}.json`);
            const trimmedQuery = soqlQuery.trim();
            
            const exportArgs = [
              'data', 'query',
              '--query', trimmedQuery,
              '--target-org', username,
              '--result-format', 'json'
            ];
            
            if (jobId) {
              logger.logJobVerbose(jobId, `Exporting ${objectName} using data query (relationship query detected)`, {
                query: soqlQuery,
                outputFile,
                objectName
              });
            }
            
            const output = await this.executeCommand(exportArgs, {
              username,
              jobId,
              cwd: absProjectPath
            });
            
            // Parse the JSON output and save to file
            try {
              // Strip ANSI codes from output
              let cleanOutput = output.replace(/\u001b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*m/g, '');
              
              // Extract JSON from output (might have warnings before JSON)
              const jsonStart = cleanOutput.search(/[\{\[]/);
              if (jsonStart > 0) {
                cleanOutput = cleanOutput.substring(jsonStart);
              }
              
              const lastBrace = cleanOutput.lastIndexOf('}');
              const lastBracket = cleanOutput.lastIndexOf(']');
              const jsonEnd = Math.max(lastBrace, lastBracket);
              if (jsonEnd >= 0 && jsonEnd < cleanOutput.length - 1) {
                cleanOutput = cleanOutput.substring(0, jsonEnd + 1);
              }
              
              const queryResult = JSON.parse(cleanOutput);
              
              // Transform to data tree format if needed, or save as-is
              // The result format from data query is: { status: 0, result: { records: [...] } }
              let records = [];
              if (queryResult.result && queryResult.result.records) {
                records = queryResult.result.records;
              } else if (Array.isArray(queryResult)) {
                records = queryResult;
              } else if (queryResult.records) {
                records = queryResult.records;
              }
              
              // Save in data tree format for consistency
              const exportData = {
                records: records
              };
              
              await fs.writeJson(outputFile, exportData, { spaces: 2 });
              
              const fileStats = await fs.stat(outputFile);
              const fileSize = fileStats.size;
              
              if (jobId) {
                jobMonitor.addJobLog(jobId, `✅ Exported ${records.length} ${objectName} records to ${outputFile}`, 'info');
                jobMonitor.updateJobProgress(jobId, undefined, `Exported ${objectName}: ${records.length} records`);
              }
              
              return {
                query: soqlQuery,
                object: objectName,
                file: outputFile,
                status: 'success',
                recordCount: records.length,
                fileSize: fileSize
              };
            } catch (parseError) {
              throw new Error(`Failed to parse query result for ${objectName}: ${parseError.message}`);
            }
          } else {
            // Use data tree export for queries without relationship fields (preserves hierarchical structure)
            const outputFile = path.join(absProjectPath, `${objectName}.json`);
            
            // Export using SF CLI data tree export (preserves relationships)
            // Note: sf data tree export uses --output-dir (directory) not --output-file
            // The command exports to a directory and creates JSON files there
            const outputDir = absProjectPath; // Export to the project path directory
            
            // On Windows, SOQL queries with commas can be parsed incorrectly by the shell
            // Pass the query directly without manual quoting - spawn will handle it
            // The executeCommand method already handles quoting for arguments with spaces
            const trimmedQuery = soqlQuery.trim();
            
            // Build command arguments
            // Note: Don't manually quote the query - let spawn handle it properly
            const exportArgs = [
              'data', 'tree', 'export',
              '--query', trimmedQuery,
              '--target-org', username,
              '--output-dir', outputDir
            ];
            
            if (jobId) {
              logger.logJobVerbose(jobId, `Exporting ${objectName} using data tree export`, {
                query: soqlQuery,
                outputDir,
                objectName
              });
            }

            const output = await this.executeCommand(exportArgs, {
              username,
              jobId,
              cwd: absProjectPath
            });
          
            // sf data tree export creates files in the output directory
            // The file naming convention is typically based on the object type
            // Check for common file patterns: {objectName}.json or {objectName}-{timestamp}.json
            let exportedFile = null;
            let fileSize = 0;
          
          // Try to find the exported file
          const possibleFiles = [
            path.join(outputDir, `${objectName}.json`),
            path.join(outputDir, `${objectName.toLowerCase()}.json`),
            path.join(outputDir, 'data.json'), // Default name from data tree export
          ];
          
          // Also check for files created with timestamp
          try {
            const files = await fs.readdir(outputDir);
            const matchingFiles = files.filter(f => 
              f.toLowerCase().includes(objectName.toLowerCase()) && f.endsWith('.json')
            );
            
            if (matchingFiles.length > 0) {
              exportedFile = path.join(outputDir, matchingFiles[0]);
            }
          } catch (dirError) {
            // Directory might not exist yet
          }

          // Try the possible files in order
          for (const possibleFile of possibleFiles) {
            if (await fs.pathExists(possibleFile)) {
              exportedFile = possibleFile;
              const stats = await fs.stat(possibleFile);
              fileSize = stats.size;
              break;
            }
          }

          if (!exportedFile) {
            logger.warn(`Could not locate exported file for ${objectName} in ${outputDir}. Command output: ${output}`);
          }

          if (jobId) {
            if (exportedFile) {
              jobMonitor.addJobLog(jobId, `✅ Exported ${objectName} successfully to ${exportedFile} (${(fileSize / 1024).toFixed(2)} KB)`, 'info');
            } else {
              jobMonitor.addJobLog(jobId, `✅ Exported ${objectName} successfully to ${outputDir}`, 'info');
            }
            jobMonitor.updateJobProgress(jobId, undefined, `Exported ${objectName} successfully`);
          }
          
          logger.info(`SF CLI export completed: ${objectName}`, {
            outputFile: exportedFile,
            outputDir,
            fileSize,
            username
          });
          
          return {
            object: objectName,
            query: soqlQuery,
            outputFile: exportedFile || outputDir,
            outputDir,
            fileSize,
            externalKey: queryConfig.external_key,
            targetObject: queryConfig.target_object,
            status: 'success',
            output: output.trim()
          };
          }
        } else {
          // For standard SOQL queries without object name, use data query
          // Note: sf data query outputs to stdout, not to a file
          // We'll capture the output and save it to a file manually
          const outputDir = path.join(absProjectPath, 'query_results');
          await fs.ensureDir(outputDir);

          const exportArgs = [
            'data', 'query',
            '--query', soqlQuery,
            '--target-org', username,
            '--result-format', 'json'
          ];

          const output = await this.executeCommand(exportArgs, {
            username,
            jobId,
            cwd: absProjectPath
          });

          // Save output to a file manually
          // Generate a safe filename from the query (use object name if available)
          const objectMatch = soqlQuery.match(/FROM\s+([A-Za-z0-9_]+)/i);
          const objectName = objectMatch ? objectMatch[1] : 'query';
          const outputFile = path.join(outputDir, `${objectName}.json`);
          
          // Parse and save the JSON output
          try {
            const jsonOutput = JSON.parse(output.trim());
            await fs.writeFile(outputFile, JSON.stringify(jsonOutput, null, 2), 'utf8');
          } catch (parseError) {
            // If parsing fails, save raw output
            logger.warn('Failed to parse query output as JSON, saving raw output', {
              query: soqlQuery,
              error: parseError.message
            });
            await fs.writeFile(outputFile, output.trim(), 'utf8');
          }

          return {
            query: soqlQuery,
            outputFile,
            status: 'success',
            output: output.trim()
          };
        }
      } catch (error) {
        const errorMsg = `Failed to export query: ${error.message}`;
        logger.error(errorMsg);
        
        if (jobId) {
          logger.logError(error, { jobId, operation: 'SF CLI export', query: queryConfig.query || queryConfig.soql_query });
          jobMonitor.addJobLog(jobId, `❌ Failed to export: ${error.message}`, 'error');
        }
        
        throw error; // Re-throw to be caught by parallel execution wrapper
      }
    };

    // Execute queries in parallel with concurrency limit
    const totalQueries = queries.length;
    if (jobId) {
      jobMonitor.addJobLog(jobId, `🚀 Starting parallel export of ${totalQueries} queries (max ${maxConcurrency} concurrent)`, 'info');
    }
    
    // Execute with concurrency control using p-limit pattern
    const executeWithLimit = async (items, limit, fn) => {
      const executing = [];
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const promise = (async () => {
          try {
            return await fn(item, i);
          } catch (error) {
            return { error };
          }
        })();
        
        // Add cleanup to remove from executing when done
        const promiseWithCleanup = promise.finally(() => {
          const index = executing.indexOf(promiseWithCleanup);
          if (index >= 0) {
            executing.splice(index, 1);
          }
        });
        
        executing.push(promiseWithCleanup);
        
        // When we reach the limit, wait for one to complete
        if (executing.length >= limit) {
          await Promise.race(executing);
        }
      }
      
      // Wait for all remaining to complete
      await Promise.allSettled(executing);
    };
    
    const queryResults = await executeWithLimit(queries, maxConcurrency, async (queryConfig, index) => {
      try {
        const result = await executeQuery(queryConfig, index, totalQueries);
        if (result) {
          results.push(result);
        }
        return result;
      } catch (error) {
        const errorInfo = {
          query: queryConfig.query || queryConfig.soql_query || 'unknown',
          error: error.message
        };
        errors.push(errorInfo);
        logger.error(`Query ${index + 1}/${totalQueries} failed: ${error.message}`);
        throw error;
      }
    });
    
    if (jobId) {
      jobMonitor.addJobLog(jobId, `✅ Completed export: ${results.length} successful, ${errors.length} failed`, 'info');
    }

    return {
      success: errors.length === 0,
      results,
      errors,
      projectPath: absProjectPath,
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Extract failed Reference IDs from SF CLI error output
   * Parses the error table format to extract Reference IDs that failed
   * @param {string} errorOutput - Error output from SF CLI command
   * @returns {Array<string>} Array of failed Reference IDs
   */
  extractFailedReferenceIds(errorOutput) {
    const failedIds = [];
    
    if (!errorOutput) return failedIds;
    
    // Strip ANSI codes
    const cleanOutput = errorOutput.replace(/\u001b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*m/g, '');
    
    // Pattern to match the error table format:
    // │ GT_RateTable__cRef407 │ ENTITY_IS_DELETED │ ...
    // │ GT_RateTable__cRef454 │ INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY │ ...
    const tableRowPattern = /\│\s*([A-Za-z0-9_]+Ref\d+)\s*│/g;
    const matches = [...cleanOutput.matchAll(tableRowPattern)];
    
    for (const match of matches) {
      if (match[1] && !failedIds.includes(match[1])) {
        failedIds.push(match[1]);
      }
    }
    
    // Also try to extract from JSON error format if present
    try {
      const jsonMatch = cleanOutput.match(/\{[\s\S]*"result"[\s\S]*\}/);
      if (jsonMatch) {
        const errorJson = JSON.parse(jsonMatch[0]);
        if (errorJson.result && errorJson.result.errors) {
          for (const err of errorJson.result.errors) {
            if (err.referenceId && !failedIds.includes(err.referenceId)) {
              failedIds.push(err.referenceId);
            }
          }
        }
      }
    } catch (e) {
      // Not JSON, continue
    }
    
    return failedIds;
  }

  /**
   * Filter records from a JSON file by removing records with failed Reference IDs
   * @param {string} jsonFilePath - Path to JSON file
   * @param {Array<string>} failedReferenceIds - Array of Reference IDs to remove
   * @param {string} jobId - Optional job ID for logging
   * @returns {Promise<string>} Path to filtered JSON file
   */
  async filterRecordsByReferenceIds(jsonFilePath, failedReferenceIds, jobId) {
    try {
      const data = await fs.readJson(jsonFilePath);
      const records = Array.isArray(data) ? data : (data.records || []);
      
      if (records.length === 0) {
        return null;
      }
      
      // Filter out records with failed Reference IDs
      const filteredRecords = records.filter(record => {
        // Check if record has attributes.referenceId
        const referenceId = record.attributes?.referenceId || record.referenceId;
        if (!referenceId) return true; // Keep records without referenceId
        
        // Remove if referenceId is in the failed list
        return !failedReferenceIds.includes(referenceId);
      });
      
      if (filteredRecords.length === records.length) {
        // No records were filtered, return null
        return null;
      }
      
      // Create filtered data structure
      const filteredData = Array.isArray(data) ? filteredRecords : { ...data, records: filteredRecords };
      
      // Write to a new filtered file
      const filteredFilePath = jsonFilePath.replace('.json', '_filtered.json');
      await fs.writeJson(filteredFilePath, filteredData, { spaces: 2 });
      
      if (jobId) {
        jobMonitor.addJobLog(jobId, `🔧 Filtered ${records.length - filteredRecords.length} failed records from ${path.basename(jsonFilePath)}`, 'info');
      }
      
      logger.info(`Filtered ${records.length - filteredRecords.length} failed records from ${jsonFilePath}`, {
        originalCount: records.length,
        filteredCount: filteredRecords.length,
        removedCount: records.length - filteredRecords.length,
        failedReferenceIds: failedReferenceIds.length
      });
      
      return filteredFilePath;
    } catch (error) {
      logger.error(`Failed to filter records from ${jsonFilePath}: ${error.message}`, {
        error: error.stack,
        failedReferenceIds
      });
      return null;
    }
  }

  /**
   * Deploy custom objects using SF CLI
   * @param {Object} config - Deploy configuration
   * @param {string} config.targetUsername - Target Salesforce username
   * @param {string} config.sourcePath - Source path containing exported data
   * @param {string} config.jobId - Job ID (optional)
   * @returns {Promise<Object>} Deploy result
   */
  async deployCustomObjects(config) {
    const { targetUsername, sourcePath, jobId, sourceUsername } = config;

    if (!targetUsername) {
      throw new ValidationError('Target Salesforce username is required');
    }

    if (!sourcePath || !await fs.pathExists(sourcePath)) {
      throw new ValidationError('Source path does not exist');
    }

    try {
      // Find all JSON files in the source path (from data tree export)
      const jsonFiles = [];
      const files = await fs.readdir(sourcePath);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(sourcePath, file);
          jsonFiles.push(filePath);
        }
      }
      
      if (jsonFiles.length === 0) {
        throw new ValidationError(`No JSON files found in ${sourcePath} for deployment`);
      }

      // Sort files to ensure dependencies are deployed first
      // GT_RateCode__c must be deployed before GT_RateTable__c (which has a required lookup to GT_RateCode__c)
      jsonFiles.sort((a, b) => {
        const aName = path.basename(a, '.json');
        const bName = path.basename(b, '.json');
        
        // Deploy GT_RateCode__c before GT_RateTable__c
        if (aName === 'GT_RateCode__c' && bName === 'GT_RateTable__c') return -1;
        if (aName === 'GT_RateTable__c' && bName === 'GT_RateCode__c') return 1;
        
        // Deploy GT_ProductSKU__c after GT_RateCode__c (if there are dependencies)
        // Otherwise, maintain alphabetical order
        return aName.localeCompare(bName);
      });

      const results = [];
      const errors = [];
      
      // Track all inaccessible Product2 IDs across all batches for summary
      const allInaccessibleProduct2Ids = new Set();

      // Deploy each JSON file using data tree import
      // Update references incrementally after deploying dependencies
      const referenceUpdater = require('./sfCliReferenceUpdater');
      
      for (const jsonFile of jsonFiles) {
        try {
          // Skip already-cleaned files (ending with _cleaned.json)
          if (jsonFile.includes('_cleaned.json')) {
            if (jobId) {
              jobMonitor.addJobLog(jobId, `⏭️  Skipping already-cleaned file: ${path.basename(jsonFile)}`, 'info');
            }
            continue;
          }
          
          const objectName = path.basename(jsonFile, '.json');
          
          // Update references for objects that depend on previously deployed objects
          // GT_RateTable__c depends on GT_RateCode__c, so update references after GT_RateCode__c is deployed
          if (objectName === 'GT_RateTable__c') {
            try {
              if (jobId) {
                jobMonitor.addJobLog(jobId, `🔄 Updating references for ${objectName} after dependency deployment`, 'info');
              }
              const updateResult = await referenceUpdater.updateRateTableReferences(sourcePath, targetUsername, jobId);
              if (jobId) {
                jobMonitor.addJobLog(jobId, `✅ References updated for ${objectName}: ${updateResult.totalUpdates || 0} records updated`, 'info');
                if (updateResult.totalUpdates === 0) {
                  jobMonitor.addJobLog(jobId, `⚠️  Warning: No references were updated. GT_RateCode__c may not exist in target org or external keys don't match.`, 'warn');
                }
              }
              logger.info(`Updated ${updateResult.totalUpdates || 0} references for ${objectName}`, {
                totalUpdates: updateResult.totalUpdates,
                recordsProcessed: updateResult.recordsProcessed
              });
            } catch (refError) {
              logger.warn(`Failed to update references for ${objectName}, continuing: ${refError.message}`);
              if (jobId) {
                jobMonitor.addJobLog(jobId, `⚠️  Warning: Could not update references for ${objectName}: ${refError.message}`, 'warn');
              }
            }
            
            // Remove any existing cleaned file to force regeneration after reference update
            const cleanedFilePath = path.join(path.dirname(jsonFile), `${objectName}_cleaned.json`);
            if (await fs.pathExists(cleanedFilePath)) {
              await fs.remove(cleanedFilePath);
              if (jobId) {
                jobMonitor.addJobLog(jobId, `🗑️  Removed existing cleaned file to force regeneration after reference update`, 'debug');
              }
            }
          }
          
          if (jobId) {
            logger.logJobVerbose(jobId, `Deploying ${objectName}`, {
              targetUsername,
              jsonFile
            });
          }

          // Clean the JSON file before import:
          // 1. Remove relationship fields (ending with __r) - sf data tree import doesn't accept them
          // 2. Remove read-only fields like Name (for auto-number fields)
          // 3. Keep only the foreign key field (e.g., Product__c instead of Product__r)
          const cleanedJsonFile = await this.cleanJsonForImport(jsonFile, objectName, jobId);

          // SF CLI data tree import has a limit of 200 records per request
          // Split large files into batches of 200 records
          const batchSize = 200;
          const cleanedData = await fs.readJson(cleanedJsonFile);
          let records = cleanedData.records || [];
          
          // For Catalog Product Relationships, filter out duplicates that already exist in target org
          // NOTE: This happens AFTER reference updates, so the IDs in records should be target org IDs
          if (objectName === 'vlocity_cmt__CatalogProductRelationship__c' && records.length > 0) {
            try {
              if (jobId) {
                jobMonitor.addJobLog(jobId, `🔍 Checking for existing Catalog Product Relationships in target org...`, 'info');
              }
              
              // Check if source and target are the same (would cause all records to be duplicates)
              // This is a safety check - the route validation should catch this, but we check here too
              if (sourceUsername && sourceUsername === targetUsername) {
                const errorMsg = `⚠️  WARNING: Source and target orgs are the same (${targetUsername}). All Catalog Product Relationships already exist. Skipping deployment.`;
                if (jobId) {
                  jobMonitor.addJobLog(jobId, errorMsg, 'error');
                }
                logger.error(errorMsg);
                // Skip this object entirely - all records would be duplicates
                records = [];
                cleanedData.records = [];
                await fs.writeJson(cleanedJsonFile, cleanedData, { spaces: 2 });
                if (jobId) {
                  jobMonitor.addJobLog(jobId, `⏭️  Skipped Catalog Product Relationships deployment (source = target org)`, 'warn');
                }
                // Skip to next file by breaking out of this object's processing
                // The records array is now empty, so the deployment will skip with 0 records
              }
              
              // Query existing relationships in target org
              const existingRelationshipsQuery = `
                SELECT Id, vlocity_cmt__CatalogId__c, vlocity_cmt__Product2Id__c
                FROM vlocity_cmt__CatalogProductRelationship__c
                WHERE vlocity_cmt__CatalogId__c != null AND vlocity_cmt__Product2Id__c != null
              `;
              
              const salesforceService = require('./salesforceService');
              await salesforceService.authenticateWithSfdx(targetUsername);
              const existingRelationships = await salesforceService.query(existingRelationshipsQuery);
              
              // Create a Set of existing relationship keys (CatalogId + Product2Id)
              const existingKeys = new Set();
              if (existingRelationships.records) {
                existingRelationships.records.forEach(rel => {
                  if (rel.vlocity_cmt__CatalogId__c && rel.vlocity_cmt__Product2Id__c) {
                    const key = `${rel.vlocity_cmt__CatalogId__c}_${rel.vlocity_cmt__Product2Id__c}`;
                    existingKeys.add(key);
                  }
                });
              }
              
              // Filter out records that already exist
              // IMPORTANT: The IDs in records should be target org IDs after reference updates
              // If reference updates failed, these will still be source org IDs and won't match
              const originalCount = records.length;
              
              // Debug: Log sample IDs to verify they're target org IDs
              const sampleRecords = records.slice(0, 3).filter(r => r.vlocity_cmt__CatalogId__c && r.vlocity_cmt__Product2Id__c);
              if (sampleRecords.length > 0 && jobId) {
                const sample = sampleRecords[0];
                jobMonitor.addJobLog(jobId, `🔍 Sample record IDs - CatalogId: ${sample.vlocity_cmt__CatalogId__c?.substring(0, 15)}..., Product2Id: ${sample.vlocity_cmt__Product2Id__c?.substring(0, 15)}...`, 'debug');
              }
              
              if (jobId) {
                jobMonitor.addJobLog(jobId, `📊 Target org has ${existingRelationships.records?.length || 0} existing Catalog Product Relationships`, 'info');
              }
              
              records = records.filter(record => {
                if (record.vlocity_cmt__CatalogId__c && record.vlocity_cmt__Product2Id__c) {
                  const key = `${record.vlocity_cmt__CatalogId__c}_${record.vlocity_cmt__Product2Id__c}`;
                  const isDuplicate = existingKeys.has(key);
                  return !isDuplicate;
                }
                // Keep records with missing Catalog or Product (will fail validation, but let SF handle it)
                return true;
              });
              
              const filteredCount = originalCount - records.length;
              if (filteredCount > 0) {
                if (jobId) {
                  jobMonitor.addJobLog(jobId, `✅ Filtered out ${filteredCount} duplicate Catalog Product Relationships (${records.length} new records to deploy)`, 'info');
                }
                logger.info(`Filtered ${filteredCount} duplicate Catalog Product Relationships`, {
                  originalCount,
                  filteredCount,
                  remainingCount: records.length,
                  existingInTarget: existingRelationships.records?.length || 0
                });
              } else {
                if (jobId) {
                  jobMonitor.addJobLog(jobId, `✅ No duplicates found - all ${records.length} records are new`, 'info');
                }
              }
              
              // If all records were filtered but target only has fewer records, there might be an issue
              if (filteredCount === originalCount && existingRelationships.records && existingRelationships.records.length < originalCount) {
                const warningMsg = `⚠️  WARNING: All ${originalCount} records were filtered as duplicates, but target org only has ${existingRelationships.records.length} relationships. This suggests reference updates may have failed or IDs weren't updated correctly.`;
                if (jobId) {
                  jobMonitor.addJobLog(jobId, warningMsg, 'warn');
                }
                logger.warn(warningMsg);
              }
              
              // Update cleaned data with filtered records
              cleanedData.records = records;
              await fs.writeJson(cleanedJsonFile, cleanedData, { spaces: 2 });
            } catch (filterError) {
              logger.warn(`Failed to filter duplicate Catalog Product Relationships, continuing with all records: ${filterError.message}`);
              if (jobId) {
                jobMonitor.addJobLog(jobId, `⚠️  Warning: Could not filter duplicates: ${filterError.message}. Deploying all records.`, 'warn');
              }
            }
          }
          
          // Skip deployment if no records remain after filtering
          if (records.length === 0) {
            if (jobId) {
              jobMonitor.addJobLog(jobId, `⏭️  Skipping ${objectName} deployment - no records to deploy (all filtered out or already exist)`, 'info');
            }
            logger.info(`Skipping ${objectName} deployment - no records to deploy`, {
              objectName,
              sourcePath
            });
            results.push({
              objectName,
              status: 'skipped',
              message: 'No records to deploy (all filtered out or already exist)',
              recordsProcessed: 0,
              recordsDeployed: 0
            });
            continue; // Skip to next file
          }
          
          // Validate required fields for GT_RateTable__c
          if (objectName === 'GT_RateTable__c' && records.length > 0) {
            const missingRateCode = records.filter(r => !r.GT_RateCode__c);
            if (missingRateCode.length > 0) {
              const errorMsg = `⚠️  ${missingRateCode.length} GT_RateTable__c records are missing required field GT_RateCode__c. Reference update may have failed.`;
              logger.warn(errorMsg, {
                objectName,
                missingCount: missingRateCode.length,
                totalRecords: records.length
              });
              if (jobId) {
                jobMonitor.addJobLog(jobId, errorMsg, 'error');
              }
              // Don't fail the deployment, but log the issue
              // The deployment will fail with a more specific error from SF CLI
            } else {
              if (jobId) {
                jobMonitor.addJobLog(jobId, `✅ Verified: All ${records.length} GT_RateTable__c records have GT_RateCode__c field`, 'info');
              }
            }
          }
          
          if (records.length > batchSize) {
            if (jobId) {
              jobMonitor.addJobLog(jobId, `📦 Splitting ${objectName} into batches of ${batchSize} records (total: ${records.length})`, 'info');
            }
            
            const totalBatches = Math.ceil(records.length / batchSize);
            let successCount = 0;
            let errorCount = 0;
            
            // Performance optimization: Process batches in parallel with concurrency limit
            const maxConcurrentBatches = parseInt(process.env.SF_CLI_MAX_CONCURRENT_BATCHES) || 3;
            if (jobId) {
              jobMonitor.addJobLog(jobId, `⚡ Processing ${totalBatches} batches in parallel (max ${maxConcurrentBatches} concurrent)`, 'info');
            }
            
            const batchPromises = [];
            const executingBatches = [];
            
            for (let i = 0; i < totalBatches; i++) {
              const start = i * batchSize;
              const end = Math.min(start + batchSize, records.length);
              const batch = records.slice(start, end);
              
              // Ensure each record in batch has referenceId in attributes (required by sf data tree import)
              const batchWithRefIds = batch.map((record, batchIndex) => {
                const recordWithRef = { ...record };
                
                // Ensure attributes object exists
                if (!recordWithRef.attributes) {
                  recordWithRef.attributes = {};
                }
                
                // Ensure referenceId exists (use existing or generate new one)
                if (!recordWithRef.attributes.referenceId) {
                  recordWithRef.attributes.referenceId = `${objectName}Ref${start + batchIndex + 1}`;
                }
                
                // Ensure type is set
                if (!recordWithRef.attributes.type) {
                  recordWithRef.attributes.type = objectName;
                }
                
                return recordWithRef;
              });
              
              const batchData = {
                records: batchWithRefIds
              };
              
              const batchFileName = `${objectName}_batch_${i + 1}_of_${totalBatches}.json`;
              const batchFilePath = path.join(sourcePath, batchFileName);
              await fs.writeJson(batchFilePath, batchData, { spaces: 2 });
              
              // Create batch deployment promise
              const batchNum = i + 1;
              const batchPromise = (async () => {
                if (jobId) {
                  jobMonitor.addJobLog(jobId, `📤 Deploying batch ${batchNum}/${totalBatches} (records ${start + 1}-${end})`, 'info');
                }
                
                try {
                  const deployArgs = [
                    'data', 'tree', 'import',
                    '--files', batchFilePath,
                    '--target-org', targetUsername
                  ];

                  if (jobId) {
                    jobMonitor.addJobLog(jobId, `📤 Starting import for batch ${batchNum}/${totalBatches}...`, 'info');
                  }

                  const output = await this.executeCommand(deployArgs, {
                    username: targetUsername,
                    jobId,
                    cwd: sourcePath
                  });
                  
                  if (jobId && output) {
                    // Log the full output if available
                    const outputLines = output.split('\n').filter(l => l.trim());
                    if (outputLines.length > 0) {
                      jobMonitor.addJobLog(jobId, `📋 Import output (${outputLines.length} lines):`, 'debug');
                      outputLines.slice(0, 20).forEach(line => { // Log first 20 lines
                        const cleanLine = line.replace(/\u001b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*m/g, '');
                        if (cleanLine.trim()) {
                          jobMonitor.addJobLog(jobId, `   ${cleanLine}`, 'info');
                        }
                      });
                      if (outputLines.length > 20) {
                        jobMonitor.addJobLog(jobId, `   ... (${outputLines.length - 20} more lines)`, 'debug');
                      }
                    }
                  }
                  
                  successCount++;
                  
                  if (jobId) {
                    jobMonitor.addJobLog(jobId, `✅ Batch ${batchNum}/${totalBatches} deployed successfully`, 'info');
                  }
                  
                  // Clean up batch file after successful import
                  await fs.remove(batchFilePath);
                  return { success: true, batchNum };
                } catch (batchError) {
                  errorCount++;
                  
                  // Try to extract failed Reference IDs from error output
                  // Combine stdout and stderr for error parsing
                  const errorOutput = (batchError.stdout || '') + '\n' + (batchError.stderr || '') + '\n' + (batchError.message || '');
                  const failedReferenceIds = this.extractFailedReferenceIds(errorOutput);
                  
                  if (failedReferenceIds.length > 0 && batchFilePath) {
                    // Try to recover by removing failed records and retrying
                    try {
                      if (jobId) {
                        jobMonitor.addJobLog(jobId, `🔄 Attempting recovery: Removing ${failedReferenceIds.length} failed records from batch ${batchNum}`, 'info');
                      }
                      
                      const filteredBatchPath = await this.filterRecordsByReferenceIds(batchFilePath, failedReferenceIds, jobId);
                      
                      if (filteredBatchPath && await fs.pathExists(filteredBatchPath)) {
                        const filteredData = await fs.readJson(filteredBatchPath);
                        const originalData = await fs.readJson(batchFilePath);
                        
                        if (filteredData.length > 0 && filteredData.length < originalData.length) {
                          // Retry with filtered batch
                          if (jobId) {
                            jobMonitor.addJobLog(jobId, `🔄 Retrying batch ${batchNum} with ${filteredData.length} records (removed ${originalData.length - filteredData.length} failed records)`, 'info');
                          }
                          
                          const retryOutput = await this.executeCommand([
                            'data', 'tree', 'import',
                            '--files', filteredBatchPath,
                            '--target-org', targetUsername
                          ], {
                            username: targetUsername,
                            jobId,
                            cwd: sourcePath
                          });
                          
                          successCount++;
                          if (jobId) {
                            jobMonitor.addJobLog(jobId, `✅ Batch ${batchNum}/${totalBatches} recovered and deployed successfully (${filteredData.length} records)`, 'info');
                          }
                          
                          // Clean up both files
                          await fs.remove(batchFilePath);
                          await fs.remove(filteredBatchPath);
                          return { success: true, batchNum, recovered: true };
                        } else {
                          // All records were filtered out or no change
                          await fs.remove(filteredBatchPath);
                          if (jobId) {
                            jobMonitor.addJobLog(jobId, `⚠️  All records in batch ${batchNum} failed - skipping batch`, 'warn');
                          }
                        }
                      }
                    } catch (recoveryError) {
                      if (jobId) {
                        jobMonitor.addJobLog(jobId, `⚠️  Recovery failed for batch ${batchNum}: ${recoveryError.message}`, 'warn');
                      }
                    }
                  }
                  
                  // Check if this is an access error - extract Product2 IDs
                  const errorMessage = batchError.message || '';
                  const insufficientAccessPattern = /insufficient access rights on cross-reference id: ([a-zA-Z0-9]{15,18})/gi;
                  const inaccessibleMatches = [...errorMessage.matchAll(insufficientAccessPattern)];
                  const inaccessibleIds = [...new Set(inaccessibleMatches.map(m => m[1]))];
                  
                  if (inaccessibleIds.length > 0) {
                    // Add to global set for final summary
                    inaccessibleIds.forEach(id => allInaccessibleProduct2Ids.add(id));
                    
                    if (jobId) {
                      jobMonitor.addJobLog(jobId, `⚠️  Batch ${batchNum}/${totalBatches} has ${inaccessibleIds.length} records with inaccessible Product2 references`, 'warn');
                      jobMonitor.addJobLog(jobId, `   Inaccessible Product2 IDs: ${inaccessibleIds.slice(0, 10).join(', ')}${inaccessibleIds.length > 10 ? '...' : ''}`, 'warn');
                      jobMonitor.addJobLog(jobId, `   Grant access to these Product2 records in the target org`, 'warn');
                    }
                    logger.warn(`Batch ${batchNum} has inaccessible Product2 references`, {
                      batchNumber: batchNum,
                      totalBatches,
                      inaccessibleIds: inaccessibleIds,
                      objectName
                    });
                  } else {
                    if (jobId) {
                      jobMonitor.addJobLog(jobId, `❌ Batch ${batchNum}/${totalBatches} failed: ${batchError.message.substring(0, 200)}`, 'error');
                    }
                  }
                  // Keep batch file for debugging if it fails
                  return { success: false, batchNum, error: batchError.message };
                }
              })();
              
              // Add cleanup to remove from executing when done
              const batchPromiseWithCleanup = batchPromise.finally(() => {
                const index = executingBatches.indexOf(batchPromiseWithCleanup);
                if (index >= 0) {
                  executingBatches.splice(index, 1);
                }
              });
              
              batchPromises.push(batchPromise);
              executingBatches.push(batchPromiseWithCleanup);
              
              // When we reach max concurrency, wait for one to complete
              if (executingBatches.length >= maxConcurrentBatches) {
                await Promise.race(executingBatches);
              }
            }
            
            // Wait for all batches to complete
            await Promise.allSettled(batchPromises);
            
            if (errorCount === 0) {
              results.push({
                object: objectName,
                file: jsonFile,
                status: 'success',
                output: `Deployed ${successCount} batches successfully`,
                batches: totalBatches
              });
              
              if (jobId) {
                jobMonitor.addJobLog(jobId, `✅ Deployed ${objectName} successfully (${successCount}/${totalBatches} batches)`, 'info');
                jobMonitor.updateJobProgress(jobId, undefined, `Deployed ${objectName} successfully`);
              }
            } else {
              errors.push({
                object: objectName,
                file: jsonFile,
                error: `Failed to deploy ${errorCount}/${totalBatches} batches`,
                batches: { total: totalBatches, successful: successCount, failed: errorCount }
              });
              
              if (jobId) {
                jobMonitor.addJobLog(jobId, `❌ Failed to deploy ${objectName}: ${errorCount}/${totalBatches} batches failed`, 'error');
              }
            }
          } else {
            // Small file, deploy directly
            const deployArgs = [
              'data', 'tree', 'import',
              '--files', cleanedJsonFile,
              '--target-org', targetUsername
            ];

            try {
              const output = await this.executeCommand(deployArgs, {
                username: targetUsername,
                jobId,
                cwd: sourcePath
              });

              results.push({
                object: objectName,
                file: jsonFile,
                status: 'success',
                output: output.trim()
              });

              if (jobId) {
                jobMonitor.addJobLog(jobId, `✅ Deployed ${objectName} successfully`, 'info');
                jobMonitor.updateJobProgress(jobId, undefined, `Deployed ${objectName} successfully`);
              }
            } catch (deployError) {
              // Try to recover by filtering failed records
              const errorOutput = (deployError.stdout || '') + '\n' + (deployError.stderr || '') + '\n' + (deployError.message || '');
              const failedReferenceIds = this.extractFailedReferenceIds(errorOutput);
              
              if (failedReferenceIds.length > 0 && cleanedJsonFile) {
                try {
                  if (jobId) {
                    jobMonitor.addJobLog(jobId, `🔄 Attempting recovery: Removing ${failedReferenceIds.length} failed records from ${objectName}`, 'info');
                  }
                  
                  const filteredFilePath = await this.filterRecordsByReferenceIds(cleanedJsonFile, failedReferenceIds, jobId);
                  
                  if (filteredFilePath && await fs.pathExists(filteredFilePath)) {
                    const filteredData = await fs.readJson(filteredFilePath);
                    const originalData = await fs.readJson(cleanedJsonFile);
                    
                    const filteredRecords = Array.isArray(filteredData) ? filteredData : (filteredData.records || []);
                    const originalRecords = Array.isArray(originalData) ? originalData : (originalData.records || []);
                    
                    if (filteredRecords.length > 0 && filteredRecords.length < originalRecords.length) {
                      // Retry with filtered file
                      if (jobId) {
                        jobMonitor.addJobLog(jobId, `🔄 Retrying ${objectName} with ${filteredRecords.length} records (removed ${originalRecords.length - filteredRecords.length} failed records)`, 'info');
                      }
                      
                      const retryOutput = await this.executeCommand([
                        'data', 'tree', 'import',
                        '--files', filteredFilePath,
                        '--target-org', targetUsername
                      ], {
                        username: targetUsername,
                        jobId,
                        cwd: sourcePath
                      });
                      
                      results.push({
                        object: objectName,
                        file: jsonFile,
                        status: 'success',
                        output: `Deployed ${filteredRecords.length} records (${originalRecords.length - filteredRecords.length} failed records removed)`
                      });
                      
                      if (jobId) {
                        jobMonitor.addJobLog(jobId, `✅ ${objectName} recovered and deployed successfully (${filteredRecords.length} records)`, 'info');
                        jobMonitor.updateJobProgress(jobId, undefined, `Deployed ${objectName} successfully`);
                      }
                      
                      // Clean up filtered file
                      await fs.remove(filteredFilePath);
                    } else {
                      // All records were filtered out
                      await fs.remove(filteredFilePath);
                      throw new Error(`All records in ${objectName} failed validation`);
                    }
                  } else {
                    throw deployError; // Re-throw if filtering failed
                  }
                } catch (recoveryError) {
                  if (jobId) {
                    jobMonitor.addJobLog(jobId, `⚠️  Recovery failed for ${objectName}: ${recoveryError.message}`, 'warn');
                  }
                  throw deployError; // Re-throw original error
                }
              } else {
                throw deployError; // Re-throw if no failed Reference IDs found
              }
            }
          }
        } catch (error) {
          const objectName = path.basename(jsonFile, '.json');
          errors.push({
            object: objectName,
            file: jsonFile,
            error: error.message
          });
          
          if (jobId) {
            logger.logError(new Error(`Failed to deploy ${objectName}: ${error.message}`), { jobId, objectName });
            jobMonitor.addJobLog(jobId, `❌ Failed to deploy ${objectName}: ${error.message}`, 'error');
          }
        }
      }

      // Log final summary of inaccessible Product2 IDs
      if (allInaccessibleProduct2Ids.size > 0) {
        const inaccessibleIdsArray = Array.from(allInaccessibleProduct2Ids);
        logger.warn(`Deployment completed with ${allInaccessibleProduct2Ids.size} unique inaccessible Product2 IDs across all batches`, {
          totalInaccessible: allInaccessibleProduct2Ids.size,
          inaccessibleIds: inaccessibleIdsArray
        });
        
        if (jobId) {
          jobMonitor.addJobLog(jobId, `📋 SUMMARY: ${allInaccessibleProduct2Ids.size} unique Product2 records are inaccessible`, 'warn');
          jobMonitor.addJobLog(jobId, `   All inaccessible Product2 IDs: ${inaccessibleIdsArray.join(', ')}`, 'warn');
          jobMonitor.addJobLog(jobId, `   Action required: Grant access to these Product2 records in the target org`, 'warn');
        }
      }

      return {
        success: errors.length === 0,
        results,
        errors,
        deployedAt: new Date().toISOString(),
        inaccessibleProduct2Ids: allInaccessibleProduct2Ids.size > 0 ? Array.from(allInaccessibleProduct2Ids) : []
      };
    } catch (error) {
      logger.error(`SF CLI deploy failed: ${error.message}`);
      if (jobId) {
        logger.logError(error, { jobId, operation: 'SF CLI deploy' });
        jobMonitor.addJobLog(jobId, `❌ SF CLI deploy failed: ${error.message}`, 'error');
      }
      throw error;
    }
  }

  /**
   * Clean JSON file for import by removing relationship fields and read-only fields
   * @param {string} jsonFilePath - Path to JSON file
   * @param {string} objectName - Object API name
   * @param {string} jobId - Job ID (optional)
   * @returns {Promise<string>} Path to cleaned JSON file
   */
  async cleanJsonForImport(jsonFilePath, objectName, jobId = null) {
    try {
      // Read the JSON file
      const jsonContent = await fs.readFile(jsonFilePath, 'utf8');
      const data = JSON.parse(jsonContent);
      
      // Get records array
      let records = [];
      if (Array.isArray(data)) {
        records = data;
      } else if (data.records && Array.isArray(data.records)) {
        records = data.records;
      } else {
        records = [data];
      }
      
      // Fields to remove (read-only fields and fields with field-level security issues)
      const readOnlyFields = ['Name']; // Auto-number fields are read-only
      
      // Fields that may have field-level security restrictions (remove if causing errors)
      // These fields may not be writable in the target org due to FLS settings
      const restrictedFields = [
        'GT_UniqueKey__c',          // May have FLS restrictions (GT_RateTable__c)
        'GT_ProductName__c',       // Field-level security error (GT_ProductSKU__c)
        'GT_ProductCode__c',       // Field-level security error (GT_ProductSKU__c)
        'GT_RateDescription__c'     // Field-level security error (GT_RateTable__c)
      ];
      
      // Combine all fields to remove
      const fieldsToRemove = [...readOnlyFields, ...restrictedFields];
      
      // Clean each record
      const cleanedRecords = records.map((record, index) => {
        const cleaned = { ...record };
        
        // Remove the Id field - sf data tree import creates new records, so source IDs are invalid
        // The Id from the source org won't exist in the target org, causing INVALID_ID_FIELD errors
        if (cleaned.Id) {
          delete cleaned.Id;
        }
        
        // Ensure attributes object exists
        if (!cleaned.attributes) {
          cleaned.attributes = {};
        }
        
        // Remove the Id from attributes.url if present (contains source org ID)
        if (cleaned.attributes.url) {
          // Keep the type but remove the URL which contains the source ID
          // The type is needed for sf data tree import
          delete cleaned.attributes.url;
        }
        
        // Ensure referenceId exists in attributes (required by sf data tree import)
        if (!cleaned.attributes.referenceId) {
          // Generate referenceId if missing (format: ObjectNameRef1, ObjectNameRef2, etc.)
          cleaned.attributes.referenceId = `${objectName}Ref${index + 1}`;
        }
        
        // Ensure type is set in attributes
        if (!cleaned.attributes.type) {
          cleaned.attributes.type = objectName;
        }
        
        // Remove relationship fields (ending with __r)
        Object.keys(cleaned).forEach(key => {
          if (key.endsWith('__r')) {
            delete cleaned[key];
          }
        });
        
        // Remove read-only and restricted fields
        fieldsToRemove.forEach(field => {
          if (cleaned[field] !== undefined) {
            delete cleaned[field];
          }
        });
        
        return cleaned;
      });
      
      // Create cleaned data structure
      const cleanedData = {
        records: cleanedRecords
      };
      
      // Write to a temporary cleaned file
      const cleanedFilePath = path.join(path.dirname(jsonFilePath), `${objectName}_cleaned.json`);
      await fs.writeJson(cleanedFilePath, cleanedData, { spaces: 2 });
      
      if (jobId) {
        const removedFields = records.length > 0 ? 
          Object.keys(records[0]).filter(k => k.endsWith('__r') || fieldsToRemove.includes(k)).join(', ') : 
          'none';
        jobMonitor.addJobLog(jobId, `🧹 Cleaned ${objectName} JSON: removed ${removedFields}`, 'info');
      }
      
      logger.info(`Cleaned JSON file for import`, {
        original: jsonFilePath,
        cleaned: cleanedFilePath,
        recordsCount: cleanedRecords.length,
        objectName
      });
      
      return cleanedFilePath;
    } catch (error) {
      logger.error(`Failed to clean JSON file: ${error.message}`, {
        jsonFilePath,
        objectName,
        error: error.stack
      });
      // If cleaning fails, return original file
      return jsonFilePath;
    }
  }

  /**
   * Create export manifest for SF CLI
   * @param {Array} queries - Array of query configurations
   * @param {string} outputPath - Output path for manifest
   * @returns {Promise<string>} Manifest file path
   */
  async createExportManifest(queries, outputPath) {
    const manifest = {
      apiVersion: '58.0',
      queries: queries.map(q => ({
        object: q.object || 'Unknown',
        query: q.query || q.soql_query,
        external_key: q.external_key || 'Id'
      }))
    };

    const manifestPath = path.join(outputPath, 'manifest.json');
    await fs.writeJson(manifestPath, manifest, { spaces: 2 });

    return manifestPath;
  }
}

module.exports = new SfCliService();

