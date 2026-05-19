/**
 * Enhanced Exports Route (Demonstration)
 * Shows how to use the new enhanced CLI execution services
 * This can gradually replace the existing exports route
 */

const express = require('express');
const router = express.Router();
const enhancedCLIExecutor = require('../services/enhancedCLIExecutor');
const commandValidator = require('../services/commandValidator');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');

/**
 * @swagger
 * /api/enhanced-exports/validate:
 *   post:
 *     operationId: validateExportConfig
 *     summary: Validate export configuration before execution
 *     description: Validates the provided Vlocity export configuration (username, job file path, and export command) without actually running the export. Returns a structured validation report with any errors or warnings.
 *     tags:
 *       - Enhanced Exports
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *                 description: Salesforce org username (SFDX alias or full username)
 *               jobFilePath:
 *                 type: string
 *                 description: Absolute path to the Vlocity job file (YAML)
 *               exportCommand:
 *                 type: string
 *                 description: Vlocity CLI export command to validate (e.g. packExport)
 *     responses:
 *       200:
 *         description: Validation report generated (check valid field for overall result)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: string
 *                 warnings:
 *                   type: array
 *                   items:
 *                     type: string
 *                 report:
 *                   type: string
 *                   description: Human-readable validation report
 *       400:
 *         description: Validation error — malformed request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/validate', asyncHandler(async (req, res) => {
  const { username, jobFilePath, exportCommand } = req.body;

  const validation = await commandValidator.validateVlocityExport({
    username,
    jobFilePath,
    exportCommand,
  });

  const report = commandValidator.generateValidationReport(validation);

  res.json({
    valid: validation.valid,
    errors: validation.errors,
    warnings: validation.warnings,
    report,
  });
}));

/**
 * @swagger
 * /api/enhanced-exports/run:
 *   post:
 *     operationId: runExport
 *     summary: Run a Vlocity export with enhanced handling
 *     description: Executes a Vlocity DataPack export using the enhanced CLI executor, which provides automatic retries, structured result parsing, performance metrics, and a human-readable error report.
 *     tags:
 *       - Enhanced Exports
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - jobFilePath
 *             properties:
 *               username:
 *                 type: string
 *                 description: Salesforce org username
 *               jobFilePath:
 *                 type: string
 *                 description: Absolute path to the Vlocity job file (YAML)
 *               jobName:
 *                 type: string
 *                 default: Vlocity Export
 *                 description: Human-readable name for this export job
 *               exportCommand:
 *                 type: string
 *                 default: packExport
 *                 description: Vlocity CLI export command to run
 *     responses:
 *       200:
 *         description: Export executed (check success field for overall outcome)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 jobId:
 *                   type: string
 *                 correlationId:
 *                   type: string
 *                 executionTimeMs:
 *                   type: integer
 *                 attempts:
 *                   type: integer
 *                 exitCode:
 *                   type: integer
 *                 summary:
 *                   type: object
 *                 packsByType:
 *                   type: object
 *                 performance:
 *                   type: object
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: string
 *                 warnings:
 *                   type: array
 *                   items:
 *                     type: string
 *                 errorAnalysis:
 *                   type: object
 *                 errorReport:
 *                   type: string
 *                 validationErrors:
 *                   type: array
 *                   items:
 *                     type: string
 *                 validationWarnings:
 *                   type: array
 *                   items:
 *                     type: string
 *                 metadata:
 *                   type: object
 *       400:
 *         description: Validation error — missing username or jobFilePath
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/run', asyncHandler(async (req, res) => {
  const { username, jobFilePath, jobName, exportCommand } = req.body;

  if (!username) {
    throw new ValidationError('Username is required');
  }

  if (!jobFilePath) {
    throw new ValidationError('Job file path is required');
  }

  // Create job ID (in real implementation, get from database)
  const jobId = Date.now().toString();

  // Execute with all enhancements
  const result = await enhancedCLIExecutor.executeVlocityExport({
    username,
    jobFilePath,
    jobName: jobName || 'Vlocity Export',
    exportCommand: exportCommand || 'packExport',
  }, jobId);

  // Return comprehensive result
  res.json({
    success: result.success,
    jobId,
    correlationId: result.correlationId,

    // Execution metadata
    executionTimeMs: result.executionTimeMs,
    attempts: result.attempts,
    exitCode: result.exitCode,

    // Summary statistics
    summary: result.summary,

    // Detailed breakdown
    packsByType: result.packsByType,

    // Performance metrics
    performance: result.performance,

    // Errors and warnings
    errors: result.errors,
    warnings: result.warnings,
    errorAnalysis: result.errorAnalysis,

    // User-friendly error report
    errorReport: result.errorReport,

    // Validation results (if validation failed)
    validationErrors: result.validationErrors,
    validationWarnings: result.validationWarnings,

    // Metadata
    metadata: result.metadata,
  });
}));

/**
 * @swagger
 * /api/enhanced-exports/validate-deploy:
 *   post:
 *     operationId: validateDeployConfig
 *     summary: Validate deploy configuration before execution
 *     description: Validates the provided Vlocity deploy configuration (target username, job file path, and deploy command) without running the deploy. Returns a structured validation report with any errors or warnings.
 *     tags:
 *       - Enhanced Exports
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               targetUsername:
 *                 type: string
 *                 description: Target Salesforce org username
 *               jobFilePath:
 *                 type: string
 *                 description: Absolute path to the Vlocity job file (YAML)
 *               deployCommand:
 *                 type: string
 *                 description: Vlocity CLI deploy command to validate (e.g. packDeploy)
 *     responses:
 *       200:
 *         description: Validation report generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: string
 *                 warnings:
 *                   type: array
 *                   items:
 *                     type: string
 *                 report:
 *                   type: string
 *       400:
 *         description: Validation error — malformed request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/validate-deploy', asyncHandler(async (req, res) => {
  const { targetUsername, jobFilePath, deployCommand } = req.body;

  const validation = await commandValidator.validateVlocityDeploy({
    targetUsername,
    jobFilePath,
    deployCommand,
  });

  const report = commandValidator.generateValidationReport(validation);

  res.json({
    valid: validation.valid,
    errors: validation.errors,
    warnings: validation.warnings,
    report,
  });
}));

/**
 * @swagger
 * /api/enhanced-exports/run-deploy:
 *   post:
 *     operationId: runDeploy
 *     summary: Run a Vlocity deploy with enhanced handling
 *     description: Executes a Vlocity DataPack deploy using the enhanced CLI executor, which provides automatic retries, structured result parsing, detection of settings mismatches and duplicate records, and a human-readable error report.
 *     tags:
 *       - Enhanced Exports
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - targetUsername
 *               - jobFilePath
 *             properties:
 *               targetUsername:
 *                 type: string
 *                 description: Target Salesforce org username
 *               jobFilePath:
 *                 type: string
 *                 description: Absolute path to the Vlocity job file (YAML)
 *               jobName:
 *                 type: string
 *                 default: Vlocity Deploy
 *                 description: Human-readable name for this deploy job
 *               deployCommand:
 *                 type: string
 *                 default: packDeploy
 *                 description: Vlocity CLI deploy command to run
 *     responses:
 *       200:
 *         description: Deploy executed (check success field for overall outcome)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 jobId:
 *                   type: string
 *                 correlationId:
 *                   type: string
 *                 executionTimeMs:
 *                   type: integer
 *                 summary:
 *                   type: object
 *                 packsByType:
 *                   type: object
 *                 performance:
 *                   type: object
 *                 errors:
 *                   type: array
 *                   items:
 *                     type: string
 *                 warnings:
 *                   type: array
 *                   items:
 *                     type: string
 *                 settingsMismatches:
 *                   type: array
 *                   items:
 *                     type: object
 *                 duplicates:
 *                   type: array
 *                   items:
 *                     type: object
 *                 orphanedReferences:
 *                   type: array
 *                   items:
 *                     type: object
 *                 errorAnalysis:
 *                   type: object
 *                 errorReport:
 *                   type: string
 *                 metadata:
 *                   type: object
 *       400:
 *         description: Validation error — missing targetUsername or jobFilePath
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/run-deploy', asyncHandler(async (req, res) => {
  const { targetUsername, jobFilePath, jobName, deployCommand } = req.body;

  if (!targetUsername) {
    throw new ValidationError('Target username is required');
  }

  if (!jobFilePath) {
    throw new ValidationError('Job file path is required');
  }

  const jobId = Date.now().toString();

  const result = await enhancedCLIExecutor.executeVlocityDeploy({
    targetUsername,
    jobFilePath,
    jobName: jobName || 'Vlocity Deploy',
    deployCommand: deployCommand || 'packDeploy',
  }, jobId);

  res.json({
    success: result.success,
    jobId,
    correlationId: result.correlationId,
    executionTimeMs: result.executionTimeMs,
    summary: result.summary,
    packsByType: result.packsByType,
    performance: result.performance,
    errors: result.errors,
    warnings: result.warnings,
    settingsMismatches: result.settingsMismatches,
    duplicates: result.duplicates,
    orphanedReferences: result.orphanedReferences,
    errorAnalysis: result.errorAnalysis,
    errorReport: result.errorReport,
    metadata: result.metadata,
  });
}));

module.exports = router;
