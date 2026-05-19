const express = require('express');
const router = express.Router();
const vlocityService = require('../services/vlocityService');
const vlocityCommandsService = require('../services/vlocityCommandsService');
const { asyncHandler, NotFoundError, ValidationError } = require('../middleware/errorHandler');
const { validate, schemas } = require('../utils/configValidator');
const logger = require('../utils/logger');
const fs = require('fs-extra');
const path = require('path');
const yaml = require('yaml');

// Import job history functionality
const jobRoutes = require('./jobs');
const jobHistoryService = require('../services/jobHistoryService');
const errorLogParser = require('../services/errorLogParser');
const jobMonitor = require('../services/jobMonitor');
const jobExecutionService = require('../services/jobExecutionService');
const vlocityErrorHandler = require('../services/vlocityErrorHandler');
const { sortQueriesByDependency } = require('../config/datapckDependencies');
const buildLogParser = require('../services/buildLogParser');
const notificationService = require('../services/notificationService');
const JOB_LOGS_DIR = path.join(__dirname, '../../logs/jobs');

/**
 * @swagger
 * /api/deploys/create-job:
 *   post:
 *     operationId: createDeployJob
 *     summary: Create a deploy job
 *     description: Validates the deploy job configuration, writes a YAML job file (for Vlocity CLI jobs), and records the job in the database with a `pending` status.
 *     tags:
 *       - Deploy Jobs
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
 *               targetUsername:
 *                 type: string
 *                 description: Salesforce org username to deploy into.
 *               sourceUsername:
 *                 type: string
 *                 description: Source org username (used for rollback tracking).
 *               projectPath:
 *                 type: string
 *                 description: Path to the export directory containing DataPacks to deploy.
 *                 example: ./export
 *               cliType:
 *                 type: string
 *                 enum: [vlocity, sf]
 *                 description: CLI to use. Auto-detected from project folder contents if omitted.
 *               environment:
 *                 type: string
 *                 description: Environment label (e.g. dev, uat, prod).
 *     responses:
 *       200:
 *         description: Deploy job created successfully.
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
 *         description: Validation error.
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
router.post('/create-job', validate(schemas.deployJob), asyncHandler(async (req, res) => {
  const jobConfig = req.body;
  
  // Auto-detect CLI type based on export folder contents if not explicitly set
  let cliType = jobConfig.cliType;
  if (!cliType && jobConfig.projectPath) {
    try {
      const exportPath = path.resolve(jobConfig.projectPath);
      if (await fs.pathExists(exportPath)) {
        const files = await fs.readdir(exportPath);
        // Check for SF CLI JSON files (object name pattern: GT_*.json, vlocity_cmt__*.json, etc.)
        const hasSfCliFiles = files.some(file => {
          return file.endsWith('.json') && (
            file.startsWith('GT_') || 
            file.startsWith('vlocity_cmt__') ||
            file.match(/^[A-Za-z0-9_]+__c\.json$/) // Custom object pattern
          );
        });
        
        if (hasSfCliFiles) {
          cliType = 'sf';
          logger.logOperation('Auto-detected SF CLI based on export folder contents', { 
            jobName: jobConfig.name,
            exportPath 
          });
        }
      }
    } catch (error) {
      logger.warn('Could not auto-detect CLI type from export folder', {
        projectPath: jobConfig.projectPath,
        error: error.message
      });
    }
  }
  
  // Default to vlocity if still not set
  cliType = cliType || 'vlocity';
  
  // Validate job name is provided
  if (!jobConfig.name) {
    throw new ValidationError('Job name is required');
  }

  // Validate CLI type
  if (!['vlocity', 'sf'].includes(cliType)) {
    throw new ValidationError('cliType must be either "vlocity" or "sf"');
  }
  
  // If deploying from export folder, auto-discover queries from folder structure (only for Vlocity)
  if (cliType === 'vlocity' && (jobConfig.deployFromExportFolder || (!jobConfig.queries || jobConfig.queries.length === 0))) {
    const deployJobGenerator = require('../services/deployJobGenerator');
    try {
      const exportPath = jobConfig.projectPath || './export';
      const result = await deployJobGenerator.generateDeployJobFromExport(exportPath);
      // Use discovered folder names as queries
      jobConfig.queries = result.queries;
      jobConfig.projectPath = result.exportPath;
      logger.logOperation('Auto-discovered queries from export folder', {
        exportPath,
        queriesCount: result.queries.length
      });
    } catch (error) {
      // If folder doesn't exist or is empty, allow empty queries (will fail at deploy time)
      logger.warn('Could not auto-discover queries from export folder', {
        exportPath: jobConfig.projectPath,
        error: error.message
      });
      if (!jobConfig.queries) {
        jobConfig.queries = [];
      }
    }
  }
  
  // Convert query objects to folder names if needed (for Vlocity CLI compatibility)
  if (cliType === 'vlocity' && jobConfig.queries && jobConfig.queries.length > 0 && typeof jobConfig.queries[0] === 'object') {
    // If queries are objects, convert to folder names based on VlocityDataPackType
    // This is a simplified conversion - for full export/deploy workflow, use the export folder
    logger.warn('Deploy job queries are objects, but deploy expects folder names. Consider using export folder workflow.');
    // For now, we'll let it pass and let Vlocity CLI handle it or fail gracefully
  }
  
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
      logger.logError(error, { operation: 'createDeployJobFile', jobConfig });
      throw error;
    }
  }
  
  // Ensure cliType is in the job configuration
  jobConfig.cliType = cliType;
  
  // Add to job history
  if (jobRoutes.addJobToHistory) {
    jobRoutes.addJobToHistory({
      type: 'deploy',
      name: jobConfig.name,
      status: 'pending', // Use valid status instead of 'created'
      username: jobConfig.sourceUsername || 'system',
      configuration: jobConfig, // This now includes cliType
      message: `Deploy job created from ${jobConfig.sourceUsername} to ${jobConfig.targetUsername} using ${cliType.toUpperCase()} CLI`,
      startedAt: new Date().toISOString(),
      filePath: createdPath,
      sourceUsername: jobConfig.sourceUsername,
      targetUsername: jobConfig.targetUsername,
      projectPath: jobConfig.projectPath || './deploy',
      environment: jobConfig.environment || 'dev',
      cliType: cliType
    });
  }
  
  logger.logOperation('Deploy job created', { 
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
 * @route POST /api/deploys/preflight
 * @desc Run preflight checks on a deploy job config before execution
 * @access Public
 */
