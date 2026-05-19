const express = require('express');
const router = express.Router();
const vlocityService = require('../services/vlocityService');
const getVlocityCommandsService = require('../services/vlocityCommandsService');
const { asyncHandler, NotFoundError, ValidationError } = require('../middleware/errorHandler');
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
const jobExecutionService = require('../services/jobExecutionService');
const exportRecoveryService = require('../services/exportRecoveryService');
const errorLogParser = require('../services/errorLogParser');
const buildLogParser = require('../services/buildLogParser');
const preflightService = require('../services/preflightService');
const vlocityErrorHandler = require('../services/vlocityErrorHandler');
const dataPackFileFixer = require('../services/dataPackFileFixer');
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
    jobConfig,
    enableRecovery = true,        // default ON — dependency errors are the main export failure mode
    maxRecoveryIterations = 10,
    useDependencyOrder = true,    // sort queries by known DataPack type dependency tiers
    cliType: requestCliType,
    exportCommand = 'packExport'
  } = req.body;

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

/**
 * @swagger
 * /api/exports/jobs:
 *   get:
 *     operationId: listExportJobs
 *     summary: List export jobs
 *     description: Returns a paginated list of export job records from the database, ordered most-recent first.
 *     tags:
 *       - Export Jobs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number (1-based).
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 25
 *         description: Number of jobs per page.
 *     responses:
 *       200:
 *         description: Export jobs retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 jobs:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Job'
 *                 count:
 *                   type: integer
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *                 totalPages:
 *                   type: integer
 *                 hasMore:
 *                   type: boolean
 *                 timestamp:
 *                   type: string
 *                   format: date-time
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
router.get('/jobs', asyncHandler(async (req, res) => {
  // Read export jobs from database instead of file system
  const { Job } = require('../models');
  
  // Pagination parameters
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 25;
  const offset = (page - 1) * limit;
  
  // Get total count
  const totalCount = await Job.count({
    where: { type: 'export' }
  });
  
  // Get paginated jobs
  const jobs = await Job.findAll({
    where: { type: 'export' },
    order: [['createdAt', 'DESC']],
    limit: limit,
    offset: offset,
    attributes: [
      'id',
      'name',
      'status',
      'username',
      'filePath',
      'projectPath',
      'environment',
      'configuration',
      'createdAt',
      'updatedAt',
      'startedAt',
      'completedAt',
      'duration',
      'progress'
    ]
  });

  // Transform to match expected format
  const transformedJobs = jobs.map(job => ({
    id: job.id,
    name: job.name,
    path: job.filePath,
    status: job.status,
    username: job.username,
    projectPath: job.projectPath,
    environment: job.environment,
    configuration: job.configuration,
    createdAt: job.createdAt,
    modifiedAt: job.updatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    duration: job.duration,
    progress: job.progress
  }));

  res.json({
    jobs: transformedJobs,
    count: transformedJobs.length,
    total: totalCount,
    page: page,
    limit: limit,
    totalPages: Math.ceil(totalCount / limit),
    hasMore: offset + transformedJobs.length < totalCount,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/exports/jobs/{jobName}:
 *   get:
 *     operationId: getExportJob
 *     summary: Get export job details
 *     description: Reads and returns the YAML configuration for a specific saved export job file.
 *     tags:
 *       - Export Jobs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobName
 *         required: true
 *         schema:
 *           type: string
 *         description: Filename of the export job (e.g. `MyExport.yaml`).
 *     responses:
 *       200:
 *         description: Export job details retrieved.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 jobName:
 *                   type: string
 *                 jobType:
 *                   type: string
 *                   enum: [saved, temp]
 *                 jobPath:
 *                   type: string
 *                 config:
 *                   type: object
 *                 stats:
 *                   type: object
 *                   properties:
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     modifiedAt:
 *                       type: string
 *                       format: date-time
 *                     size:
 *                       type: integer
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Export job not found.
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
router.get('/jobs/:jobName', asyncHandler(async (req, res) => {
  const { jobName } = req.params;
  
  // Only look in jobs directory (no temp)
  const jobsPath = path.join(__dirname, '../../jobs', jobName);
  
  if (!await fs.pathExists(jobsPath)) {
    throw new NotFoundError(`Export job '${jobName}' not found`);
  }

  try {
    const jobContent = await fs.readFile(jobsPath, 'utf8');
    const jobConfig = yaml.parse(jobContent);
    const stats = await fs.stat(jobsPath);

    res.json({
      success: true,
      jobName,
      jobType: 'saved',
      jobPath: jobsPath,
      config: jobConfig,
      stats: {
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
        size: stats.size,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.logError(error, { operation: 'getExportJob', jobName, jobPath: jobsPath });
    throw error;
  }
}));

/**
 * @swagger
 * /api/exports/jobs/{jobName}:
 *   put:
 *     operationId: updateExportJob
 *     summary: Update an export job
 *     description: Overwrites the YAML job file and/or the database record for the named export job. Validates the configuration before saving (Vlocity CLI only).
 *     tags:
 *       - Export Jobs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobName
 *         required: true
 *         schema:
 *           type: string
 *         description: URL-encoded filename of the export job (e.g. `My%20Export.yaml`).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Updated job configuration. All fields are optional; supply only those you want to change.
 *     responses:
 *       200:
 *         description: Export job updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                 jobName:
 *                   type: string
 *                 jobType:
 *                   type: string
 *                 config:
 *                   type: object
 *                 cliType:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Configuration validation failed.
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
 *       404:
 *         description: Export job not found.
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
router.put('/jobs/:jobName', asyncHandler(async (req, res) => {
  // Decode job name from URL (handles special characters like spaces, commas, etc.)
  const { jobName: encodedJobName } = req.params;
  const jobName = decodeURIComponent(encodedJobName);
  const jobConfig = req.body;
  
  // Ensure cliType is in the job configuration
  const cliType = jobConfig.cliType || 'vlocity';
  jobConfig.cliType = cliType;
  
  const tempPath = path.join(__dirname, '../temp', jobName);
  const jobsPath = path.join(__dirname, '../jobs', jobName);
  
  let jobPath = null;
  let jobType = null;

  if (await fs.pathExists(tempPath)) {
    jobPath = tempPath;
    jobType = 'temp';
  } else if (await fs.pathExists(jobsPath)) {
    jobPath = jobsPath;
    jobType = 'saved';
  }

  // Also check database record if job exists
  const { Job } = require('../models');
  const dbJob = await Job.findOne({
    where: {
      name: jobName,
      type: 'export'
    }
  });

  // If job doesn't exist in file system or database, throw NotFoundError
  if (!jobPath && !dbJob) {
    throw new NotFoundError(`Export job '${jobName}' not found`);
  }

  try {
    // Validate job configuration (only for Vlocity CLI jobs that use YAML files)
    if (jobPath && cliType === 'vlocity') {
      const yamlConfigService = require('../services/yamlConfigService');
      const validation = yamlConfigService.validateConfig(jobConfig);
      if (!validation.valid) {
        throw new ValidationError(`Configuration validation failed: ${validation.errors.join(', ')}`);
      }
      // Update the job file (only for Vlocity CLI)
      await vlocityService.createJobFile(jobConfig, jobPath);
    }

    // Update database record if it exists
    if (dbJob) {
      dbJob.configuration = jobConfig;
      dbJob.cliType = cliType;
      // Update other fields from config
      if (jobConfig.projectPath) dbJob.projectPath = jobConfig.projectPath;
      if (jobConfig.username) dbJob.username = jobConfig.username;
      await dbJob.save();
      logger.logOperation('Export job updated in database', { 
        jobId: dbJob.id,
        jobName, 
        cliType
      });
    }
    
    logger.logOperation('Export job updated', { 
      jobName, 
      jobType,
      jobPath,
      cliType,
      dbUpdated: !!dbJob
    });

    res.json({
      success: true,
      message: `Export job '${jobName}' updated successfully`,
      jobName,
      jobType,
      config: jobConfig,
      cliType: cliType,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.logError(error, { operation: 'updateExportJob', jobName, jobPath });
    throw error;
  }
}));

/**
 * @swagger
 * /api/exports/jobs/{jobName}/abort:
 *   post:
 *     operationId: abortExportJob
 *     summary: Abort a running export job
 *     description: Looks up the running or pending export job by name and requests it to stop.
 *     tags:
 *       - Export Jobs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobName
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the export job to abort.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Human-readable reason for aborting.
 *     responses:
 *       200:
 *         description: Export job aborted successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                 job:
 *                   $ref: '#/components/schemas/Job'
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Export job not found.
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
router.post('/jobs/:jobName/abort', asyncHandler(async (req, res) => {
  const { jobName } = req.params;
  const { reason } = req.body;
  
  // For export jobs, we need to find the job in the job history by name
  // and abort it using the job ID
  try {
    const jobHistoryService = require('../services/jobHistoryService');
    
    // Find the job by name in the job history
    const jobs = await jobHistoryService.getJobHistory(1000, 0, { type: 'export' });
    const job = jobs.jobs.find(j => j.name === jobName);
    
    if (!job) {
      throw new NotFoundError(`Export job '${jobName}' not found`);
    }
    
    // Check if job is in a state that can be aborted
    if (job.status !== 'running' && job.status !== 'pending') {
      throw new Error(`Cannot abort job '${jobName}': job has already ${job.status === 'completed' ? 'completed' : job.status === 'failed' ? 'failed' : 'been aborted'}. Only running or pending jobs can be aborted.`);
    }
    
    await jobExecutionService.abortJob(job.id, reason || 'Export job aborted by user');
    const abortedJob = await jobHistoryService.abortJob(job.id, reason || 'Export job aborted by user');
    
    res.json({
      success: true,
      message: `Export job '${jobName}' aborted successfully`,
      job: abortedJob,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.logError(error, { operation: 'abortExportJob', jobName });
    throw error;
  }
}));

/**
 * @swagger
 * /api/exports/jobs/{jobName}:
 *   delete:
 *     operationId: deleteExportJob
 *     summary: Delete an export job
 *     description: Removes the YAML job file from disk. The corresponding database record is NOT deleted.
 *     tags:
 *       - Export Jobs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobName
 *         required: true
 *         schema:
 *           type: string
 *         description: Filename of the export job to delete (e.g. `MyExport.yaml`).
 *     responses:
 *       200:
 *         description: Export job deleted successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                 jobName:
 *                   type: string
 *                 jobType:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Export job not found.
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
router.delete('/jobs/:jobName', asyncHandler(async (req, res) => {
  const { jobName } = req.params;
  
  const tempPath = path.join(__dirname, '../temp', jobName);
  const jobsPath = path.join(__dirname, '../jobs', jobName);
  
  let jobPath = null;
  let jobType = null;

  if (await fs.pathExists(tempPath)) {
    jobPath = tempPath;
    jobType = 'temp';
  } else if (await fs.pathExists(jobsPath)) {
    jobPath = jobsPath;
    jobType = 'saved';
  } else {
    throw new NotFoundError(`Export job '${jobName}' not found`);
  }

  try {
    await fs.remove(jobPath);
    
    logger.logOperation('Export job deleted', { jobName, jobType, jobPath });

    res.json({
      success: true,
      message: `Export job '${jobName}' deleted successfully`,
      jobName,
      jobType,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.logError(error, { operation: 'deleteExportJob', jobName, jobPath });
    throw error;
  }
}));

/**
 * @swagger
 * /api/exports/save-job:
 *   post:
 *     operationId: saveExportJob
 *     summary: Save an export job to disk
 *     description: Writes an export job YAML file to the persistent `jobs/` directory under the given name.
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
 *               - jobName
 *               - jobConfig
 *             properties:
 *               jobName:
 *                 type: string
 *                 description: Name used as the YAML filename (without extension).
 *               jobConfig:
 *                 type: object
 *                 description: Full job configuration to persist.
 *     responses:
 *       200:
 *         description: Export job saved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                 jobName:
 *                   type: string
 *                 jobPath:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: jobName or jobConfig missing.
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
router.post('/save-job', asyncHandler(async (req, res) => {
  const { jobName, jobConfig } = req.body;

  if (!jobName || !jobConfig) {
    throw new ValidationError('jobName and jobConfig are required');
  }

  const jobsDir = path.join(__dirname, '../jobs');
  await fs.ensureDir(jobsDir);
  
  const jobPath = path.join(jobsDir, `${jobName}.yaml`);

  try {
    await vlocityService.createJobFile(jobConfig, jobPath);
    
    logger.logOperation('Export job saved', { jobName, jobPath });

    res.json({
      success: true,
      message: `Export job '${jobName}' saved successfully`,
      jobName,
      jobPath,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.logError(error, { operation: 'saveExportJob', jobName, jobConfig });
    throw error;
  }
}));

/**
 * @swagger
 * /api/exports/templates:
 *   get:
 *     operationId: getExportTemplates
 *     summary: Get export job templates
 *     description: Returns a set of pre-built export job configuration templates (e.g. Full Catalog Export) that can be used as a starting point for new jobs.
 *     tags:
 *       - Export Jobs
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Templates retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 templates:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       description:
 *                         type: string
 *                       config:
 *                         type: object
 *                 timestamp:
 *                   type: string
 *                   format: date-time
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
router.get('/templates', asyncHandler(async (req, res) => {
  const templates = [
    {
      name: 'Full Catalog Export',
      description: 'All standalone Vlocity DataPack types in dependency order. Sub-objects (CatalogProductRelationship, PriceListEntry, ProductChildItem, PromotionItem, PricingElement) are excluded — they are exported automatically as part of their parent type. Remove any type that does not exist in your org, or add WHERE clauses to filter records.',
      config: {
        name: 'Full Catalog Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          // ── Tier 1: No dependencies ────────────────────────────────────────────
          // No query needed — the CLI uses its built-in default query for each DataPack type.
          // Add a query field only if you need a custom WHERE clause or field selection.
          { VlocityDataPackType: 'AttributeAssignmentRule' },
          { VlocityDataPackType: 'AttributeCategory' },
          { VlocityDataPackType: 'CalculationMatrix' },
          { VlocityDataPackType: 'CalculationProcedure' },
          { VlocityDataPackType: 'ContextAction' },
          { VlocityDataPackType: 'ContextDimension' },
          { VlocityDataPackType: 'ContextScope' },
          { VlocityDataPackType: 'ContractType' },
          { VlocityDataPackType: 'CpqConfigurationSetup' },
          { VlocityDataPackType: 'DataRaptor', query: 'SELECT Id FROM vlocity_cmt__DRBundle__c WHERE vlocity_cmt__Type__c != \'Migration\'' },
          { VlocityDataPackType: 'DocumentClause' },
          { VlocityDataPackType: 'DocumentTemplate' },
          { VlocityDataPackType: 'EntityFilter' },
          { VlocityDataPackType: 'IntegrationRetryPolicy' },
          { VlocityDataPackType: 'InterfaceImplementation' },
          { VlocityDataPackType: 'ItemImplementation' },
          { VlocityDataPackType: 'ManualQueue' },
          { VlocityDataPackType: 'ObjectClass' },
          { VlocityDataPackType: 'ObjectContextRule' },
          { VlocityDataPackType: 'ObjectLayout' },
          { VlocityDataPackType: 'OfferMigrationPlan' },
          { VlocityDataPackType: 'OrchestrationDependencyDefinition' },
          { VlocityDataPackType: 'OrchestrationItemDefinition' },
          { VlocityDataPackType: 'OrchestrationPlanDefinition' },
          { VlocityDataPackType: 'PriceList' },
          { VlocityDataPackType: 'PricingPlan' },
          { VlocityDataPackType: 'PricingVariable' },
          { VlocityDataPackType: 'QueryBuilder' },
          { VlocityDataPackType: 'Rule' },
          { VlocityDataPackType: 'StoryObjectConfiguration' },
          { VlocityDataPackType: 'String' },
          { VlocityDataPackType: 'System' },
          { VlocityDataPackType: 'TimePlan' },
          { VlocityDataPackType: 'TimePolicy' },
          { VlocityDataPackType: 'UIFacet' },
          { VlocityDataPackType: 'UISection' },
          { VlocityDataPackType: 'VlocityAction' },
          { VlocityDataPackType: 'VlocityAttachment' },
          { VlocityDataPackType: 'VlocityCard' },
          { VlocityDataPackType: 'VlocityFunction' },
          { VlocityDataPackType: 'VlocityPicklist' },
          { VlocityDataPackType: 'VlocitySearchWidgetSetup' },
          { VlocityDataPackType: 'VlocityStateModel' },
          { VlocityDataPackType: 'VlocityUILayout' },
          { VlocityDataPackType: 'VlocityUITemplate' },
          { VlocityDataPackType: 'VqMachine' },
          { VlocityDataPackType: 'VqResource' },
          { VlocityDataPackType: 'IntegrationProcedure' },
          { VlocityDataPackType: 'OmniScript' },
          { VlocityDataPackType: 'Catalog' },
          { VlocityDataPackType: 'Promotion' },
          { VlocityDataPackType: 'SObject' },
          { VlocityDataPackType: 'SObject', query: 'SELECT Id FROM Product2 WHERE GT_IsTechnicalProduct__c = false' }
        ]
      }
    },
    {
      name: 'Blank',
      description: 'Empty template — start from scratch. Add only the DataPack types you need with custom SOQL filters.',
      config: {
        name: 'Custom Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          { VlocityDataPackType: 'SObject', query: 'SELECT Id FROM Product2' }
        ]
      }
    },
    {
      name: 'Product Catalog Export',
      description: 'Export product catalog and related objects. Optional: Add WHERE vlocity_cmt__Code__c = \'{PRICELIST_CODE}\' to PriceList queries to filter by specific PriceList. Objects follow the standard order.',
      config: {
        name: 'Product Catalog Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            comment: 'PriceList-Agnostic: Pricebook2',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM Pricebook2'
          },
          {
            comment: 'PriceList-Agnostic: Product2',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM Product2 WHERE LastModifiedDate >= 2025-01-01T00:00:00.000+0000 AND GT_IsTechnicalProduct__c = false'
          },
          {
            comment: 'PriceList-Agnostic: GT ProductSKUs',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id, GT_GlobalKey__c, CurrencyIsoCode, GT_ProductSKU__c, GT_Color__c, GT_OrganizationCode__c, GT_ProductName_Text__c, GT_LifeCycle__c, GT_ProductUse__c, Product__c, Product__r.vlocity_cmt__GlobalKey__c FROM GT_ProductSKU__c WHERE GT_GlobalKey__c != null'
          },
          {
            comment: 'PriceList-Agnostic: GT RateTables',
            VlocityDataPackType: 'RateTable',
            query: 'SELECT Id, GT_GlobalKey__c, CurrencyIsoCode, GT_EndDate__c, GT_OrgCode__c, GT_ProductName_Text__c, GT_RateCode__c, GT_RateCode__r.GT_GlobalKey__c, Product__c, Product__r.vlocity_cmt__GlobalKey__c, GT_StartDate__c, GT_UniqueKey__c, GT_VATType__c FROM GT_RateTable__c'
          },
          {
            comment: 'PriceList-Linked: PriceList (all or filter by adding WHERE vlocity_cmt__Code__c = \'{PRICELIST_CODE}\')',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PriceList__c'
          },
          {
            comment: 'PriceList-Agnostic: PricingVariables',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PricingVariable__c'
          },
          {
            comment: 'PriceList-Linked: PricingElements (all or filter by adding WHERE vlocity_cmt__PriceListId__r.vlocity_cmt__Code__c = \'{PRICELIST_CODE}\')',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PricingElement__c WHERE LastModifiedDate >= 2025-01-01T00:00:00.000+0000'
          },
          {
            comment: 'PriceList-Linked: PriceListEntry (all or filter by adding WHERE vlocity_cmt__PriceListId__r.vlocity_cmt__Code__c = \'{PRICELIST_CODE}\')',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PriceListEntry__c'
          },
          {
            comment: 'PriceList-Agnostic: Pricebook entries',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM PricebookEntry'
          },
          {
            comment: 'PriceList-Agnostic: PricingPlans',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PricingPlan__c'
          },
          {
            comment: 'PriceList-Agnostic: Promotions',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Promotion__c'
          },
          {
            comment: 'PriceList-Agnostic: Rules',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Rule__c'
          },
          {
            comment: 'PriceList-Agnostic: CatalogProductRelationship',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id, vlocity_cmt__CatalogId__c, vlocity_cmt__Product2Id__c, vlocity_cmt__Product2Id__r.vlocity_cmt__GlobalKey__c, vlocity_cmt__CatalogId__r.vlocity_cmt__GlobalKey__c FROM vlocity_cmt__CatalogProductRelationship__c'
          },
          {
            comment: 'PriceList-Agnostic: ObjectClass',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__ObjectClass__c'
          },
          {
            comment: 'PriceList-Agnostic: Attribute',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Attribute__c'
          },
          {
            comment: 'PriceList-Agnostic: AttributeCategories',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__AttributeCategory__c WHERE LastModifiedDate >= 2025-01-01T00:00:00.000+0000'
          },
          {
            comment: 'PriceList-Agnostic: AttributeAssignment',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__AttributeAssignment__c'
          },
          {
            comment: 'PriceList-Agnostic: UIFacet',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__UIFacet__c'
          },
          {
            comment: 'PriceList-Agnostic: UISection',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__UISection__c'
          },
          {
            comment: 'PriceList-Agnostic: ObjectLayout',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__ObjectLayout__c'
          },
          {
            comment: 'PriceList-Agnostic: Picklist',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Picklist__c'
          },
          {
            comment: 'PriceList-Agnostic: CalculationMatrix',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__CalculationMatrix__c'
          }
        ]
      }
    },
    {
      name: 'Pricing Complete Export',
      description: 'Export all pricing-related objects. Optional: Add WHERE vlocity_cmt__Code__c = \'{PRICELIST_CODE}\' to PriceList queries to filter by specific PriceList. Objects follow the standard order: PriceList-Agnostic first, then PriceList-Linked.',
      config: {
        name: 'Pricing Complete Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            comment: 'PriceList-Agnostic: Pricebook2',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM Pricebook2'
          },
          {
            comment: 'PriceList-Agnostic: Product2 (shared products)',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM Product2 WHERE GT_IsTechnicalProduct__c = false'
          },
          {
            comment: 'PriceList-Agnostic: GT ProductSKUs',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id, GT_GlobalKey__c, CurrencyIsoCode, GT_ProductSKU__c, GT_Color__c, GT_OrganizationCode__c, GT_ProductName_Text__c, GT_LifeCycle__c, GT_ProductUse__c, Product__c, Product__r.vlocity_cmt__GlobalKey__c FROM GT_ProductSKU__c WHERE GT_GlobalKey__c != null'
          },
          {
            comment: 'PriceList-Agnostic: GT RateTables',
            VlocityDataPackType: 'RateTable',
            query: 'SELECT Id, GT_GlobalKey__c, CurrencyIsoCode, GT_EndDate__c, GT_OrgCode__c, GT_ProductName_Text__c, GT_RateCode__c, GT_RateCode__r.GT_GlobalKey__c, Product__c, Product__r.vlocity_cmt__GlobalKey__c, GT_StartDate__c, GT_UniqueKey__c, GT_VATType__c FROM GT_RateTable__c'
          },
          {
            comment: 'PriceList-Linked: PriceList (all or filter by adding WHERE vlocity_cmt__Code__c = \'{PRICELIST_CODE}\')',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PriceList__c'
          },
          {
            comment: 'PriceList-Agnostic: PricingVariables',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PricingVariable__c'
          },
          {
            comment: 'PriceList-Linked: PricingElements (all or filter by adding WHERE vlocity_cmt__PriceListId__r.vlocity_cmt__Code__c = \'{PRICELIST_CODE}\')',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PricingElement__c'
          },
          {
            comment: 'PriceList-Linked: PriceListEntry (all or filter by adding WHERE vlocity_cmt__PriceListId__r.vlocity_cmt__Code__c = \'{PRICELIST_CODE}\')',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PriceListEntry__c'
          },
          {
            comment: 'PriceList-Agnostic: Pricebook entries',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM PricebookEntry'
          },
          {
            comment: 'PriceList-Agnostic: PricingPlans',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PricingPlan__c'
          },
          {
            comment: 'PriceList-Agnostic: Promotions',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Promotion__c'
          },
          {
            comment: 'PriceList-Agnostic: Rules',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Rule__c'
          },
          {
            comment: 'PriceList-Agnostic: CatalogProductRelationship',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id, vlocity_cmt__CatalogId__c, vlocity_cmt__Product2Id__c, vlocity_cmt__Product2Id__r.vlocity_cmt__GlobalKey__c, vlocity_cmt__CatalogId__r.vlocity_cmt__GlobalKey__c FROM vlocity_cmt__CatalogProductRelationship__c'
          },
          {
            comment: 'PriceList-Agnostic: ObjectClass',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__ObjectClass__c'
          },
          {
            comment: 'PriceList-Agnostic: Attribute',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Attribute__c'
          },
          {
            comment: 'PriceList-Agnostic: AttributeCategories',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__AttributeCategory__c'
          },
          {
            comment: 'PriceList-Agnostic: AttributeAssignment',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__AttributeAssignment__c'
          },
          {
            comment: 'PriceList-Agnostic: UIFacet',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__UIFacet__c'
          },
          {
            comment: 'PriceList-Agnostic: UISection',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__UISection__c'
          },
          {
            comment: 'PriceList-Agnostic: ObjectLayout',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__ObjectLayout__c'
          },
          {
            comment: 'PriceList-Agnostic: Picklist',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Picklist__c'
          },
          {
            comment: 'PriceList-Agnostic: CalculationMatrix',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__CalculationMatrix__c'
          }
        ]
      }
    },
    {
      name: 'PriceList Filtered Export',
      description: 'Export pricing objects filtered by a specific PriceList. Replace {PRICELIST_CODE} with the actual PriceList code (e.g., \'PL-FM-AU-001-060\'). Objects are grouped into: (1) PriceList-Agnostic objects that are included but not filtered, and (2) PriceList-Linked objects that are filtered by the selected PriceList.',
      config: {
        name: 'PriceList Filtered Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            comment: 'PriceList-Agnostic: Pricebook2',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM Pricebook2'
          },
          {
            comment: 'PriceList-Agnostic: Product2',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM Product2 WHERE GT_IsTechnicalProduct__c = false'
          },
          {
            comment: 'PriceList-Linked: The selected PriceList itself',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PriceList__c WHERE vlocity_cmt__Code__c = \'{PRICELIST_CODE}\''
          },
          {
            comment: 'PriceList-Agnostic: PricingVariables',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PricingVariable__c'
          },
          {
            comment: 'PriceList-Linked: Pricing Elements directly linked via vlocity_cmt__PriceListId__c',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PricingElement__c WHERE vlocity_cmt__PriceListId__r.vlocity_cmt__Code__c = \'{PRICELIST_CODE}\''
          },
          {
            comment: 'PriceList-Linked: PriceList entries directly linked via vlocity_cmt__PriceListId__c',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PriceListEntry__c WHERE vlocity_cmt__PriceListId__r.vlocity_cmt__Code__c = \'{PRICELIST_CODE}\''
          },
          {
            comment: 'PriceList-Agnostic: Pricebook entries',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM PricebookEntry'
          },
          {
            comment: 'PriceList-Agnostic: PricingPlans',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PricingPlan__c'
          },
          {
            comment: 'PriceList-Agnostic: Promotions',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Promotion__c'
          },
          {
            comment: 'PriceList-Agnostic: Rules',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Rule__c'
          },
          {
            comment: 'PriceList-Agnostic: CatalogProductRelationship',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__CatalogProductRelationship__c'
          },
          {
            comment: 'PriceList-Agnostic: ObjectClass',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__ObjectClass__c'
          },
          {
            comment: 'PriceList-Agnostic: Attribute',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Attribute__c'
          },
          {
            comment: 'PriceList-Agnostic: AttributeCategories',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__AttributeCategory__c'
          },
          {
            comment: 'PriceList-Agnostic: AttributeAssignment',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__AttributeAssignment__c'
          },
          {
            comment: 'PriceList-Agnostic: UIFacet',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__UIFacet__c'
          },
          {
            comment: 'PriceList-Agnostic: UISection',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__UISection__c'
          },
          {
            comment: 'PriceList-Agnostic: ObjectLayout',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__ObjectLayout__c'
          },
          {
            comment: 'PriceList-Agnostic: Picklist',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Picklist__c'
          },
          {
            comment: 'PriceList-Agnostic: CalculationMatrix',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__CalculationMatrix__c'
          }
        ]
      }
    },
    {
      name: 'PriceList Unfiltered Export',
      description: 'Export all pricing objects without PriceList filtering. This template includes all PriceList-Agnostic objects and can be used as a base for unfiltered exports.',
      config: {
        name: 'PriceList Unfiltered Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            comment: 'PriceList-Agnostic: Pricebook2',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM Pricebook2'
          },
          {
            comment: 'PriceList-Agnostic: Product2',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM Product2 WHERE GT_IsTechnicalProduct__c = false'
          },
          {
            comment: 'PriceList-Linked: PriceList (all price lists)',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PriceList__c'
          },
          {
            comment: 'PriceList-Agnostic: PricingVariables',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PricingVariable__c'
          },
          {
            comment: 'PriceList-Linked: PricingElements (all pricing elements)',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PricingElement__c'
          },
          {
            comment: 'PriceList-Linked: PriceListEntry (all price list entries)',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PriceListEntry__c'
          },
          {
            comment: 'PriceList-Agnostic: Pricebook entries',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM PricebookEntry'
          },
          {
            comment: 'PriceList-Agnostic: PricingPlans',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PricingPlan__c'
          },
          {
            comment: 'PriceList-Agnostic: Promotions',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Promotion__c'
          },
          {
            comment: 'PriceList-Agnostic: Rules',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Rule__c'
          },
          {
            comment: 'PriceList-Agnostic: CatalogProductRelationship',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__CatalogProductRelationship__c'
          },
          {
            comment: 'PriceList-Agnostic: ObjectClass',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__ObjectClass__c'
          },
          {
            comment: 'PriceList-Agnostic: Attribute',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Attribute__c'
          },
          {
            comment: 'PriceList-Agnostic: AttributeCategories',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__AttributeCategory__c'
          },
          {
            comment: 'PriceList-Agnostic: AttributeAssignment',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__AttributeAssignment__c'
          },
          {
            comment: 'PriceList-Agnostic: UIFacet',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__UIFacet__c'
          },
          {
            comment: 'PriceList-Agnostic: UISection',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__UISection__c'
          },
          {
            comment: 'PriceList-Agnostic: ObjectLayout',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__ObjectLayout__c'
          },
          {
            comment: 'PriceList-Agnostic: Picklist',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Picklist__c'
          },
          {
            comment: 'PriceList-Agnostic: CalculationMatrix',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__CalculationMatrix__c'
          }
        ]
      }
    },
    {
      name: 'GT Custom Objects Export',
      description: 'Export all GT custom objects (Products, SKUs, Rates) using Salesforce CLI',
      config: {
        name: 'GT Custom Objects Export',
        cliType: 'sf', // Use SF CLI for custom objects
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            name: "Extract RateCodes",
            object: "GT_RateCode__c",
            soql_query: "SELECT Id, GT_GlobalKey__c, GT_OrgCode__c, GT_VATCode__c, GT_VATRate__c, GT_VATDescription__c, GT_StartDate__c, GT_EndDate__c, CurrencyIsoCode FROM GT_RateCode__c",
            external_key: "GT_GlobalKey__c",
            target_object: "GT_RateCode__c"
          },
          {
            name: "Extract RateTable",
            object: "GT_RateTable__c",
            soql_query: "SELECT Id, GT_GlobalKey__c, CurrencyIsoCode, GT_EndDate__c, GT_OrgCode__c, GT_ProductName_Text__c, GT_RateCode__c, GT_RateCode__r.GT_GlobalKey__c, Product__c, Product__r.vlocity_cmt__GlobalKey__c, GT_StartDate__c, GT_UniqueKey__c, GT_VATType__c FROM GT_RateTable__c",
            external_key: "GT_GlobalKey__c",
            target_object: "GT_RateTable__c"
          },
          {
            name: "Extract ProductSKUs",
            object: "GT_ProductSKU__c",
            soql_query: "SELECT Id, GT_GlobalKey__c, CurrencyIsoCode, GT_ProductSKU__c, GT_Color__c, GT_OrganizationCode__c, GT_ProductName_Text__c, GT_LifeCycle__c, GT_ProductUse__c, Product__c, Product__r.vlocity_cmt__GlobalKey__c FROM GT_ProductSKU__c",
            external_key: "GT_GlobalKey__c",
            target_object: "GT_ProductSKU__c"
          },
          {
            name: "Extract CatalogProductRelationships",
            object: "vlocity_cmt__CatalogProductRelationship__c",
            soql_query: "SELECT Id, vlocity_cmt__CatalogId__c, vlocity_cmt__Product2Id__c, vlocity_cmt__Product2Id__r.vlocity_cmt__GlobalKey__c, vlocity_cmt__CatalogId__r.vlocity_cmt__GlobalKey__c FROM vlocity_cmt__CatalogProductRelationship__c"
          }
        ]
      }
    },
    {
      name: 'Attributes & Categories Export',
      description: 'Export all attribute categories and assignments',
      config: {
        name: 'Attributes & Categories Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            VlocityDataPackType: 'AttributeCategory',
            query: 'SELECT Id, Name, vlocity_cmt__Code__c FROM vlocity_cmt__AttributeCategory__c'
          },
          {
            VlocityDataPackType: 'AttributeAssignmentRule',
            query: 'SELECT Id, Name FROM vlocity_cmt__AttributeAssignmentRule__c'
          }
        ]
      }
    },
    {
      name: 'Calculation Matrix & Procedures Export',
      description: 'Export all calculation matrices and procedures',
      config: {
        name: 'Calculation Matrix & Procedures Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            VlocityDataPackType: 'CalculationMatrix',
            query: 'SELECT Id, Name FROM vlocity_cmt__CalculationMatrix__c'
          },
          {
            VlocityDataPackType: 'CalculationProcedure',
            query: 'SELECT Id, Name FROM vlocity_cmt__CalculationProcedure__c'
          }
        ]
      }
    },
    {
      name: 'OmniScript Export',
      description: 'Export all OmniScripts and Integration Procedures',
      config: {
        name: 'OmniScript Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            VlocityDataPackType: 'OmniScript',
            query: 'SELECT Id, vlocity_cmt__Type__c, vlocity_cmt__SubType__c, vlocity_cmt__Language__c FROM vlocity_cmt__OmniScript__c WHERE vlocity_cmt__IsActive__c = true AND vlocity_cmt__IsProcedure__c = false'
          },
          {
            VlocityDataPackType: 'IntegrationProcedure',
            query: 'SELECT Id, vlocity_cmt__Type__c, vlocity_cmt__SubType__c, vlocity_cmt__Language__c FROM vlocity_cmt__OmniScript__c WHERE vlocity_cmt__IsActive__c = true AND vlocity_cmt__IsProcedure__c = true'
          }
        ]
      }
    },
    {
      name: 'DataRaptor Export',
      description: 'Export all DataRaptor transformations',
      config: {
        name: 'DataRaptor Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            VlocityDataPackType: 'DataRaptor',
            query: 'SELECT Id, Name FROM vlocity_cmt__DRBundle__c WHERE vlocity_cmt__Type__c != \'Migration\''
          }
        ]
      }
    },
    {
      name: 'FlexCard & Templates Export',
      description: 'Export all FlexCards and UI Templates',
      config: {
        name: 'FlexCard & Templates Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            VlocityDataPackType: 'VlocityCard',
            query: 'SELECT Id, Name FROM vlocity_cmt__VlocityCard__c WHERE vlocity_cmt__Active__c = true'
          },
          {
            VlocityDataPackType: 'VlocityUITemplate',
            query: 'SELECT Id, Name FROM vlocity_cmt__VlocityUITemplate__c WHERE vlocity_cmt__Active__c = true'
          },
          {
            VlocityDataPackType: 'VlocityUILayout',
            query: 'SELECT Id, Name FROM vlocity_cmt__VlocityUILayout__c'
          }
        ]
      }
    },
    {
      name: 'Document Templates & Clauses Export',
      description: 'Export all document templates and clauses',
      config: {
        name: 'Document Templates & Clauses Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            VlocityDataPackType: 'DocumentTemplate',
            query: 'SELECT Id, Name FROM vlocity_cmt__DocumentTemplate__c'
          },
          {
            VlocityDataPackType: 'DocumentClause',
            query: 'SELECT Id, Name FROM vlocity_cmt__DocumentClause__c'
          }
        ]
      }
    },
    {
      name: 'Orchestration Export',
      description: 'Export all orchestration plans, items, and dependencies',
      config: {
        name: 'Orchestration Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            VlocityDataPackType: 'OrchestrationPlanDefinition',
            query: 'SELECT Id, Name FROM vlocity_cmt__OrchestrationPlanDefinition__c'
          },
          {
            VlocityDataPackType: 'OrchestrationItemDefinition',
            query: 'SELECT Id, Name FROM vlocity_cmt__OrchestrationItemDefinition__c'
          },
          {
            VlocityDataPackType: 'OrchestrationDependencyDefinition',
            query: 'SELECT Id, Name, vlocity_cmt__GlobalKey__c FROM vlocity_cmt__OrchestrationDependencyDefinition__c'
          }
        ]
      }
    },
    {
      name: 'Rules & Object Configuration Export',
      description: 'Export all rules, object classes, and context rules',
      config: {
        name: 'Rules & Object Configuration Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            VlocityDataPackType: 'Rule',
            query: 'SELECT Id, Name, vlocity_cmt__GlobalKey__c FROM vlocity_cmt__Rule__c'
          },
          {
            VlocityDataPackType: 'ObjectClass',
            query: 'SELECT Id, Name, vlocity_cmt__GlobalKey__c FROM vlocity_cmt__ObjectClass__c'
          },
          {
            VlocityDataPackType: 'ObjectLayout',
            query: 'SELECT Id, Name, vlocity_cmt__GlobalKey__c FROM vlocity_cmt__ObjectLayout__c'
          },
          {
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id, Name, vlocity_cmt__GlobalKey__c FROM vlocity_cmt__ObjectSection__c'
          },
          {
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id, Name, vlocity_cmt__GlobalKey__c FROM vlocity_cmt__ObjectFacet__c'
          },
          {
            VlocityDataPackType: 'ObjectContextRule',
            query: 'SELECT Id, Name FROM vlocity_cmt__ObjectRuleAssignment__c'
          }
        ]
      }
    }
  ];

  res.json({
    templates,
    count: templates.length,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/exports/fix-json-files:
 *   post:
 *     operationId: fixExportJsonFiles
 *     summary: Fix malformed JSON files in export directory
 *     description: Scans the specified export directory (or a sub-directory) for malformed JSON files and attempts to repair them in-place.
 *     tags:
 *       - Export Jobs
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               exportPath:
 *                 type: string
 *                 default: ./export
 *                 description: Path to the root export directory.
 *               dataPackType:
 *                 type: string
 *                 nullable: true
 *                 description: Limit fix to this DataPack type sub-directory (e.g. `SObject_PricingElement`).
 *               dataPackName:
 *                 type: string
 *                 nullable: true
 *                 description: Limit fix to this specific DataPack name (requires `dataPackType`).
 *     responses:
 *       200:
 *         description: Fix operation completed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                 exportPath:
 *                   type: string
 *                 results:
 *                   type: object
 *                   properties:
 *                     totalFixed:
 *                       type: integer
 *                     totalFailed:
 *                       type: integer
 *                     totalSkipped:
 *                       type: integer
 *       400:
 *         description: exportPath is required.
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
 *       404:
 *         description: Export directory not found.
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
router.post('/fix-json-files', asyncHandler(async (req, res) => {
  const { exportPath = './export', dataPackType = null, dataPackName = null } = req.body;

  if (!exportPath) {
    throw new ValidationError('exportPath is required');
  }

  // Resolve absolute path
  const fullExportPath = path.isAbsolute(exportPath) 
    ? exportPath 
    : path.join(process.cwd(), exportPath);

  // Check if path exists
  if (!await fs.pathExists(fullExportPath)) {
    throw new NotFoundError(`Export directory not found: ${fullExportPath}`);
  }

  logger.logOperation('Fixing JSON files in export directory', {
    exportPath: fullExportPath,
    dataPackType,
    dataPackName
  });

  let results;

  try {
    if (dataPackName && dataPackType) {
      // Fix specific DataPack
      const dataPackPath = path.join(fullExportPath, dataPackType, dataPackName);
      if (!await fs.pathExists(dataPackPath)) {
        throw new NotFoundError(`DataPack directory not found: ${dataPackPath}`);
      }
      results = await dataPackFileFixer.fixDataPackDirectory(dataPackPath);
    } else if (dataPackType) {
      // Fix all DataPacks of a specific type
      const typePath = path.join(fullExportPath, dataPackType);
      if (!await fs.pathExists(typePath)) {
        throw new NotFoundError(`DataPack type directory not found: ${typePath}`);
      }
      results = await dataPackFileFixer.fixDataPackDirectory(typePath);
    } else {
      // Fix entire export directory
      results = await dataPackFileFixer.fixExportDirectory(fullExportPath);
    }

    logger.logOperation('JSON file fix completed', {
      exportPath: fullExportPath,
      results
    });

    res.json({
      success: true,
      message: `Fixed ${results.totalFixed || 0} JSON file(s), ${results.totalFailed || 0} failed, ${results.totalSkipped || 0} already valid`,
      exportPath: fullExportPath,
      results
    });
  } catch (error) {
    logger.logError(error, { 
      operation: 'fixJsonFiles', 
      exportPath: fullExportPath,
      dataPackType,
      dataPackName
    });
    throw error;
  }
}));

/**
 * @swagger
 * /api/exports/validate-json-files:
 *   get:
 *     operationId: validateExportJsonFiles
 *     summary: Validate JSON files in export directory
 *     description: Scans the specified export directory for malformed JSON files and reports results without modifying any files.
 *     tags:
 *       - Export Jobs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: exportPath
 *         schema:
 *           type: string
 *           default: ./export
 *         description: Path to the root export directory.
 *       - in: query
 *         name: dataPackType
 *         schema:
 *           type: string
 *         description: Limit validation to this DataPack type sub-directory.
 *       - in: query
 *         name: dataPackName
 *         schema:
 *           type: string
 *         description: Limit validation to this specific DataPack name (requires `dataPackType`).
 *     responses:
 *       200:
 *         description: Validation completed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 totalFiles:
 *                   type: integer
 *                 validFiles:
 *                   type: integer
 *                 invalidFiles:
 *                   type: integer
 *                 invalidFileList:
 *                   type: array
 *                   items:
 *                     type: string
 *       401:
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Export directory not found.
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
router.get('/validate-json-files', asyncHandler(async (req, res) => {
  const { exportPath = './export', dataPackType = null, dataPackName = null } = req.query;

  // Resolve absolute path
  const fullExportPath = path.isAbsolute(exportPath) 
    ? exportPath 
    : path.join(process.cwd(), exportPath);

  // Check if path exists
  if (!await fs.pathExists(fullExportPath)) {
    throw new NotFoundError(`Export directory not found: ${fullExportPath}`);
  }

  logger.logOperation('Validating JSON files in export directory', {
    exportPath: fullExportPath,
    dataPackType,
    dataPackName
  });

  try {
    let targetPath = fullExportPath;
    
    if (dataPackName && dataPackType) {
      targetPath = path.join(fullExportPath, dataPackType, dataPackName);
    } else if (dataPackType) {
      targetPath = path.join(fullExportPath, dataPackType);
    }

    if (!await fs.pathExists(targetPath)) {
      throw new NotFoundError(`Directory not found: ${targetPath}`);
    }

    // Find all JSON files
    const jsonFiles = await dataPackFileFixer.findJsonFiles(targetPath);
    const invalidFiles = [];
    const validFiles = [];

    // Validate each file
    for (const filePath of jsonFiles) {
      try {
        const content = await fs.readFile(filePath, 'utf8');
        JSON.parse(content.trim());
        validFiles.push(filePath);
      } catch (parseError) {
        invalidFiles.push({
          path: filePath,
          error: parseError.message,
          relativePath: path.relative(fullExportPath, filePath)
        });
      }
    }

    const results = {
      totalFiles: jsonFiles.length,
      validFiles: validFiles.length,
      invalidFiles: invalidFiles.length,
      invalidFileList: invalidFiles
    };

    logger.logOperation('JSON file validation completed', {
      exportPath: fullExportPath,
      results
    });

    res.json({
      success: true,
      message: `Found ${invalidFiles.length} invalid JSON file(s) out of ${jsonFiles.length} total`,
      exportPath: fullExportPath,
      results
    });
  } catch (error) {
    logger.logError(error, { 
      operation: 'validateJsonFiles', 
      exportPath: fullExportPath,
      dataPackType,
      dataPackName
    });
    throw error;
  }
}));

module.exports = router;
