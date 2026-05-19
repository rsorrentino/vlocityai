/**
 * Enhanced CLI Executor
 * Orchestrates CLI execution with validation, logging, error handling, and result parsing
 */

const { spawn } = require('child_process');
const commandValidator = require('./commandValidator');
const structuredLogger = require('./structuredLogger');
const cliResultParser = require('./cliResultParser');
const enhancedErrorHandler = require('./enhancedErrorHandler');

class EnhancedCLIExecutor {
  /**
   * Execute Vlocity export command with all enhancements
   */
  async executeVlocityExport(config, jobId) {
    const logger = structuredLogger.createJobLogger(
      jobId,
      config.jobName || 'Vlocity Export',
      config.username,
      'export'
    );

    logger.info('Starting Vlocity export job');

    // Step 1: Validate command before execution
    logger.info('Validating command configuration');
    const validation = await commandValidator.validateVlocityExport(config);

    if (!validation.valid) {
      const validationReport = commandValidator.generateValidationReport(validation);
      logger.error('Validation failed', null, { validation });
      logger.logJobError('Validation failed:\n' + validationReport);

      return {
        success: false,
        validationErrors: validation.errors,
        validationWarnings: validation.warnings,
        errorReport: enhancedErrorHandler.generateErrorReport(
          validation.errors.map(e => ({
            type: e.code,
            message: e.message,
          }))
        ),
      };
    }

    if (validation.warnings.length > 0) {
      const warningReport = commandValidator.generateValidationReport({ valid: true, errors: [], warnings: validation.warnings });
      logger.warn('Validation warnings detected', { warnings: validation.warnings });
      logger.logJobProgress('⚠️  Validation warnings:\n' + warningReport);
    }

    // Step 2: Build CLI command
    const vlocityService = require('./vlocityService');
    const command = 'vlocity';
    const args = [
      `-sfdx.username=${config.username}`,
      `-job=${config.jobFilePath}`,
      config.exportCommand || 'packExport',
    ];

    // Step 3: Execute with enhanced logging
    const cliLogger = structuredLogger.createCLILogger(command, args, jobId, 'export');
    cliLogger.logStart();
    logger.logJobProgress(`🚀 Starting export: ${config.exportCommand}`);

    const startTime = Date.now();
    let attemptNumber = 0;
    let lastError = null;
    let result = null;

    // Retry loop with enhanced error handling
    while (attemptNumber < 3) {
      attemptNumber++;

      if (attemptNumber > 1) {
        const delay = enhancedErrorHandler.getRetryDelay(lastError?.type, attemptNumber);
        logger.warn(`Retrying attempt ${attemptNumber}/3`, { delay });
        cliLogger.logRetry(attemptNumber, lastError?.message || 'Previous attempt failed', delay);
        await this.sleep(delay);
      }

      try {
        // Execute command
        const { stdout, stderr, exitCode } = await this.executeCommand(command, args, jobId, cliLogger);

        const executionTime = Date.now() - startTime;

        // Step 4: Parse result with enhanced parser
        logger.info('Parsing CLI output');
        result = cliResultParser.parseVlocityExport(stdout, stderr, exitCode, executionTime);

        // Step 5: Analyze errors
        if (result.errors.length > 0) {
          logger.warn(`Command completed with ${result.errors.length} errors`, { errorCount: result.errors.length });

          const errorAnalysis = enhancedErrorHandler.analyzeErrors(result.errors);

          // Check if we should auto-retry
          const primaryError = result.errors[0];
          if (enhancedErrorHandler.shouldAutoRetry(primaryError.type, attemptNumber)) {
            lastError = primaryError;
            logger.warn('Retryable error detected, will retry', { errorType: primaryError.type });
            continue; // Retry
          }

          // Check for auto-fix actions
          const autoFix = enhancedErrorHandler.getAutoFix(primaryError.type);
          if (autoFix === 'updateSettings') {
            logger.info('Settings mismatch detected, attempting auto-fix');
            logger.logJobProgress('🔧 Auto-fixing settings mismatch...');

            try {
              await vlocityService.executeCommand(config.username, config.jobFilePath, 'packUpdateSettings');
              logger.info('Settings updated successfully, retrying deploy');
              logger.logJobProgress('✓ Settings updated, retrying...');
              continue; // Retry after fix
            } catch (fixError) {
              logger.error('Auto-fix failed', fixError);
            }
          }

          // Generate error report
          result.errorReport = enhancedErrorHandler.generateErrorReport(result.errors);
          result.errorAnalysis = errorAnalysis;
        }

        // Success or non-retryable error - break loop
        break;

      } catch (err) {
        logger.error('CLI execution error', err);
        lastError = {
          type: 'CLIExecutionError',
          message: err.message,
        };

        if (attemptNumber >= 3) {
          // Max retries reached
          result = {
            success: false,
            errors: [{
              type: 'CLIExecutionError',
              message: err.message,
              severity: 'critical',
              recoverable: false,
            }],
            errorReport: enhancedErrorHandler.generateErrorReport([{
              type: 'CLIExecutionError',
              message: err.message,
            }]),
          };
        }
      }
    }

    // Step 6: Generate summary and log completion
    const executionTime = Date.now() - startTime;
    const summary = result ? cliResultParser.generateSummary(result) : 'No result generated';

    logger.logJobCompletion(result?.success || false, executionTime, {
      exportedPacks: result?.summary?.exportedPacks || 0,
      totalRecords: result?.summary?.exportedRecords || 0,
      errors: result?.errors?.length || 0,
      warnings: result?.warnings?.length || 0,
    });

    logger.logJobProgress('\n' + summary);

    if (result?.errorReport) {
      logger.logJobProgress('\n' + result.errorReport);
    }

    cliLogger.logCompletion(result?.exitCode || 1, result?.stdout, result?.stderr);

    return {
      ...result,
      executionTimeMs: executionTime,
      attempts: attemptNumber,
      correlationId: logger.correlationId,
    };
  }

