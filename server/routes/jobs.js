const express = require('express');
const router = express.Router();
const { asyncHandler, ValidationError, NotFoundError } = require('../middleware/errorHandler');
const jobHistoryService = require('../services/jobHistoryService');
const jobExecutionService = require('../services/jobExecutionService');
const logStorageService = require('../services/logStorageService');
const errorAnalysisService = require('../services/errorAnalysisService');
const logger = require('../utils/logger');

// Export the function for use in other modules (backward compatibility)
router.addJobToHistory = jobHistoryService.addJobToHistory.bind(jobHistoryService);

/**
 * @swagger
 * /api/jobs/history:
 *   get:
 *     operationId: getJobHistory
 *     summary: List job history
 *     description: Returns a paginated, filterable list of all jobs (exports and deploys) recorded in the database.
 *     tags:
 *       - Job History
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of jobs to return.
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of jobs to skip before returning results.
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [export, deploy]
 *         description: Filter by job type.
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, running, completed, failed, aborted]
 *         description: Filter by job status.
 *       - in: query
 *         name: username
 *         schema:
 *           type: string
 *         description: Filter by Salesforce org username.
 *     responses:
 *       200:
 *         description: Job history retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 jobs:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Job'
 *                 total:
 *                   type: integer
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
router.get('/history', asyncHandler(async (req, res) => {
  const { 
    limit = 50, 
    offset = 0, 
    type, 
    status, 
    username 
  } = req.query;
  
  const filters = {};
  if (type) filters.type = type;
  if (status) filters.status = status;
  if (username) filters.username = username;
  
  const result = await jobHistoryService.getJobHistory(
    parseInt(limit), 
    parseInt(offset), 
    filters
  );
  
  res.json({
    success: true,
    ...result,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/jobs/status:
 *   get:
 *     operationId: getActiveJobStatus
 *     summary: Get active job status
 *     description: Returns the count and details of all currently running jobs.
 *     tags:
 *       - Job History
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Active job status retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 runningJobs:
 *                   type: integer
 *                   description: Count of currently running jobs.
 *                 jobs:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Job'
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
router.get('/status', asyncHandler(async (req, res) => {
  const activeJobs = await jobHistoryService.getActiveJobs();
  
  res.json({
    success: true,
    runningJobs: activeJobs.length,
    jobs: activeJobs,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/jobs/execution/status:
 *   get:
 *     operationId: getExecutionQueueStatus
 *     summary: Get execution queue status
 *     description: Returns current job execution queue metrics, including max worker concurrency, active jobs, and queued jobs.
 *     tags:
 *       - Job History
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Execution queue status retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 maxConcurrent:
 *                   type: integer
 *                   description: Maximum number of jobs allowed to run in parallel.
 *                   example: 2
 *                 activeCount:
 *                   type: integer
 *                   description: Number of jobs currently executing.
 *                   example: 1
 *                 queuedCount:
 *                   type: integer
 *                   description: Number of jobs waiting in queue.
 *                   example: 3
 *                 activeJobs:
 *                   type: array
 *                   description: IDs of currently running jobs.
 *                   items:
 *                     type: string
 *                     format: uuid
 *                 queuedJobs:
 *                   type: array
 *                   description: IDs of queued jobs.
 *                   items:
 *                     type: string
 *                     format: uuid
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
router.get('/execution/status', asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    ...jobExecutionService.getStats(),
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/jobs/stats:
 *   get:
 *     operationId: getJobStats
 *     summary: Get job statistics
 *     description: Returns aggregate statistics (counts by status/type) for all jobs, optionally scoped to a specific org username.
 *     tags:
 *       - Job History
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         schema:
 *           type: string
 *         description: Salesforce org username to scope statistics to.
 *     responses:
 *       200:
 *         description: Job statistics retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 totalJobs:
 *                   type: integer
 *                 completedJobs:
 *                   type: integer
 *                 failedJobs:
 *                   type: integer
 *                 runningJobs:
 *                   type: integer
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
router.get('/stats', asyncHandler(async (req, res) => {
  const { username } = req.query;
  const stats = await jobHistoryService.getJobStats(username);
  
  res.json({
    success: true,
    ...stats,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/jobs/{jobId}:
 *   get:
 *     operationId: getJobById
 *     summary: Get job details
 *     description: Returns the full details of a specific job by its UUID.
 *     tags:
 *       - Job History
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job UUID.
 *     responses:
 *       200:
 *         description: Job details retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
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
router.get('/:jobId', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const job = await jobHistoryService.getJobById(jobId);
  
  res.json({
    success: true,
    job,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/jobs/{jobId}:
 *   delete:
 *     operationId: deleteJob
 *     summary: Delete a job
 *     description: Permanently removes a job record from the database.
 *     tags:
 *       - Job History
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job UUID.
 *     responses:
 *       200:
 *         description: Job deleted successfully.
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
 *                   example: Job deleted successfully
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
router.delete('/:jobId', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const job = await jobHistoryService.deleteJob(jobId);
  
  res.json({
    success: true,
    message: 'Job deleted successfully',
    job,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/jobs/{jobId}/abort:
 *   post:
 *     operationId: abortJob
 *     summary: Abort a running job
 *     description: Signals a running or pending job to stop and marks it as aborted.
 *     tags:
 *       - Job History
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job UUID.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Human-readable reason for aborting the job.
 *                 example: Cancelled by user
 *     responses:
 *       200:
 *         description: Job aborted successfully.
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
 *                   example: Job aborted successfully
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
router.post('/:jobId/abort', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const { reason } = req.body;

  await jobExecutionService.abortJob(jobId, reason || 'Job aborted by user');
  
  const job = await jobHistoryService.abortJob(jobId, reason);
  
  res.json({
    success: true,
    message: 'Job aborted successfully',
    job,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/jobs/{jobId}/cli-type:
 *   patch:
 *     operationId: updateJobCliType
 *     summary: Update job CLI type
 *     description: Changes the CLI type (vlocity or sf) stored on a job record. Useful for correcting auto-detected CLI type.
 *     tags:
 *       - Job History
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job UUID.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - cliType
 *             properties:
 *               cliType:
 *                 type: string
 *                 enum: [vlocity, sf]
 *                 description: CLI type to assign to the job.
 *     responses:
 *       200:
 *         description: CLI type updated successfully.
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
 *                   example: Job CLI type updated to sf
 *                 job:
 *                   $ref: '#/components/schemas/Job'
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid or missing cliType value.
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
router.patch('/:jobId/cli-type', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const { cliType } = req.body;
  
  if (!cliType) {
    throw new ValidationError('cliType is required');
  }
  
  if (!['vlocity', 'sf'].includes(cliType)) {
    throw new ValidationError('cliType must be either "vlocity" or "sf"');
  }
  
  const job = await jobHistoryService.getJobById(jobId);
  
  // Update CLI type
  job.cliType = cliType;
  
  // Update configuration to include cliType
  if (!job.configuration) {
    job.configuration = {};
  }
  job.configuration.cliType = cliType;
  
  await job.save();
  
  logger.logOperation('Job CLI type updated', { 
    jobId, 
    jobName: job.name,
    oldCliType: job.cliType,
    newCliType: cliType 
  });
  
  res.json({
    success: true,
    message: `Job CLI type updated to ${cliType}`,
    job,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/jobs/{jobId}/log:
 *   post:
 *     operationId: addJobLog
 *     summary: Add a log entry to a job
 *     description: Appends a structured log message to the job's log store.
 *     tags:
 *       - Job History
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job UUID.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *                 description: Log message text.
 *               level:
 *                 type: string
 *                 enum: [info, warn, error, debug]
 *                 default: info
 *                 description: Log severity level.
 *     responses:
 *       200:
 *         description: Log entry added successfully.
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
 *                   example: Log added successfully
 *                 job:
 *                   $ref: '#/components/schemas/Job'
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Missing required message field.
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
router.post('/:jobId/log', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const { message, level = 'info' } = req.body;
  
  if (!message) {
    throw new ValidationError('Message is required');
  }
  
  const job = await jobHistoryService.addJobLog(jobId, message, level);
  
  res.json({
    success: true,
    message: 'Log added successfully',
    job,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/jobs/{jobId}/progress:
 *   post:
 *     operationId: updateJobProgress
 *     summary: Update job progress
 *     description: Sets the numeric progress (0–100) on a running job, optionally with a status message.
 *     tags:
 *       - Job History
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job UUID.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - progress
 *             properties:
 *               progress:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 100
 *                 description: Completion percentage.
 *               message:
 *                 type: string
 *                 description: Optional progress status message.
 *     responses:
 *       200:
 *         description: Progress updated successfully.
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
 *                   example: Progress updated successfully
 *                 job:
 *                   $ref: '#/components/schemas/Job'
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Progress value out of range.
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
router.post('/:jobId/progress', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const { progress, message } = req.body;
  
  if (progress === undefined || progress < 0 || progress > 100) {
    throw new ValidationError('Progress must be between 0 and 100');
  }
  
  const job = await jobHistoryService.updateJobProgress(jobId, progress, message);
  
  res.json({
    success: true,
    message: 'Progress updated successfully',
    job,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/jobs/{jobId}/complete:
 *   post:
 *     operationId: completeJob
 *     summary: Mark a job as complete
 *     description: Finalises a job, recording the result payload and setting its status to completed or failed.
 *     tags:
 *       - Job History
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job UUID.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               result:
 *                 type: object
 *                 description: Result payload to store on the job record.
 *               success:
 *                 type: boolean
 *                 default: true
 *                 description: Whether the job completed successfully.
 *     responses:
 *       200:
 *         description: Job marked as complete.
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
 *                   example: Job completed successfully
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
router.post('/:jobId/complete', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const { result, success = true } = req.body;
  
  const job = await jobHistoryService.completeJob(jobId, result, success);
  
  res.json({
    success: true,
    message: 'Job completed successfully',
    job,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/jobs/cleanup:
 *   post:
 *     operationId: cleanupOldJobs
 *     summary: Clean up old jobs
 *     description: Deletes job records older than the specified number of days to free database space.
 *     tags:
 *       - Job History
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               daysToKeep:
 *                 type: integer
 *                 default: 30
 *                 description: Jobs older than this many days will be deleted.
 *     responses:
 *       200:
 *         description: Cleanup completed successfully.
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
 *                   example: Cleaned up 12 old jobs
 *                 deletedCount:
 *                   type: integer
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
router.post('/cleanup', asyncHandler(async (req, res) => {
  const { daysToKeep = 30 } = req.body;
  
  const deletedCount = await jobHistoryService.cleanupOldJobs(daysToKeep);
  
  res.json({
    success: true,
    message: `Cleaned up ${deletedCount} old jobs`,
    deletedCount,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/jobs:
 *   get:
 *     operationId: listAllJobs
 *     summary: List all jobs
 *     description: Returns up to 100 most recent jobs. Provided for backward compatibility; prefer `/api/jobs/history` for pagination support.
 *     tags:
 *       - Job History
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Jobs retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 jobs:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Job'
 *                 total:
 *                   type: integer
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
// Get all jobs (backward compatibility)
router.get('/', asyncHandler(async (req, res) => {
  const result = await jobHistoryService.getJobHistory(100, 0);
  
  res.json({
    success: true,
    jobs: result.jobs,
    total: result.total,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/jobs/{jobId}/logs:
 *   get:
 *     summary: Get job logs from file storage
 *     description: Retrieve execution logs for a specific job with pagination or tail mode. Logs are stored in files for better scalability.
 *     tags: [Job Logs]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job UUID
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Starting position for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 1000
 *         description: Maximum number of log entries to return
 *       - in: query
 *         name: tail
 *         schema:
 *           type: integer
 *         description: Get last N log entries (overrides offset/limit)
 *     responses:
 *       200:
 *         description: Logs retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LogsResponse'
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *     security:
 *       - bearerAuth: []
 */
