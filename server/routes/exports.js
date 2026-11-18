const express = require('express');
const router = express.Router();
const vlocityService = require('../services/vlocityService');
const getVlocityCommandsService = require('../services/vlocityCommandsService');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const { validate, schemas } = require('../utils/configValidator');
const { detectCliType } = require('../utils/cliTypeDetector');
const logger = require('../utils/logger');
const fs = require('fs-extra');
const path = require('path');
const yaml = require('yaml');

// Get Vlocity Commands Service instance
const vlocityCommandsService = getVlocityCommandsService();

// Import job history functionality
const jobRoutes = require('./jobs');
const jobHistoryService = require('../services/jobHistoryService');
const jobMonitor = require('../services/jobMonitor');
const exportRecoveryService = require('../services/exportRecoveryService');
const errorLogParser = require('../services/errorLogParser');
const buildLogParser = require('../services/buildLogParser');
const preflightService = require('../services/preflightService');
const vlocityErrorHandler = require('../services/vlocityErrorHandler');
const { sortQueriesByDependency } = require('../config/datapckDependencies');

const JOB_LOGS_DIR = path.join(__dirname, '../../logs/jobs');

/**
 * @swagger
 * /api/exports/create-job:
 *   post:
 *     operationId: createExportJob
 *     summary: Create an export job
 *     description: Validates the job configuration, writes a YAML job file (for Vlocity CLI jobs), and records the job in the database with a `pending` status.
 *     tags:
 *       - Export Jobs
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: Unique job name (used as the YAML filename).
 *               username:
 *                 type: string
 *                 description: Salesforce org username to export from.
 *               projectPath:
 *                 type: string
 *                 description: Destination path for exported DataPacks.
 *                 example: ./export
 *               cliType:
 *                 type: string
 *                 enum: [vlocity, sf]
 *                 description: CLI to use. Auto-detected from queries if omitted.
 *               queries:
 *                 type: array
 *                 description: DataPack query definitions.
 *                 items:
 *                   type: object
 *               environment:
 *                 type: string
 *                 description: Environment label (e.g. dev, uat, prod).
 *     responses:
 *       200:
 *         description: Export job created successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 jobFile:
 *                   type: string
 *                   nullable: true
 *                 jobPath:
 *                   type: string
 *                   nullable: true
 *                 config:
 *                   type: object
 *                 cliType:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error — missing name or invalid cliType.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/create-job', validate(schemas.exportJob), asyncHandler(async (req, res) => {
  const jobConfig = req.body;

  // Auto-detect CLI type based on job configuration
  const cliType = detectCliType(jobConfig);
  
  // Validate job name is provided
  if (!jobConfig.name) {
    throw new ValidationError('Job name is required');
  }

  // Validate CLI type
  if (!['vlocity', 'sf'].includes(cliType)) {
    throw new ValidationError('cliType must be either "vlocity" or "sf"');
  }
  
  // Set cliType in jobConfig for persistence
  jobConfig.cliType = cliType;
  
  // Save to jobs directory (not temp) - only for Vlocity CLI jobs
  let createdPath = null;
  if (cliType === 'vlocity') {
    const jobsDir = path.join(__dirname, '../../jobs');
    await fs.ensureDir(jobsDir);
    
    // Sanitize job name to remove invalid filename characters
    const sanitizedName = jobConfig.name.replace(/[<>:"/\\|?*]/g, '-');
    const jobFileName = `${sanitizedName}.yaml`;
    const jobFilePath = path.join(jobsDir, jobFileName);

    try {
      createdPath = await vlocityService.createJobFile(jobConfig, jobFilePath);
    } catch (error) {
      logger.logError(error, { operation: 'createExportJobFile', jobConfig });
      throw error;
    }
  }
  
  // Add to job history
  if (jobRoutes.addJobToHistory) {
    jobRoutes.addJobToHistory({
      type: 'export',
      name: jobConfig.name,
      status: 'pending', // Use valid status instead of 'created'
      username: jobConfig.username || 'system',
      configuration: jobConfig || {},
      message: `Export job created with ${(jobConfig.queries || []).length} queries using ${cliType.toUpperCase()} CLI`,
      startedAt: new Date().toISOString(),
      filePath: createdPath,
      projectPath: jobConfig.projectPath || './export',
      environment: jobConfig.environment || 'dev',
      cliType: cliType
    });
  }
  
  logger.logOperation('Export job created', { 
    jobName: jobConfig.name,
    queriesCount: (jobConfig.queries || []).length,
    filePath: createdPath,
    cliType: cliType
  });

  res.json({
    success: true,
    jobFile: createdPath ? path.basename(createdPath) : null,
    jobPath: createdPath,
    config: jobConfig,
    cliType: cliType,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/exports/preflight:
 *   post:
 *     operationId: runExportPreflight
 *     summary: Run export preflight checks
 *     description: Validates a job configuration before execution — checks org reachability, query syntax, and project path accessibility. Accepts either an existing `jobId` or an inline `jobConfig`.
 *     tags:
 *       - Export Jobs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: checkOrg
 *         schema:
 *           type: string
 *           enum: ['true', 'false']
 *           default: 'false'
 *         description: When `true`, also tests live connectivity to the Salesforce org.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               jobId:
 *                 type: string
 *                 description: ID or name of an existing saved job to load the config from.
 *               jobConfig:
 *                 type: object
 *                 description: Inline job configuration object.
 *     responses:
 *       200:
 *         description: Preflight checks completed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 passed:
 *                   type: boolean
 *                 checks:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: jobConfig or jobId is required.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/preflight', asyncHandler(async (req, res) => {
  let jobConfig = req.body.jobConfig;

  // If a jobId is provided, load the config from the job file
  if (!jobConfig && req.body.jobId) {
    const jobsDir = path.join(__dirname, '../../jobs');
    const files = await fs.readdir(jobsDir).catch(() => []);
    for (const file of files) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
      const content = await fs.readFile(path.join(jobsDir, file), 'utf8').catch(() => null);
      if (!content) continue;
      const parsed = yaml.parse(content);
      // Match by name if job name is in req.body
      if (parsed && (parsed.id === req.body.jobId || parsed.name === req.body.jobId)) {
        jobConfig = parsed;
        break;
      }
    }
  }

  if (!jobConfig) {
    throw new ValidationError('Provide jobConfig or a valid jobId');
  }

  const checkOrgReachability = req.query.checkOrg === 'true';
  const result = await preflightService.runPreflightChecks(jobConfig, { checkOrgReachability });

  res.json({ success: true, ...result });
}));

/**
 * @swagger
 * /api/exports/run:
 *   post:
 *     operationId: runExportJob
 *     summary: Run an export job
 *     description: Executes a Vlocity or SF CLI export against a Salesforce org. Supports automatic dependency ordering, error recovery, and real-time progress via WebSocket. The HTTP response is returned once the job is initiated.
 *     tags:
 *       - Export Jobs
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
 *             properties:
 *               username:
 *                 type: string
 *                 description: Salesforce org username or alias.
 *               jobFilePath:
 *                 type: string
 *                 description: Path to an existing YAML job file on the server.
 *               jobConfig:
 *                 type: object
 *                 description: Inline job configuration. Used when no jobFilePath is provided.
 *               cliType:
 *                 type: string
 *                 enum: [vlocity, sf]
 *                 description: CLI override. Auto-detected from the job record if omitted.
 *               exportCommand:
 *                 type: string
 *                 default: packExport
 *                 description: Vlocity CLI export command to invoke.
 *               enableRecovery:
 *                 type: boolean
 *                 default: true
 *                 description: Automatically retry failed queries in subsequent iterations.
 *               maxRecoveryIterations:
 *                 type: integer
 *                 default: 10
 *                 description: Maximum number of recovery retry iterations.
 *               useDependencyOrder:
 *                 type: boolean
 *                 default: true
 *                 description: Sort queries by DataPack dependency tier before execution.
 *     responses:
 *       200:
 *         description: Export job started (or completed for short-lived exports).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 jobId:
 *                   type: string
 *                   format: uuid
 *                 result:
 *                   type: object
 *                 cliType:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Missing required parameters.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Export failed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/run', asyncHandler(async (req, res) => {
  const {
    username,
    jobFilePath,
    jobConfig: requestJobConfig,
    enableRecovery = true,        // default ON — dependency errors are the main export failure mode
    maxRecoveryIterations = 10,
    useDependencyOrder = true,    // sort queries by known DataPack type dependency tiers
    cliType: requestCliType,
    exportCommand = 'packExport'
  } = req.body;
  // Reassigned below when queries are sorted by dependency order
  let jobConfig = requestJobConfig;

  if (!username) {
    throw new ValidationError('Username is required');
  }

  if (!jobFilePath && !jobConfig) {
    throw new ValidationError('Either jobFilePath or jobConfig is required');
  }

  // Declare createdJob outside try block so it's accessible in catch
  let createdJob = null;
  
  // Try to find existing job first to get its cliType
  let cliType = requestCliType;
  if (jobFilePath) {
    const { Job } = require('../models');
    const existingJob = await Job.findOne({
      where: {
        filePath: jobFilePath,
        type: 'export'
      },
      order: [['createdAt', 'DESC']]
    });
    
    if (existingJob) {
      // Get cliType from existing job (stored in database or configuration)
      cliType = existingJob.cliType || existingJob.configuration?.cliType || requestCliType || 'vlocity';
      createdJob = existingJob;
    }
  }
  
  // If cliType still not set, try to get it from jobConfig
  if (!cliType && jobConfig) {
    cliType = jobConfig.cliType || 'vlocity';
  }
  
  // Default to vlocity if still not set
  cliType = cliType || 'vlocity';

  // Validate CLI type
  if (!['vlocity', 'sf'].includes(cliType)) {
    throw new ValidationError('cliType must be either "vlocity" or "sf"');
  }

  // Import SF CLI service if needed
  const sfCliService = cliType === 'sf' ? require('../services/sfCliService') : null;

  let actualJobPath = jobFilePath;

  // Create job file if jobConfig is provided (only for Vlocity CLI)
  if (jobConfig && !jobFilePath && cliType === 'vlocity') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jobFileName = `export-job-${timestamp}.yaml`;
    actualJobPath = path.join(__dirname, '../temp', jobFileName);

    // Sort queries by dependency tier before writing YAML
    if (useDependencyOrder && Array.isArray(jobConfig.queries)) {
      const sorted = sortQueriesByDependency(jobConfig.queries);
      if (sorted.length > 1) {
        logger.info('Export: sorted queries by dependency order', {
          original: jobConfig.queries.map(q => q.VlocityDataPackType || q.object).filter(Boolean),
          sorted:   sorted.map(q => q.VlocityDataPackType || q.object).filter(Boolean),
        });
      }
      jobConfig = { ...jobConfig, queries: sorted };
    }

    await vlocityService.createJobFile(jobConfig, actualJobPath);
  }
  
  try {
    logger.logOperation('Starting export', { 
      username, 
      jobPath: actualJobPath, 
      enableRecovery, 
      cliType,
      jobFilePath,
      hasJobConfig: !!jobConfig
    });
    
    // Check if job already exists for this file path (created earlier)
    if (!createdJob) {
      const { Job } = require('../models');
      createdJob = await Job.findOne({
        where: {
          filePath: actualJobPath,
          type: 'export'
        },
        order: [['createdAt', 'DESC']]
      });
    }
    
    if (createdJob) {
      // Update existing job to running status
      createdJob.status = 'running';
      createdJob.startedAt = new Date();
      createdJob.username = username;
      createdJob.configuration = jobConfig || createdJob.configuration;
      createdJob.cliType = cliType; // Ensure cliType is set
      await createdJob.save();

      // Register with in-memory monitor so logs are streamed via WebSocket
      jobMonitor.startJob({
        id: createdJob.id,
        type: createdJob.type,
        name: createdJob.name,
        username: username,
        config: jobConfig || createdJob.configuration
      });

      logger.logOperation('Updated existing job to running', { jobId: createdJob.id, cliType });
    } else {
      // Create new job if not found
      if (jobRoutes.addJobToHistory) {
        createdJob = await jobRoutes.addJobToHistory({
          type: 'export',
          name: jobConfig?.name || path.basename(actualJobPath, '.yaml'),
          status: 'running',
          username: username,
          configuration: jobConfig || {},
          message: 'Export job started',
          startedAt: new Date().toISOString(),
          filePath: actualJobPath,
          projectPath: jobConfig?.projectPath || './export',
          environment: jobConfig?.environment || 'dev',
          cliType: cliType
        });
      }
    }
    
    let result;
    let recoveryResult = null;
    
    // Route to appropriate CLI service based on cliType
    if (cliType === 'sf') {
      // Use SF CLI for custom objects export
      // Get jobConfig from createdJob if not provided
      let actualJobConfig = jobConfig;
      if (!actualJobConfig && createdJob) {
        actualJobConfig = createdJob.configuration || createdJob.config;
      }
      
      // If we still don't have jobConfig and have a jobFilePath, try to load it
      if (!actualJobConfig && actualJobPath) {
        try {
          const yamlContent = await fs.readFile(actualJobPath, 'utf8');
          actualJobConfig = yaml.parse(yamlContent);
        } catch (error) {
          logger.warn('Could not load job config from file', { jobPath: actualJobPath, error: error.message });
        }
      }
      
      if (!actualJobConfig || !actualJobConfig.queries) {
        throw new ValidationError('jobConfig with queries is required for SF CLI exports. Please ensure the job configuration includes queries.');
      }

      logger.logOperation('Using SF CLI for export', { 
        username, 
        queriesCount: actualJobConfig.queries.length,
        jobId: createdJob?.id 
      });

      result = await sfCliService.exportCustomObjects({
        username,
        projectPath: actualJobConfig.projectPath || './export',
        queries: actualJobConfig.queries,
        jobId: createdJob?.id
      });
    } else {
      // Use Vlocity CLI (existing logic)
      // Run export with recovery if enabled
      if (enableRecovery) {
        // Run iterative recovery
        recoveryResult = await exportRecoveryService.runIterativeRecovery(
          username,
          actualJobPath,
          createdJob?.id,
          {
            maxIterations: maxRecoveryIterations,
            projectPath: jobConfig?.projectPath
          }
        );
        
        result = {
          success: recoveryResult.success,
          message: `Export completed with recovery (${recoveryResult.iterations} iterations, ${recoveryResult.recoveredIds} IDs recovered)`,
          recovery: recoveryResult
        };
      } else {
        // Run export based on selected command
        if (exportCommand === 'packExportAllDefault') {
          // Use packExportAllDefault command
          logger.logOperation('Using packExportAllDefault command', { username, jobId: createdJob?.id });
          result = await vlocityCommandsService.packExportAllDefault(
            username,
            actualJobPath,
            createdJob?.id
          );
        } else if (exportCommand === 'packExportSingle') {
          // packExportSingle requires type and id - check if job config has them
          let jobConfigData = jobConfig;
          if (!jobConfigData && actualJobPath) {
            try {
              const yamlContent = await fs.readFile(actualJobPath, 'utf8');
              jobConfigData = yaml.parse(yamlContent);
            } catch (error) {
              logger.warn('Could not load job config from file', { jobPath: actualJobPath, error: error.message });
            }
          }
          if (!jobConfigData?.type || !jobConfigData?.id) {
            throw new ValidationError('packExportSingle requires type and id in job configuration. Use packExport or packExportAllDefault instead.');
          }
          logger.logOperation('Using packExportSingle command', { username, type: jobConfigData.type, id: jobConfigData.id, jobId: createdJob?.id });
          result = await vlocityCommandsService.packExportSingle(
            username,
            actualJobPath,
            jobConfigData.type,
            jobConfigData.id,
            jobConfigData.depth || null,
            createdJob?.id
          );
        } else {
          // Default: packExport (standard export with queries)
          logger.logOperation('Using packExport command (standard)', { username, jobId: createdJob?.id });
          result = await vlocityService.exportDataPacks(
            username, 
            actualJobPath,
            createdJob?.id
          );
        }
        
        // Check for errors and suggest recovery (only for packExport)
        if (exportCommand === 'packExport' && await errorLogParser.hasErrors()) {
          const errorAnalysis = await errorLogParser.parseVlocityErrors();
          if (errorAnalysis.missingIds.length > 0) {
            result.warning = `Export completed but ${errorAnalysis.missingIds.length} missing dependencies detected. Consider enabling recovery mode.`;
            result.missingIds = errorAnalysis.missingIds.length;
          }
        }
      }
    }
    
    // Preserve build artifacts (VlocityBuildLog.yaml + VlocityBuildErrors.log) per job
    if (createdJob) {
      await buildLogParser.preserveJobArtifacts(createdJob.id, JOB_LOGS_DIR);
    }

    // Update job status to completed (don't create a new job)
    if (createdJob) {
      await jobHistoryService.completeJob(createdJob.id, result, result.success);
    }
    
    logger.logOperation('Export completed', { 
      username, 
      jobPath: actualJobPath,
      success: result.success,
      enableRecovery,
      recoveryIterations: recoveryResult?.iterations
    });

    res.json({
      success: true,
      result,
      username,
      jobPath: actualJobPath,
      enableRecovery,
      recovery: recoveryResult,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Categorize error using Vlocity Error Handler
    const categorizedError = await vlocityErrorHandler.categorizeError(error, {
      operation: 'export',
      username,
      jobPath: actualJobPath
    });

    // Preserve build artifacts even on failure (partial exports still generate logs)
    if (createdJob) {
      await buildLogParser.preserveJobArtifacts(createdJob.id, JOB_LOGS_DIR);
    }

    // Update job status to failed (don't overwrite intentional aborts)
    if (createdJob) {
      if (error.code === 'JOB_ABORTED') {
        await jobHistoryService.abortJob(createdJob.id, categorizedError.sanitizedMessage || 'Export job aborted by user');
      } else {
        await jobHistoryService.addJobError(createdJob.id, categorizedError.sanitizedMessage);
        await jobHistoryService.completeJob(createdJob.id, null, false);
      }
    }
    
    logger.logError(error, { 
      operation: 'runExport', 
      username, 
      jobPath: actualJobPath,
      category: categorizedError.category,
      autoRecoverable: categorizedError.autoRecoverable,
      sanitizedMessage: categorizedError.sanitizedMessage
    });
    
    // Check if it's an authentication error
    if (error.authError || categorizedError.category === 'PermissionError') {
      const authErrorResponse = {
        success: false,
        error: {
          message: categorizedError.sanitizedMessage,
          authError: true,
          reloginInfo: error.authError,
          category: categorizedError.category
        },
        timestamp: new Date().toISOString()
      };
      return res.status(401).json(authErrorResponse);
    }
    
    throw error;
  }
}));

// Saved jobs, templates and JSON-file tools: ./exports/
router.use(require('./exports/jobs'));
router.use(require('./exports/templates'));
router.use(require('./exports/jsonFiles'));

module.exports = router;