/**
 * @swagger
 * /api/deploys/preflight:
 *   post:
 *     operationId: runDeployPreflight
 *     summary: Run deploy preflight checks
 *     description: Validates a deploy job configuration before execution — checks org connectivity, project path, and DataPack availability. Accepts either an existing `jobId` or an inline `jobConfig`.
 *     tags:
 *       - Deploy Jobs
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               jobId:
 *                 type: string
 *                 format: uuid
 *                 description: ID of an existing deploy job to load config from.
 *               jobConfig:
 *                 type: object
 *                 description: Inline deploy job configuration.
 *               checkOrgReachability:
 *                 type: boolean
 *                 default: false
 *                 description: Also test live connectivity to the target org.
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
 *                 data:
 *                   type: object
 *                   description: Preflight check results.
 *       400:
 *         description: jobId or jobConfig is required.
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
 *         description: Job not found.
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
  const { jobId, jobConfig, checkOrgReachability = false } = req.body;
  const deployPreflightService = require('../services/deployPreflightService');

  let config = jobConfig;
  if (jobId && !config) {
    const job = await jobHistoryService.getJobById(jobId);
    if (!job) throw new NotFoundError(`Job ${jobId} not found`);
    config = job.configuration || job.jobConfig;
  }
  if (!config) {
    throw new ValidationError('jobId or jobConfig is required');
  }

  const result = await deployPreflightService.runDeployPreflightChecks(config, { checkOrgReachability });
  res.json({ success: true, data: result });
}));

/**
 * @swagger
 * /api/deploys/run:
 *   post:
 *     operationId: runDeployJob
 *     summary: Run a deploy job
 *     description: Executes a Vlocity or SF CLI deploy to a target Salesforce org. Supports smart retry, dependency ordering, pre-deploy snapshots for rollback, and real-time progress via WebSocket. Source and target usernames must differ.
 *     tags:
 *       - Deploy Jobs
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
 *             properties:
 *               targetUsername:
 *                 type: string
 *                 description: Salesforce org username or alias to deploy into.
 *               jobFilePath:
 *                 type: string
 *                 description: Path to an existing YAML job file on the server.
 *               jobConfig:
 *                 type: object
 *                 description: Inline job configuration. Used when no jobFilePath is provided.
 *               cliType:
 *                 type: string
 *                 enum: [vlocity, sf]
 *                 default: vlocity
 *                 description: CLI to use for the deployment.
 *               deployCommand:
 *                 type: string
 *                 default: packDeploy
 *                 description: Vlocity CLI deploy command (packDeploy, packContinue, packRetry).
 *               maxRetries:
 *                 type: integer
 *                 default: 10
 *                 description: Maximum packContinue retry iterations.
 *               useDependencyOrder:
 *                 type: boolean
 *                 default: true
 *                 description: Sort DataPack types by dependency tier before deploying.
 *               prealignSettings:
 *                 type: boolean
 *                 default: false
 *                 description: Run settings alignment before deploying.
 *               stopOnNoProgress:
 *                 type: boolean
 *                 default: true
 *                 description: Abort retry loop when zero DataPacks are deployed in an iteration.
 *               sourceUsername:
 *                 type: string
 *                 nullable: true
 *                 description: Source org username (for same-org guard check; must differ from targetUsername).
 *               version:
 *                 type: string
 *                 nullable: true
 *                 description: Vlocity CLI version flag.
 *     responses:
 *       200:
 *         description: Deploy job started successfully.
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
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Missing parameters or same-org deploy guard triggered.
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
 *         description: Deploy failed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/run', asyncHandler(async (req, res) => {
  const {
    targetUsername,
    jobFilePath,
    jobConfig,
    attempts = 3,        // kept for backward compat
    maxRetries = 10,     // max packContinue iterations in smart retry
    prealignSettings = false,
    triggerExportRecovery = false,
    sourceUsername = null,
    version = null,
    cliType = 'vlocity', // Default to vlocity for backward compatibility
    deployCommand = 'packDeploy', // Deploy command: packDeploy, packContinue, packRetry
    useDependencyOrder = true,   // sort DataPack types by dependency tier before deploy
    stopOnNoProgress = true,     // abort packContinue loop if 0 DataPacks deployed
  } = req.body;

  if (!targetUsername) {
    throw new ValidationError('Target username is required');
  }

  if (!jobFilePath && !jobConfig) {
    throw new ValidationError('Either jobFilePath or jobConfig is required');
  }

  // **NEW**: Source/Target Username Validation - Prevent same-org deploys
  // Check both request body and jobConfig for sourceUsername
  const actualSourceUsername = sourceUsername || jobConfig?.sourceUsername || loadedJobConfig?.sourceUsername;
  if (actualSourceUsername && actualSourceUsername === targetUsername) {
    throw new ValidationError(
      'Source and target usernames cannot be the same. ' +
      'Please select different orgs to prevent accidental same-org deploys. ' +
      `Source: ${actualSourceUsername}, Target: ${targetUsername}`
    );
  }

  // Try to load job configuration and CLI type from database if needed
  let loadedJobConfig = jobConfig;
  let loadedCliType = cliType;
  
  // Always try to load from database when jobFilePath is provided (database is source of truth)
  // This ensures we use the correct CLI type even if frontend sends stale data
  if (jobFilePath) {
    const { Job } = require('../models');
    
    // Normalize filePath for comparison (handle both absolute and relative paths)
    const normalizedFilePath = path.normalize(jobFilePath);
    const jobFileName = path.basename(normalizedFilePath, '.yaml');
    
    // Try to find job by filePath first (exact match)
    let dbJob = await Job.findOne({
      where: {
        filePath: jobFilePath,
        type: 'deploy'
      },
      order: [['createdAt', 'DESC']]
    });
    
    // If not found, try normalized path
    if (!dbJob) {
      dbJob = await Job.findOne({
        where: {
          filePath: normalizedFilePath,
          type: 'deploy'
        },
        order: [['createdAt', 'DESC']]
      });
    }
    
    // If not found by filePath, try to find by job name (extracted from filePath)
    if (!dbJob) {
      dbJob = await Job.findOne({
        where: {
          name: jobFileName,
          type: 'deploy'
        },
        order: [['createdAt', 'DESC']]
      });
    }
    
    // If still not found, try all deploy jobs and match by filePath or name
    if (!dbJob) {
      const allDeployJobs = await Job.findAll({
        where: { type: 'deploy' },
        order: [['createdAt', 'DESC']]
      });
      
      // Find job where filePath matches (normalized) or name matches
      dbJob = allDeployJobs.find(j => {
        if (!j.filePath) return false;
        const normalizedDbPath = path.normalize(j.filePath);
        return normalizedDbPath === normalizedFilePath || 
               path.basename(normalizedDbPath, '.yaml') === jobFileName ||
               j.name === jobFileName;
      });
    }
    
    if (dbJob) {
      // Load configuration and CLI type from database job
      // Always prefer database CLI type over jobConfig CLI type (database is source of truth)
      // Merge with provided jobConfig if it exists, but keep database cliType
      loadedJobConfig = jobConfig ? { ...dbJob.configuration, ...jobConfig } : (dbJob.configuration || {});
      // Always use database CLI type as it's the source of truth
      loadedCliType = dbJob.cliType || dbJob.configuration?.cliType || 'vlocity';
      // Ensure loadedJobConfig also has the correct cliType
      loadedJobConfig.cliType = loadedCliType;
      
      logger.logOperation('Loaded job configuration from database', {
        jobId: dbJob.id,
        jobName: dbJob.name,
        cliType: loadedCliType,
        hasProjectPath: !!loadedJobConfig.projectPath,
        filePath: jobFilePath,
        dbCliType: dbJob.cliType,
        configCliType: dbJob.configuration?.cliType,
        requestedCliType: jobConfig?.cliType || cliType
      });
    } else {
      // Job not found in database - log warning but continue with request values
      logger.warn('Job not found in database by filePath, using request values', {
        filePath: jobFilePath,
        jobName: jobFileName,
        requestedCliType: jobConfig?.cliType || cliType
      });
      // Use request values if job not found
      if (jobConfig && jobConfig.cliType) {
        loadedCliType = jobConfig.cliType;
      }
    }
  } else if (jobConfig && jobConfig.cliType) {
    // If jobConfig is provided with cliType and no filePath, use it
    loadedCliType = jobConfig.cliType;
    logger.logOperation('Using CLI type from jobConfig (no filePath provided)', { cliType: loadedCliType });
  }

  // Use loaded values or fall back to request values
  const actualCliType = loadedCliType || cliType;
  const actualJobConfig = loadedJobConfig || jobConfig;

  // Validate CLI type after loading from database
  if (!['vlocity', 'sf'].includes(actualCliType)) {
    throw new ValidationError(`cliType must be either "vlocity" or "sf", but got: ${actualCliType}`);
  }

  // Import SF CLI service if needed
  const sfCliService = actualCliType === 'sf' ? require('../services/sfCliService') : null;

  let actualJobPath = jobFilePath;

  // Create job file if jobConfig is provided (only for Vlocity CLI)
  if (actualJobConfig && !jobFilePath && actualCliType === 'vlocity') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jobFileName = `deploy-job-${timestamp}.yaml`;
    actualJobPath = path.join(__dirname, '../temp', jobFileName);

    let configToWrite = actualJobConfig;
    if (useDependencyOrder && Array.isArray(actualJobConfig.queries)) {
      configToWrite = { ...actualJobConfig, queries: sortQueriesByDependency(actualJobConfig.queries) };
      logger.logOperation('Sorted deploy queries by dependency order', {
        queryCount: configToWrite.queries.length,
      });
    }

    await vlocityService.createJobFile(configToWrite, actualJobPath);
  }

  // Declare createdJob outside try block so it's accessible in catch
  let createdJob = null;
  
  try {
    logger.logOperation('Starting deploy', { 
      targetUsername, 
      jobPath: actualJobPath,
      attempts,
      prealignSettings,
      cliType: actualCliType
    });

    // Check if job already exists for this file path (created earlier)
    const { Job } = require('../models');
    createdJob = await Job.findOne({
      where: {
        filePath: actualJobPath,
        type: 'deploy'
      },
      order: [['createdAt', 'DESC']]
    });
    
    if (createdJob) {
      // Update existing job to running status
      createdJob.status = 'running';
      createdJob.startedAt = new Date();
      createdJob.username = actualJobConfig?.sourceUsername || targetUsername;
      createdJob.targetUsername = targetUsername;
      createdJob.configuration = actualJobConfig || createdJob.configuration;
      createdJob.cliType = actualCliType;
      await createdJob.save();
      
      logger.logOperation('Updated existing job to running', { jobId: createdJob.id, cliType: actualCliType });
    } else {
      // Create new job if not found
      if (jobRoutes.addJobToHistory) {
        createdJob = await jobRoutes.addJobToHistory({
          type: 'deploy',
          name: actualJobConfig?.name || path.basename(actualJobPath, '.yaml'),
          status: 'running',
          username: actualJobConfig?.sourceUsername || targetUsername,
          configuration: actualJobConfig || {},
          message: 'Deploy job started',
          startedAt: new Date().toISOString(),
          filePath: actualJobPath,
          sourceUsername: actualJobConfig?.sourceUsername,
          targetUsername: targetUsername,
          projectPath: actualJobConfig?.projectPath || './deploy',
          environment: actualJobConfig?.environment || 'dev',
          cliType: actualCliType
        });
      }
    }

    // ── Auto pre-deploy snapshot ──────────────────────────────────────────────
    // Capture the target org's current state before the deploy so the user can
    // roll back if something goes wrong. This is non-blocking: a snapshot failure
    // will log a warning but will not abort the deploy.
    if (createdJob) {
      try {
        const rollbackService = require('../services/rollbackService');
        const snapshotLabel = `Pre-deploy: ${createdJob.name || 'Deploy'} → ${targetUsername}`;
        const snapshot = await rollbackService.createSnapshot(targetUsername, snapshotLabel, true, createdJob.id);
        createdJob.configuration = {
          ...(createdJob.configuration || {}),
          preDeploySnapshotId: snapshot.snapshotId,
        };
        await createdJob.save();
        jobMonitor.addJobLog(createdJob.id, `📸 Pre-deploy snapshot created (ID: ${snapshot.snapshotId.substring(0, 8)}...)`, 'info');
      } catch (snapshotError) {
        logger.warn('Pre-deploy snapshot failed — continuing with deploy', {
          targetUsername,
          error: snapshotError.message,
        });
        jobMonitor.addJobLog(createdJob.id, `⚠️ Pre-deploy snapshot skipped: ${snapshotError.message}`, 'warn');
      }
    }

    let result;
    let attempt = 1;
    let lastError = null;

    // Route to appropriate CLI service based on actualCliType
    if (actualCliType === 'sf') {
      // Use SF CLI for custom objects deploy
      if (!actualJobConfig?.projectPath) {
        throw new ValidationError('projectPath is required for SF CLI deploys');
      }

      const sourcePath = path.resolve(actualJobConfig.projectPath);
      if (!await fs.pathExists(sourcePath)) {
        throw new ValidationError(`Source path does not exist: ${sourcePath}`);
      }

      // Update external key references before deploying
      if (createdJob) {
        jobMonitor.addJobLog(createdJob.id, '🔄 Updating external key references for target org...', 'info');
      }
      
      try {
        const referenceUpdater = require('../services/sfCliReferenceUpdater');
        const updateResult = await referenceUpdater.updateAllReferences(sourcePath, targetUsername, createdJob?.id);
        
        if (createdJob) {
          jobMonitor.addJobLog(
            createdJob.id, 
            `✅ Updated ${updateResult.totalUpdates} external key references`, 
            'info'
          );
        }
        
        logger.logOperation('External key references updated', {
          targetUsername,
          totalUpdates: updateResult.totalUpdates
        });
      } catch (updateError) {
        logger.warn('Failed to update external key references, continuing with deploy', {
          error: updateError.message
        });
        if (createdJob) {
          jobMonitor.addJobLog(
            createdJob.id,
            `⚠️  Warning: Could not update all external key references: ${updateError.message}`,
            'warn'
          );
        }
      }

      result = await sfCliService.deployCustomObjects({
        targetUsername,
        sourcePath,
        jobId: createdJob?.id,
        sourceUsername: actualJobConfig?.sourceUsername || sourceUsername
      });

      // Update job status
      if (createdJob) {
        await jobHistoryService.completeJob(createdJob.id, result, result.success);
      }
    } else {
      // Use Vlocity CLI (existing logic)
      // Pre-align settings if requested (only for packDeploy)
      if (prealignSettings && deployCommand === 'packDeploy') {
        logger.logOperation('Pre-aligning settings', { targetUsername });
        await vlocityService.updateSettings(targetUsername);
      }

      // Smart retry strategy: packDeploy → packContinue loop → packRetry
      // Helper: extract how many DataPacks succeeded from CLI output
      const parseSuccessCount = (output) => {
        const m = (output || '').match(/(\d+)\s+(?:Completed|DataPacks\s+deployed)/i);
        return m ? parseInt(m[1], 10) : 0;
      };

      if (deployCommand === 'packContinue' || deployCommand === 'packRetry') {
        // User explicitly chose packContinue or packRetry — run once
        try {
          logger.logOperation(`Using ${deployCommand} command`, { targetUsername, jobId: createdJob?.id });
          if (deployCommand === 'packContinue') {
            result = await vlocityCommandsService.packContinue(targetUsername, actualJobPath, createdJob?.id);
          } else {
            result = await vlocityCommandsService.packRetry(targetUsername, actualJobPath, createdJob?.id);
          }
          if (createdJob) {
            await jobHistoryService.addJobLog(createdJob.id, `✅ Deploy command "${deployCommand}" completed successfully`, 'info');
            await jobHistoryService.completeJob(createdJob.id, result, true);
          }
        } catch (error) {
          if (createdJob) {
            if (error.code === 'JOB_ABORTED') {
              await jobHistoryService.abortJob(createdJob.id, error.message || 'Deploy job aborted by user');
            } else {
              await jobHistoryService.addJobError(createdJob.id, error.message);
              await jobHistoryService.completeJob(createdJob.id, null, false);
            }
          }
          throw error;
        }
      } else {
        // packDeploy — 3-phase smart retry strategy
        const effectiveMaxRetries = maxRetries || attempts || 10;
        let phaseSuccess = false;

        // ── Phase 1: packDeploy (initial run) ────────────────────────────────
        if (createdJob) {
          jobMonitor.addJobLog(createdJob.id, '▶️  Phase 1/3: Running initial deploy (packDeploy)...', 'info');
        }

        try {
          // Optional pre-validation (may not be available in all Vlocity CLI versions)
          try {
            await vlocityService.validateDataPacks(targetUsername, actualJobPath, createdJob?.id);
          } catch (validationError) {
            logger.warn('Validation failed or not available, continuing with deploy', {
              targetUsername, error: validationError.message
            });
          }

          result = await vlocityService.deployDataPacks(targetUsername, actualJobPath, createdJob?.id, version);
          logger.logOperation('Deploy completed successfully (Phase 1 — packDeploy)', { targetUsername });
          if (createdJob) {
            await jobHistoryService.addJobLog(createdJob.id, '✅ Deploy succeeded on initial run', 'info');
            await jobHistoryService.completeJob(createdJob.id, result, true);
          }
          phaseSuccess = true;
        } catch (phase1Error) {
          lastError = phase1Error;
          const categorizedError = await vlocityErrorHandler.categorizeError(phase1Error, {
            operation: 'deploy', targetUsername, attempt: 1, jobPath: actualJobPath
          });

          logger.logOperation('Phase 1 deploy failed — will continue with retry phases', {
            targetUsername, error: categorizedError.sanitizedMessage, category: categorizedError.category
          });

          if (createdJob) {
            jobMonitor.addJobLog(
              createdJob.id,
              `❌ [${categorizedError.category}] ${categorizedError.sanitizedMessage}`,
              categorizedError.severity === 'error' ? 'error' : 'warn'
            );
          }

          const errorAnalysis1 = await errorLogParser.parseVlocityErrors();

          // Auto-fix: settings mismatch
          if (categorizedError.category === 'SettingsMismatch' ||
              errorAnalysis1.settingsMismatch ||
              (phase1Error.message.toLowerCase().includes('setting') &&
               phase1Error.message.toLowerCase().includes('mismatch'))) {
            logger.logOperation('Settings mismatch detected, auto-syncing settings', { targetUsername });
            if (createdJob) {
              jobMonitor.addJobLog(createdJob.id, '⚙️  Settings mismatch detected', 'warn');
              jobMonitor.addJobLog(createdJob.id, '🔄 Auto-syncing Vlocity settings on target org...', 'info');
            }
            try {
              await vlocityService.updateSettings(targetUsername);
              if (createdJob) {
                jobMonitor.addJobLog(createdJob.id, '✅ Settings synchronized successfully', 'info');
              }
              if (jobConfig?.sourceUsername) {
                if (createdJob) jobMonitor.addJobLog(createdJob.id, '🔄 Syncing settings on source org...', 'info');
                await vlocityService.updateSettings(jobConfig.sourceUsername);
                if (createdJob) jobMonitor.addJobLog(createdJob.id, '✅ Source settings synchronized', 'info');
              }
            } catch (settingsError) {
              logger.logError(settingsError, { operation: 'updateSettings', targetUsername });
              if (createdJob) jobMonitor.addJobLog(createdJob.id, `⚠️  Settings sync failed: ${settingsError.message}`, 'warn');
            }
          }

          // Auto-fix: duplicate field errors
          const vlocityErrorFixer = require('../services/vlocityErrorFixer');
          if (vlocityErrorFixer.hasDuplicateFieldErrors()) {
            logger.logOperation('Duplicate field errors detected, auto-fixing...', { targetUsername });
            if (createdJob) {
              jobMonitor.addJobLog(createdJob.id, '🔧 Duplicate field errors detected', 'warn');
              jobMonitor.addJobLog(createdJob.id, '🔄 Auto-fixing duplicate field values...', 'info');
            }
            try {
              const duplicateErrors = vlocityErrorFixer.parseDuplicateFieldErrors();
              const fixResult = await vlocityErrorFixer.fixDuplicateFields(duplicateErrors, targetUsername, createdJob?.id);
              if (fixResult.success && fixResult.fixesApplied > 0) {
                logger.logOperation('Duplicate field errors fixed', { targetUsername, fixesApplied: fixResult.fixesApplied });
                if (createdJob) {
                  jobMonitor.addJobLog(createdJob.id, `✅ Fixed ${fixResult.fixesApplied} duplicate field errors`, 'info');
                }
              } else if (fixResult.fixesApplied === 0) {
                if (createdJob) jobMonitor.addJobLog(createdJob.id, 'ℹ️  No duplicate field fixes needed', 'info');
              }
            } catch (fixError) {
              logger.logError(fixError, { operation: 'fixDuplicateFields', targetUsername });
              if (createdJob) jobMonitor.addJobLog(createdJob.id, `⚠️  Duplicate field fix failed: ${fixError.message}`, 'warn');
            }
          }

          if (errorAnalysis1.authErrors) {
            if (createdJob) jobMonitor.addJobLog(createdJob.id, '🔐 Authentication error detected — re-authentication required', 'error');
          }

          if (errorAnalysis1.failedTypes && errorAnalysis1.failedTypes.length > 0) {
            if (createdJob) jobMonitor.addJobLog(createdJob.id, `⚠️  Failed types: ${errorAnalysis1.failedTypes.join(', ')}`, 'warn');
          }

          if (createdJob) {
            jobMonitor.addJobLog(createdJob.id, '🔄 Phase 1 complete with errors — starting packContinue loop (Phase 2)...', 'info');
          }
        }

        // ── Phase 2: packContinue loop ────────────────────────────────────────
        if (!phaseSuccess) {
          if (createdJob) {
            jobMonitor.addJobLog(createdJob.id, `🔄 Phase 2/3: packContinue loop (up to ${effectiveMaxRetries} retries)...`, 'info');
          }

          for (let i = 0; i < effectiveMaxRetries && !phaseSuccess; i++) {
            try {
              logger.logOperation(`packContinue attempt ${i + 1}/${effectiveMaxRetries}`, { targetUsername });
              if (createdJob) {
                jobMonitor.addJobLog(createdJob.id, `🔄 Continuing deploy (${i + 1}/${effectiveMaxRetries})...`, 'info');
              }

              result = await vlocityCommandsService.packContinue(targetUsername, actualJobPath, createdJob?.id);

              logger.logOperation('Deploy succeeded during packContinue loop', { targetUsername, continueAttempt: i + 1 });
              if (createdJob) {
                await jobHistoryService.addJobLog(
                  createdJob.id,
                  `✅ Deploy succeeded after ${i + 1} packContinue attempt(s)`,
                  'info'
                );
                await jobHistoryService.completeJob(createdJob.id, result, true);
              }
              phaseSuccess = true;
            } catch (continueError) {
              lastError = continueError;

              const output = (continueError.stdout || continueError.stderr || continueError.message || '');
              const successCount = parseSuccessCount(output);

              logger.logOperation(`packContinue ${i + 1} finished with errors`, {
                targetUsername, successCount, error: continueError.message
              });

              if (createdJob) {
                jobMonitor.addJobLog(
                  createdJob.id,
                  successCount > 0
                    ? `⚠️  packContinue ${i + 1}: ${successCount} DataPack(s) deployed, some errors remain`
                    : `⚠️  packContinue ${i + 1}: no progress — 0 DataPacks deployed`,
                  'warn'
                );
              }

              if (successCount === 0 && stopOnNoProgress) {
                if (createdJob) {
                  jobMonitor.addJobLog(createdJob.id, '🛑 No progress detected — stopping continue loop early', 'warn');
                }
                break;
              }
            }
          }
        }

        // ── Phase 3: packRetry (clean reset pass) ────────────────────────────
        if (!phaseSuccess) {
          if (createdJob) {
            jobMonitor.addJobLog(createdJob.id, '🔄 Phase 3/3: Running packRetry (clean reset pass)...', 'info');
          }

          try {
            result = await vlocityCommandsService.packRetry(targetUsername, actualJobPath, createdJob?.id);

            logger.logOperation('Deploy completed successfully after packRetry', { targetUsername });
            if (createdJob) {
              await jobHistoryService.addJobLog(createdJob.id, '✅ Deploy succeeded after packRetry', 'info');
              await jobHistoryService.completeJob(createdJob.id, result, true);
            }
            phaseSuccess = true;
          } catch (phase3Error) {
            lastError = phase3Error;
            const errorAnalysis = await errorLogParser.parseVlocityErrors();

            // Before giving up, try export recovery if enabled and missing IDs detected
            if (triggerExportRecovery &&
                sourceUsername &&
                errorAnalysis.missingIds &&
                errorAnalysis.missingIds.length > 0) {
              try {
                if (createdJob) {
                  jobMonitor.addJobLog(createdJob.id, `\n🔄 Deploy failed with ${errorAnalysis.missingIds.length} missing dependencies`, 'warn');
                  jobMonitor.addJobLog(createdJob.id, `🚀 Triggering export recovery on source org...`, 'info');
                }
                logger.logOperation('Triggering export recovery on deploy failure', {
                  sourceUsername, missingIds: errorAnalysis.missingIds.length
                });

                const exportRecoveryService = require('../services/exportRecoveryService');
                const recoveryResult = await exportRecoveryService.runIterativeRecovery(
                  sourceUsername, actualJobPath, createdJob?.id,
                  { maxIterations: 5, projectPath: jobConfig?.projectPath }
                );

                if (recoveryResult.success && recoveryResult.recoveredIds > 0) {
                  if (createdJob) {
                    jobMonitor.addJobLog(createdJob.id, `✅ Export recovery completed: ${recoveryResult.recoveredIds} IDs recovered in ${recoveryResult.iterations} iterations`, 'info');
                    jobMonitor.addJobLog(createdJob.id, `🔄 Retrying deploy with fresh data...`, 'info');
                  }
                  result = await vlocityService.deployDataPacks(targetUsername, actualJobPath, createdJob?.id, version);
                  logger.logOperation('Deploy succeeded after export recovery', {
                    targetUsername, recoveredIds: recoveryResult.recoveredIds
                  });
                  if (createdJob) {
                    await jobHistoryService.addJobLog(
                      createdJob.id,
                      `✅ Deploy succeeded after export recovery (${recoveryResult.recoveredIds} IDs recovered)`,
                      'info'
                    );
                    await jobHistoryService.completeJob(createdJob.id, result, true);
                  }
                  phaseSuccess = true;
                }
              } catch (recoveryError) {
                logger.logError(recoveryError, { operation: 'exportRecoveryOnDeployFailure', sourceUsername });
                if (createdJob) {
                  jobMonitor.addJobLog(createdJob.id, `⚠️  Export recovery failed: ${recoveryError.message}`, 'warn');
                }
              }
            }

            if (!phaseSuccess) {
              // Final failure
              if (createdJob) {
                if (lastError?.code === 'JOB_ABORTED') {
                  await jobHistoryService.abortJob(createdJob.id, lastError.message || 'Deploy job aborted by user');
                } else {
                  await jobHistoryService.addJobError(
                    createdJob.id,
                    `Deploy failed after smart retry (packDeploy → packContinue×${effectiveMaxRetries} → packRetry): ${lastError.message}`
                  );
                  if (errorAnalysis.hasErrors) {
                    await jobHistoryService.addJobLog(
                      createdJob.id,
                      `📊 Error Summary: ${errorAnalysis.errors.length} errors, ${errorAnalysis.failedTypes.length} failed types`,
                      'error'
                    );
                  }
                  await jobHistoryService.completeJob(createdJob.id, null, false);
                }
              }
              throw lastError;
            }
          }
        }
      }
    }

    // D4: Run post-deploy validation if requested
    if (createdJob && req.body.runPostValidation && targetUsername) {
      try {
        await jobHistoryService.addJobLog(createdJob.id, '🔍 Running post-deploy validation...', 'info');
        const validationService = require('../services/validationService');
        const validationResult = await validationService.runYamlTests(targetUsername);
        await jobHistoryService.patchJobResult(createdJob.id, { postValidationResult: validationResult });
        await jobHistoryService.addJobLog(createdJob.id, '✅ Post-deploy validation completed', 'info');
      } catch (validationErr) {
        logger.warn('Post-deploy validation failed (non-fatal)', { jobId: createdJob.id, error: validationErr.message });
        await jobHistoryService.addJobLog(createdJob.id, `⚠️ Post-deploy validation failed: ${validationErr.message}`, 'warn').catch(() => {});
      }
    }

    // D1: Preserve build artifacts for this deploy job
    if (createdJob) {
      await buildLogParser.preserveJobArtifacts(createdJob.id, JOB_LOGS_DIR).catch(() => {});
    }

    // D6: Notify on deploy completion
    if (createdJob) {
      const summary = result?.summary || {};
      await notificationService.create({
        userId: createdJob.userId || null,
        type: 'job_completed',
        title: `Deploy completed: ${createdJob.name || targetUsername}`,
        message: `Successfully deployed to ${targetUsername}.${summary.success ? ` ${summary.success} records deployed.` : ''}`,
        relatedId: createdJob.id,
        relatedType: 'job',
        relatedUrl: `/jobs/deploy/${createdJob.id}`,
      }).catch(() => {});
    }

    res.json({
      success: true,
      result,
      targetUsername,
      jobPath: actualJobPath,
      attemptsUsed: attempt,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // D1: Preserve build artifacts even on failure
    if (createdJob) {
      await buildLogParser.preserveJobArtifacts(createdJob.id, JOB_LOGS_DIR).catch(() => {});
    }

    // D6: Notify on deploy failure
    if (createdJob) {
      await notificationService.create({
        userId: createdJob.userId || null,
        type: 'job_failed',
        title: `Deploy failed: ${createdJob.name || targetUsername}`,
        message: `Deploy to ${targetUsername} failed. Check the build log analysis for remediation hints.`,
        relatedId: createdJob.id,
        relatedType: 'job',
        relatedUrl: `/jobs/deploy/${createdJob.id}`,
      }).catch(() => {});
    }

    logger.logError(error, { operation: 'runDeploy', targetUsername, jobPath: actualJobPath });
    
    // Check if it's an authentication error
    if (error.authError) {
      const authErrorResponse = {
        success: false,
        error: {
          message: error.message,
          authError: true,
          reloginInfo: error.authError
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
 * /api/deploys/validate:
 *   post:
 *     operationId: validateDeployJob
 *     summary: Validate a deploy job
 *     description: Runs the Vlocity CLI `validateDataPacks` command against the target org to identify conflicts and missing references before committing to a full deploy.
 *     tags:
 *       - Deploy Jobs
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
 *             properties:
 *               targetUsername:
 *                 type: string
 *                 description: Salesforce org username or alias to validate against.
 *               jobFilePath:
 *                 type: string
 *                 description: Path to an existing YAML job file on the server.
 *               jobConfig:
 *                 type: object
 *                 description: Inline job configuration. Used when no jobFilePath is provided.
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
 *                 result:
 *                   type: object
 *                   description: CLI validation output including isValid flag.
 *                 targetUsername:
 *                   type: string
 *                 jobPath:
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
 *         description: Validation failed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/validate', asyncHandler(async (req, res) => {
  const { targetUsername, jobFilePath, jobConfig } = req.body;

  if (!targetUsername) {
    throw new ValidationError('Target username is required');
  }

  if (!jobFilePath && !jobConfig) {
    throw new ValidationError('Either jobFilePath or jobConfig is required');
  }

  let actualJobPath = jobFilePath;

  // Create job file if jobConfig is provided
  if (jobConfig && !jobFilePath) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jobFileName = `deploy-job-${timestamp}.yaml`;
    actualJobPath = path.join(__dirname, '../temp', jobFileName);
    await vlocityService.createJobFile(jobConfig, actualJobPath);
  }

  try {
    logger.logOperation('Starting deploy validation', { 
      targetUsername, 
      jobPath: actualJobPath 
    });

    const result = await vlocityService.validateDataPacks(targetUsername, actualJobPath);
    
    logger.logOperation('Deploy validation completed', { 
      targetUsername, 
      jobPath: actualJobPath,
      isValid: result.result.isValid 
    });

    res.json({
      success: true,
      result,
      targetUsername,
      jobPath: actualJobPath,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.logError(error, { operation: 'validateDeploy', targetUsername, jobPath: actualJobPath });
    throw error;
  }
}));

/**
 * @swagger
 * /api/deploys/jobs:
 *   get:
 *     operationId: listDeployJobs
 *     summary: List deploy jobs
 *     description: Returns a paginated list of deploy job records from the database, ordered most-recent first.
 *     tags:
 *       - Deploy Jobs
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
 *         description: Deploy jobs retrieved successfully.
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
  // Read deploy jobs from database instead of file system
  const { Job } = require('../models');
  
  // Pagination parameters
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 25;
  const offset = (page - 1) * limit;
  
  // Get total count
  const totalCount = await Job.count({
    where: { type: 'deploy' }
  });
  
  // Get paginated jobs
  const jobs = await Job.findAll({
    where: { type: 'deploy' },
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
      'sourceUsername',
      'targetUsername',
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
    sourceUsername: job.sourceUsername,
    targetUsername: job.targetUsername,
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
 * /api/deploys/jobs/{jobName}:
 *   get:
 *     operationId: getDeployJob
 *     summary: Get deploy job details
 *     description: Reads and returns the YAML configuration for a specific saved or temp deploy job file.
 *     tags:
 *       - Deploy Jobs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobName
 *         required: true
 *         schema:
 *           type: string
 *         description: Filename of the deploy job (e.g. `MyDeploy.yaml`).
 *     responses:
 *       200:
 *         description: Deploy job details retrieved.
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
 *         description: Deploy job not found.
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
    throw new NotFoundError(`Deploy job '${jobName}' not found`);
  }

  try {
    const jobContent = await fs.readFile(jobPath, 'utf8');
    const jobConfig = yaml.parse(jobContent);
    const stats = await fs.stat(jobPath);

    res.json({
      success: true,
      jobName,
      jobType,
      jobPath,
      config: jobConfig,
      stats: {
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
        size: stats.size,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.logError(error, { operation: 'getDeployJob', jobName, jobPath });
    throw error;
  }
}));

/**
 * @swagger
 * /api/deploys/save-job:
 *   post:
 *     operationId: saveDeployJob
 *     summary: Save a deploy job to disk
 *     description: Writes a deploy job YAML file to the persistent `jobs/` directory under the given name.
 *     tags:
 *       - Deploy Jobs
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
 *                 description: Full deploy job configuration to persist.
 *     responses:
 *       200:
 *         description: Deploy job saved successfully.
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
    
    logger.logOperation('Deploy job saved', { jobName, jobPath });

    res.json({
      success: true,
      message: `Deploy job '${jobName}' saved successfully`,
      jobName,
      jobPath,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.logError(error, { operation: 'saveDeployJob', jobName, jobConfig });
    throw error;
  }
}));

/**
 * @swagger
 * /api/deploys/jobs/{jobName}:
 *   put:
 *     operationId: updateDeployJob
 *     summary: Update a deploy job
 *     description: Overwrites the YAML job file and/or the database record for the named deploy job. Validates the configuration before saving (Vlocity CLI only).
 *     tags:
 *       - Deploy Jobs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobName
 *         required: true
 *         schema:
 *           type: string
 *         description: URL-encoded filename of the deploy job (e.g. `My%20Deploy.yaml`).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Updated deploy job configuration.
 *     responses:
 *       200:
 *         description: Deploy job updated successfully.
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
 *         description: Deploy job not found.
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

  // Also update database record if job exists
  const { Job } = require('../models');
  const dbJob = await Job.findOne({
    where: {
      name: jobName,
      type: 'deploy'
    }
  });

  // If job doesn't exist in file system or database, throw NotFoundError
  if (!jobPath && !dbJob) {
    throw new NotFoundError(`Deploy job '${jobName}' not found`);
  }

  try {
    // Validate job configuration (only for Vlocity CLI jobs that use YAML files)
    if (jobPath && cliType === 'vlocity') {
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
      if (jobConfig.sourceUsername) dbJob.sourceUsername = jobConfig.sourceUsername;
      if (jobConfig.targetUsername) dbJob.targetUsername = jobConfig.targetUsername;
      if (jobConfig.projectPath) dbJob.projectPath = jobConfig.projectPath;
      await dbJob.save();
      logger.logOperation('Deploy job updated in database', { 
        jobId: dbJob.id,
        jobName, 
        cliType
      });
    }
    
    logger.logOperation('Deploy job updated', { 
      jobName, 
      jobType,
      jobPath,
      cliType,
      dbUpdated: !!dbJob
    });

    res.json({
      success: true,
      message: `Deploy job '${jobName}' updated successfully`,
      jobName,
      jobType,
      config: jobConfig,
      cliType: cliType,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.logError(error, { operation: 'updateDeployJob', jobName, jobPath });
    throw error;
  }
}));

/**
 * @swagger
 * /api/deploys/jobs/{jobName}/abort:
 *   post:
 *     operationId: abortDeployJob
 *     summary: Abort a running deploy job
 *     description: Looks up the running or pending deploy job by name and requests it to stop.
 *     tags:
 *       - Deploy Jobs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobName
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the deploy job to abort.
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
 *         description: Deploy job aborted successfully.
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
 *         description: Deploy job not found.
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
  
  // For deploy jobs, we need to find the job in the job history by name
  // and abort it using the job ID
  try {
    const jobHistoryService = require('../services/jobHistoryService');
    
    // Find the job by name in the job history
    const jobs = await jobHistoryService.getJobHistory(1000, 0, { type: 'deploy' });
    const job = jobs.jobs.find(j => j.name === jobName);
    
    if (!job) {
      throw new NotFoundError(`Deploy job '${jobName}' not found`);
    }
    
    // Check if job is in a state that can be aborted
    if (job.status !== 'running' && job.status !== 'pending') {
      throw new Error(`Cannot abort job '${jobName}': job has already ${job.status === 'completed' ? 'completed' : job.status === 'failed' ? 'failed' : 'been aborted'}. Only running or pending jobs can be aborted.`);
    }
    
    await jobExecutionService.abortJob(job.id, reason || 'Deploy job aborted by user');
    const abortedJob = await jobHistoryService.abortJob(job.id, reason || 'Deploy job aborted by user');
    
    res.json({
      success: true,
      message: `Deploy job '${jobName}' aborted successfully`,
      job: abortedJob,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.logError(error, { operation: 'abortDeployJob', jobName });
    throw error;
  }
}));

/**
 * @swagger
 * /api/deploys/jobs/{jobName}:
 *   delete:
 *     operationId: deleteDeployJob
 *     summary: Delete a deploy job
 *     description: Removes the YAML job file from disk. The corresponding database record is NOT deleted.
 *     tags:
 *       - Deploy Jobs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobName
 *         required: true
 *         schema:
 *           type: string
 *         description: Filename of the deploy job to delete (e.g. `MyDeploy.yaml`).
 *     responses:
 *       200:
 *         description: Deploy job deleted successfully.
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
 *         description: Deploy job not found.
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
    throw new NotFoundError(`Deploy job '${jobName}' not found`);
  }

  try {
    await fs.remove(jobPath);
    
    logger.logOperation('Deploy job deleted', { 
      jobName, 
      jobType,
      jobPath 
    });

    res.json({
      success: true,
      message: `Deploy job '${jobName}' deleted successfully`,
      jobName,
      jobType,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.logError(error, { operation: 'deleteDeployJob', jobName, jobPath });
    throw error;
  }
}));

/**
 * @swagger
 * /api/deploys/generate-from-export:
 *   post:
 *     operationId: generateDeployJobFromExport
 *     summary: Auto-generate deploy job from export directory
 *     description: Scans an export directory, discovers all DataPack type folders, and generates a deploy job configuration. Optionally saves the generated job to disk.
 *     tags:
 *       - Deploy Jobs
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
 *               environment:
 *                 type: string
 *                 description: Environment label to embed in the generated job.
 *               saveToFile:
 *                 type: boolean
 *                 default: true
 *                 description: Whether to persist the generated job YAML to disk.
 *               outputPath:
 *                 type: string
 *                 nullable: true
 *                 description: Custom output path for the generated YAML. Auto-generated if omitted.
 *     responses:
 *       200:
 *         description: Deploy job generated successfully.
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
 *                 jobFilePath:
 *                   type: string
 *                   nullable: true
 *                 deployJob:
 *                   type: object
 *                 dataPackTypes:
 *                   type: integer
 *                 queries:
 *                   type: array
 *                   items:
 *                     type: object
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
router.post('/generate-from-export', asyncHandler(async (req, res) => {
  const { exportPath = './export', environment = '', saveToFile = true, outputPath = null } = req.body;
  
  const deployJobGenerator = require('../services/deployJobGenerator');
  
  if (saveToFile) {
    // Generate and save to file
    const result = await deployJobGenerator.generateAndSaveDeployJob(exportPath, environment, outputPath);
    
    logger.logOperation('Deploy job generated and saved from export', {
      exportPath,
      environment,
      outputPath: result.jobFilePath,
      dataPackTypes: result.dataPackTypes
    });
    
    res.json({
      success: true,
      message: `Deploy job generated with ${result.dataPackTypes} DataPack types`,
      jobFilePath: result.jobFilePath,
      deployJob: result.deployJob,
      dataPackTypes: result.dataPackTypes,
      queries: result.queries,
      timestamp: new Date().toISOString()
    });
  } else {
    // Just return the job config without saving
    const result = await deployJobGenerator.generateDeployJobFromExport(exportPath, environment);
    
    logger.logOperation('Deploy job generated from export (not saved)', {
      exportPath,
      environment,
      dataPackTypes: result.dataPackTypes
    });
    
    res.json({
      success: true,
      message: `Deploy job generated with ${result.dataPackTypes} DataPack types`,
      deployJob: result.deployJob,
      dataPackTypes: result.dataPackTypes,
      queries: result.queries,
      exportPath: result.exportPath,
      timestamp: new Date().toISOString()
    });
  }
}));

/**
 * @swagger
 * /api/deploys/export-statistics:
 *   get:
 *     operationId: getExportStatistics
 *     summary: Get export directory statistics
 *     description: Scans an export directory and returns DataPack type counts and folder metadata without generating any job files.
 *     tags:
 *       - Deploy Jobs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: exportPath
 *         schema:
 *           type: string
 *           default: ./export
 *         description: Path to the root export directory to scan.
 *       - in: query
 *         name: environment
 *         schema:
 *           type: string
 *         description: Optional environment label for contextual metadata.
 *     responses:
 *       200:
 *         description: Export statistics retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 statistics:
 *                   type: object
 *                   description: DataPack folder counts and metadata.
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
router.get('/export-statistics', asyncHandler(async (req, res) => {
  const { exportPath = './export', environment = '' } = req.query;
  
  const deployJobGenerator = require('../services/deployJobGenerator');
  const stats = await deployJobGenerator.getExportStatistics(exportPath, environment);
  
  logger.logOperation('Export statistics retrieved', {
    exportPath,
    environment,
    dataPackTypes: stats.dataPackTypes
  });
  
  res.json({
    success: true,
    statistics: stats,
    timestamp: new Date().toISOString()
  });
}));

/**
 * @swagger
 * /api/deploys/update-from-export:
 *   post:
 *     operationId: updateDeployJobFromExport
 *     summary: Update deploy job from export directory
 *     description: Merges newly discovered DataPack type folders from an export directory into an existing deploy job YAML file, adding only the types not already present.
 *     tags:
 *       - Deploy Jobs
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - existingJobPath
 *             properties:
 *               existingJobPath:
 *                 type: string
 *                 description: Absolute or relative path to the existing deploy job YAML file to update.
 *               exportPath:
 *                 type: string
 *                 default: ./export
 *                 description: Path to the export directory to scan for new DataPack types.
 *     responses:
 *       200:
 *         description: Deploy job updated with new DataPack types.
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
 *                 deployJob:
 *                   type: object
 *                 previousQueriesCount:
 *                   type: integer
 *                 newQueriesCount:
 *                   type: integer
 *                 totalQueriesCount:
 *                   type: integer
 *                 addedQueries:
 *                   type: array
 *                   items:
 *                     type: object
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: existingJobPath is required.
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
router.post('/update-from-export', asyncHandler(async (req, res) => {
  const { existingJobPath, exportPath = './export' } = req.body;
  
  if (!existingJobPath) {
    throw new ValidationError('existingJobPath is required');
  }
  
  const deployJobGenerator = require('../services/deployJobGenerator');
  const result = await deployJobGenerator.updateDeployJobFromExport(existingJobPath, exportPath);
  
  logger.logOperation('Deploy job updated from export', {
    existingJobPath,
    exportPath,
    addedQueries: result.addedQueries.length
  });
  
  res.json({
    success: true,
    message: `Deploy job updated. Added ${result.addedQueries.length} new DataPack types`,
    deployJob: result.deployJob,
    previousQueriesCount: result.previousQueriesCount,
    newQueriesCount: result.newQueriesCount,
    totalQueriesCount: result.totalQueriesCount,
    addedQueries: result.addedQueries,
    timestamp: new Date().toISOString()
  });
}));

/**
 * @route GET /api/deploys/jobs/:jobId/rollback-status
 * @desc Get rollback snapshot status for a completed deploy job
 * @access Public
 */