router.get('/:jobId/logs', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const { offset = 0, limit = 1000, tail } = req.query;
  
  try {
    let logs;
    
    if (tail) {
      // Get last N logs (tail mode)
      logs = await logStorageService.readLastLogs(jobId, parseInt(tail));
      res.json({
        success: true,
        logs,
        total: logs.length,
        tail: parseInt(tail),
        timestamp: new Date().toISOString(),
      });
    } else {
      // Get paginated logs
      const result = await logStorageService.readLogsPaginated(
        jobId,
        parseInt(offset),
        parseInt(limit)
      );
      res.json({
        success: true,
        ...result,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    logger.logError(error, { operation: 'getJobLogs', jobId });
    throw error;
  }
}));

/**
 * @swagger
 * /api/jobs/{jobId}/logs/download:
 *   get:
 *     summary: Download complete job log file
 *     description: Stream the entire log file for download. Efficient for large log files.
 *     tags: [Job Logs]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job UUID
 *     responses:
 *       200:
 *         description: Log file streamed successfully
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: |
 *                 [2025-10-28T17:12:06.127Z] [INFO ] SFDX Authenticated
 *                 [2025-10-28T17:12:06.128Z] [INFO ] Creating file >> export\Product.json
 *                 [2025-10-28T17:12:06.142Z] [INFO ] Export success:
 *                 [2025-10-28T17:12:06.143Z] [INFO ] 10 Completed
 *         headers:
 *           Content-Disposition:
 *             schema:
 *               type: string
 *               example: attachment; filename="Job_Name_abc123.log"
 *       404:
 *         description: Log file not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *     security:
 *       - bearerAuth: []
 */
router.get('/:jobId/logs/download', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  
  try {
    const stream = await logStorageService.streamLogFile(jobId);
    
    if (!stream) {
      throw new NotFoundError(`Log file for job '${jobId}' not found`);
    }
    
    const { Job } = require('../models');
    const job = await Job.findOne({ where: { id: jobId } });
    const jobName = job ? job.name.replace(/[^a-z0-9]/gi, '_') : jobId;
    
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${jobName}_${jobId}.log"`);
    
    stream.pipe(res);
  } catch (error) {
    logger.logError(error, { operation: 'downloadJobLogs', jobId });
    throw error;
  }
}));

