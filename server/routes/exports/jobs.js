/** Export API (/api/exports): saved export jobs (list, read, update, abort, delete, save). Mounted by ../exports.js. */
const express = require('express');
const router = express.Router();
const vlocityService = require('../../services/vlocityService');
const { asyncHandler, NotFoundError, ValidationError } = require('../../middleware/errorHandler');
const logger = require('../../utils/logger');
const fs = require('fs-extra');
const path = require('path');
const yaml = require('yaml');
const jobExecutionService = require('../../services/jobExecutionService');

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
  const { Job } = require('../../models');
  
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
  const { Job } = require('../../models');
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
      const yamlConfigService = require('../../services/yamlConfigService');
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
    const jobHistoryService = require('../../services/jobHistoryService');
    
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

module.exports = router;