  /**
   * Execute Vlocity deploy command with all enhancements
   */
  async executeVlocityDeploy(config, jobId) {
    const logger = structuredLogger.createJobLogger(
      jobId,
      config.jobName || 'Vlocity Deploy',
      config.targetUsername,
      'deploy'
    );

    logger.info('Starting Vlocity deploy job');

    // Validation
    logger.info('Validating command configuration');
    const validation = await commandValidator.validateVlocityDeploy(config);

    if (!validation.valid) {
      const validationReport = commandValidator.generateValidationReport(validation);
      logger.error('Validation failed', null, { validation });
      logger.logJobError('Validation failed:\n' + validationReport);

      return {
        success: false,
        validationErrors: validation.errors,
        validationWarnings: validation.warnings,
        errorReport: enhancedErrorHandler.generateErrorReport(
          validation.errors.map(e => ({
            type: e.code,
            message: e.message,
          }))
        ),
      };
    }

    if (validation.warnings.length > 0) {
      const warningReport = commandValidator.generateValidationReport({ valid: true, errors: [], warnings: validation.warnings });
      logger.warn('Validation warnings detected', { warnings: validation.warnings });
      logger.logJobProgress('⚠️  Validation warnings:\n' + warningReport);
    }

    // Execute deploy (similar pattern to export)
    const vlocityService = require('./vlocityService');
    const command = 'vlocity';
    const args = [
      `-sfdx.username=${config.targetUsername}`,
      `-job=${config.jobFilePath}`,
      config.deployCommand || 'packDeploy',
    ];

    const cliLogger = structuredLogger.createCLILogger(command, args, jobId, 'deploy');
    cliLogger.logStart();
    logger.logJobProgress(`🚀 Starting deploy: ${config.deployCommand}`);

    const startTime = Date.now();
    let result = null;

    try {
      const { stdout, stderr, exitCode } = await this.executeCommand(command, args, jobId, cliLogger);
      const executionTime = Date.now() - startTime;

      result = cliResultParser.parseVlocityDeploy(stdout, stderr, exitCode, executionTime);

      if (result.errors.length > 0) {
        const errorAnalysis = enhancedErrorHandler.analyzeErrors(result.errors);
        result.errorReport = enhancedErrorHandler.generateErrorReport(result.errors);
        result.errorAnalysis = errorAnalysis;
      }

      const summary = cliResultParser.generateSummary(result);
      logger.logJobCompletion(result.success, executionTime, {
        deployedPacks: result.summary.deployedPacks,
        totalRecords: result.summary.deployedRecords,
        errors: result.errors.length,
        warnings: result.warnings.length,
      });

      logger.logJobProgress('\n' + summary);

      if (result.errorReport) {
        logger.logJobProgress('\n' + result.errorReport);
      }

      cliLogger.logCompletion(exitCode, stdout, stderr);

    } catch (err) {
      logger.error('CLI execution error', err);
      result = {
        success: false,
        errors: [{
          type: 'CLIExecutionError',
          message: err.message,
        }],
        errorReport: enhancedErrorHandler.generateErrorReport([{
          type: 'CLIExecutionError',
          message: err.message,
        }]),
      };
    }

    return {
      ...result,
      executionTimeMs: Date.now() - startTime,
      correlationId: logger.correlationId,
    };
  }

  /**
   * Execute command with enhanced output capturing
   */
  executeCommand(command, args, jobId, cliLogger) {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const child = spawn(command, args, {
        shell: true,
        env: process.env,
      });

      child.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;

        output.split('\n').forEach(line => {
          if (line.trim()) {
            cliLogger.logOutput(line.trim(), 'stdout');
          }
        });
      });

      child.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;

        output.split('\n').forEach(line => {
          if (line.trim() && !line.includes('DeprecationWarning')) {
            cliLogger.logError(line.trim());
          }
        });
      });

      child.on('close', (exitCode) => {
        resolve({ stdout, stderr, exitCode });
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Sleep utility for retries
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new EnhancedCLIExecutor();