/**
 * @swagger
 * /api/jobs/{jobId}/logs/stats:
 *   get:
 *     summary: Get log file statistics
 *     description: Retrieve metadata about the log file including size, line count, and timestamps.
 *     tags: [Job Logs]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job UUID
 *     responses:
 *       200:
 *         description: Log statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LogStats'
 *       404:
 *         description: Job or log file not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *     security:
 *       - bearerAuth: []
 */
/**
 * @swagger
 * /api/jobs/{jobId}/errors/analyze:
 *   post:
 *     operationId: analyzeJobErrors
 *     summary: Analyze job errors
 *     description: Parses error log entries from a job to extract Salesforce record IDs and generate SOQL diagnostic queries.
 *     tags:
 *       - Job History
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job UUID.
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
 *                 description: Salesforce org username used to contextualise the error analysis.
 *     responses:
 *       200:
 *         description: Error analysis completed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 analyzed:
 *                   type: boolean
 *                 soqlQueries:
 *                   type: array
 *                   items:
 *                     type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Username is required.
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
router.post('/:jobId/errors/analyze', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const { username } = req.body;
  
  if (!username) {
    throw new ValidationError('Username is required for error analysis');
  }
  
  // Get job details to find errors
  const job = await jobHistoryService.getJobById(jobId);
  if (!job) {
    throw new NotFoundError(`Job ${jobId} not found`);
  }
  
  // Extract errors from job logs
  const logs = await logStorageService.readLogs(jobId);
  const errors = logs.filter(log => 
    log.level === 'error' || 
    (log.message && log.message.toLowerCase().includes('error'))
  );
  
  if (errors.length === 0) {
    return res.json({
      success: true,
      analyzed: false,
      message: 'No errors found in job logs'
    });
  }
  
  // Analyze errors
  const analysis = await errorAnalysisService.analyzeErrors(errors, username);
  
  res.json({
    success: true,
    ...analysis,
    timestamp: new Date().toISOString()
  });
}));

router.get('/:jobId/logs/stats', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  
  try {
    const stats = await logStorageService.getLogStats(jobId);
    
    res.json({
      success: true,
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.logError(error, { operation: 'getJobLogStats', jobId });
    throw error;
  }
}));

module.exports = router;