router.get('/jobs/:jobId/rollback-status', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const job = await jobHistoryService.getJobById(jobId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);

  const snapshotId = job.configuration?.preDeploySnapshotId;
  if (!snapshotId) {
    return res.json({ success: true, data: { available: false } });
  }

  try {
    const rollbackService = require('../services/rollbackService');
    const snapshot = await rollbackService.getSnapshot(snapshotId);
    const meta = snapshot.metadata;
    const recordCounts = meta.configuration?.recordCounts || {};
    const types = Object.keys(recordCounts).filter(k => recordCounts[k] > 0);
    const totalRecords = Object.values(recordCounts).reduce((s, v) => s + (v || 0), 0);

    res.json({
      success: true,
      data: {
        available: true,
        snapshotId,
        snapshotCreatedAt: meta.createdAt,
        targetUsername: job.configuration?.targetUsername || meta.username,
        types,
        recordCounts,
        totalRecords,
      }
    });
  } catch (err) {
    // Snapshot exists in job config but data file is missing
    res.json({ success: true, data: { available: false, reason: err.message } });
  }
}));

/**
 * @route POST /api/deploys/jobs/:jobId/rollback
 * @desc Restore the target org to its pre-deploy snapshot state
 * @access Public
 */
router.post('/jobs/:jobId/rollback', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const job = await jobHistoryService.getJobById(jobId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);

  const snapshotId = job.configuration?.preDeploySnapshotId;
  if (!snapshotId) {
    throw new ValidationError('No pre-deploy snapshot found for this job. Cannot rollback.');
  }

  const targetUsername = req.body.targetUsername || job.configuration?.targetUsername;
  if (!targetUsername) {
    throw new ValidationError('targetUsername is required for rollback');
  }

  const rollbackService = require('../services/rollbackService');
  const { restoreJobId, summary } = await rollbackService.restoreSnapshot(snapshotId, targetUsername);

  // Notify on rollback completion
  await notificationService.create({
    userId: job.userId || null,
    type: 'job_completed',
    title: 'Rollback completed',
    message: `Target org ${targetUsername} restored to pre-deploy state. ${summary.success} records restored${summary.errors > 0 ? `, ${summary.errors} errors` : ''}.`,
    relatedId: jobId,
    relatedType: 'job',
    relatedUrl: `/jobs/deploy/${jobId}`,
  }).catch(() => {});

  res.json({
    success: true,
    data: {
      restoreJobId,
      summary,
      originalDeployJobId: jobId,
    }
  });
}));

/**
 * @route POST /api/deploys/sequential
 * @desc  Run a "Strict Sequential Deployment" — deploys all 27 object types
 *        in the prescribed dependency order, mixing Vlocity DataPack and
 *        sf CLI (manual) steps without race conditions.
 * @body  {
 *          targetUsername  {string}  — Salesforce org username/alias (required)
 *          projectPath     {string}  — Absolute/relative path to the export (required)
 *          baseJobConfig   {Object}  — Shared Vlocity job YAML settings (optional)
 *          continueOnError {boolean} — Keep going after a failed step (default: true)
 *          version         {string}  — Vlocity CLI version flag (optional)
 *        }
 */
router.post('/sequential', asyncHandler(async (req, res) => {
  const {
    targetUsername,
    projectPath,
    baseJobConfig = {},
    continueOnError = true,
    version = null,
  } = req.body;

  if (!targetUsername) throw new ValidationError('targetUsername is required');
  if (!projectPath)    throw new ValidationError('projectPath is required');

  const sequentialDeploymentService = require('../services/sequentialDeploymentService');
  const jobHistoryService           = require('../services/jobHistoryService');

  // Create a DB job entry so the frontend can track it via the standard jobs panel
  let jobRecord = null;
  try {
    jobRecord = await jobHistoryService.createJob({
      type:           'deploy',
      name:           `Sequential Deploy → ${targetUsername}`,
      status:         'running',
      username:       baseJobConfig.sourceUsername || targetUsername,
      targetUsername,
      configuration:  { ...baseJobConfig, projectPath, sequential: true },
      message:        'Sequential deployment started',
      startedAt:      new Date().toISOString(),
      projectPath,
      environment:    baseJobConfig.environment || 'prod',
      cliType:        'vlocity',   // mixed, but vlocity is the primary CLI
    });
  } catch (err) {
    logger.warn('Could not create sequential deploy job record', { error: err.message });
  }

  const jobId = jobRecord?.id || null;

  // Respond immediately — long-running deploy streams progress via WebSocket
  res.json({
    success: true,
    data: {
      jobId,
      message: 'Sequential deployment started. Monitor progress via WebSocket.',
      steps: 27,
    },
  });

  // Run asynchronously — do NOT await here so the HTTP response is already sent
  sequentialDeploymentService.runSequentialDeployment({
    targetUsername,
    projectPath,
    baseJobConfig,
    jobId,
    continueOnError,
    version,
  }).then(async result => {
    if (jobRecord) {
      try {
        await jobHistoryService.updateJobStatus(jobId, result.summary.passed ? 'completed' : 'failed', {
          message: `Sequential deploy finished: ${result.summary.successCount} succeeded, ${result.summary.skippedCount} skipped, ${result.summary.errorCount} failed`,
          completedAt: new Date().toISOString(),
          result: result.summary,
        });
      } catch (e) {
        logger.warn('Could not update sequential deploy job status', { error: e.message });
      }
    }
  }).catch(async err => {
    logger.error('Sequential deployment failed', { error: err.message, targetUsername });
    if (jobRecord) {
      await jobHistoryService.updateJobStatus(jobId, 'failed', {
        message: err.message,
        completedAt: new Date().toISOString(),
      }).catch(() => {});
    }
  });
}));

/**
 * @route GET /api/deploys/sequential/sequence
 * @desc  Return the full 27-step deployment sequence configuration (read-only).
 */
router.get('/sequential/sequence', asyncHandler(async (_req, res) => {
  const { DEPLOYMENT_SEQUENCE } = require('../config/deploymentSequence');
  res.json({ success: true, data: DEPLOYMENT_SEQUENCE });
}));

module.exports = router;
