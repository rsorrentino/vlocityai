const express = require('express');
const router = express.Router();
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const tempFileService = require('../services/tempFileService');

/**
 * @swagger
 * /api/temp-files/config:
 *   get:
 *     summary: Get current KEEP_TMP configuration
 *     description: Retrieve the current KEEP_TMP mode status and temporary directory configuration
 *     tags: [Temp Files]
 *     responses:
 *       200:
 *         description: Configuration retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/TempFileConfig'
 */
router.get('/config', asyncHandler(async (req, res) => {
  const config = {
    keepTmpMode: tempFileService.getKeepTmpMode(),
    tempDir: tempFileService.tempDir
  };
  
  res.json({
    success: true,
    data: config,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/temp-files/keep-tmp:
 *   post:
 *     summary: Enable or disable KEEP_TMP mode
 *     description: Toggle KEEP_TMP mode which controls whether temporary files are retained after job completion
 *     tags: [Temp Files]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - enabled
 *             properties:
 *               enabled:
 *                 type: boolean
 *                 description: Enable KEEP_TMP mode
 *                 example: false
 *     responses:
 *       200:
 *         description: KEEP_TMP mode updated successfully
 */
router.post('/keep-tmp', asyncHandler(async (req, res) => {
  const { enabled } = req.body;
  
  if (typeof enabled !== 'boolean') {
    throw new ValidationError('enabled must be a boolean value');
  }
  
  tempFileService.setKeepTmpMode(enabled);
  
  res.json({
    success: true,
    message: `KEEP_TMP mode ${enabled ? 'enabled' : 'disabled'}`,
    data: {
      keepTmpMode: tempFileService.getKeepTmpMode(),
      timestamp: new Date().toISOString(),
    },
  });
}));

/**
 * @route GET /api/temp-files/stats
 * @desc Get temporary file statistics
 * @access Public
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const stats = await tempFileService.getTempFileStats();
  
  res.json({
    success: true,
    data: stats,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route GET /api/temp-files/jobs/:jobId
 * @desc Get tracked files for a specific job
 * @access Public
 */
router.get('/jobs/:jobId', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  
  if (!jobId) {
    throw new ValidationError('Job ID is required');
  }
  
  const trackedFiles = Array.from(tempFileService.getTrackedFiles(jobId));
  
  res.json({
    success: true,
    data: {
      jobId,
      trackedFiles,
      count: trackedFiles.length,
      keepTmpMode: tempFileService.getKeepTmpMode(),
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route POST /api/temp-files/jobs/:jobId/cleanup
 * @desc Clean up temporary files for a specific job
 * @access Public
 */
router.post('/jobs/:jobId/cleanup', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const { force = false } = req.body;
  
  if (!jobId) {
    throw new ValidationError('Job ID is required');
  }
  
  const result = await tempFileService.cleanupJobTempFiles(jobId, force);
  
  res.json({
    success: true,
    message: `Cleaned up ${result.cleaned} files, retained ${result.retained} files`,
    data: {
      jobId,
      ...result,
      keepTmpMode: tempFileService.getKeepTmpMode(),
      timestamp: new Date().toISOString(),
    },
  });
}));

/**
 * @route POST /api/temp-files/jobs/:jobId/archive
 * @desc Archive temporary files for a specific job
 * @access Public
 */
router.post('/jobs/:jobId/archive', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  
  if (!jobId) {
    throw new ValidationError('Job ID is required');
  }
  
  const result = await tempFileService.archiveJobTempFiles(jobId);
  
  res.json({
    success: true,
    message: `Archived ${result.archived} files`,
    data: {
      jobId,
      ...result,
      timestamp: new Date().toISOString(),
    },
  });
}));

/**
 * @route POST /api/temp-files/cleanup-all
 * @desc Clean up all old temporary files
 * @access Public
 */
router.post('/cleanup-all', asyncHandler(async (req, res) => {
  const { olderThanHours = 24 } = req.body;
  
  if (typeof olderThanHours !== 'number' || olderThanHours < 1) {
    throw new ValidationError('olderThanHours must be a positive number');
  }
  
  const result = await tempFileService.cleanupAllTempFiles(olderThanHours);
  
  res.json({
    success: true,
    message: `Cleaned up ${result.cleaned} old temporary directories`,
    data: {
      ...result,
      olderThanHours,
      timestamp: new Date().toISOString(),
    },
  });
}));

/**
 * @route POST /api/temp-files/create
 * @desc Create a temporary file
 * @access Public
 */
router.post('/create', asyncHandler(async (req, res) => {
  const { jobId, filename, content = '', subdir = '', extension = '' } = req.body;
  
  if (!jobId) {
    throw new ValidationError('Job ID is required');
  }
  
  const filePath = await tempFileService.createTempFile(jobId, filename, content, {
    subdir,
    extension
  });
  
  res.json({
    success: true,
    message: 'Temporary file created successfully',
    data: {
      jobId,
      filePath,
      filename: filename || `temp_${Date.now()}${extension}`,
      subdir,
      size: content.length,
      keepTmpMode: tempFileService.getKeepTmpMode(),
      timestamp: new Date().toISOString(),
    },
  });
}));

/**
 * @route POST /api/temp-files/copy
 * @desc Copy a file to temporary location
 * @access Public
 */
router.post('/copy', asyncHandler(async (req, res) => {
  const { jobId, sourcePath, subdir = '', filename = null } = req.body;
  
  if (!jobId) {
    throw new ValidationError('Job ID is required');
  }
  
  if (!sourcePath) {
    throw new ValidationError('Source path is required');
  }
  
  const destPath = await tempFileService.copyToTemp(jobId, sourcePath, {
    subdir,
    filename
  });
  
  res.json({
    success: true,
    message: 'File copied to temporary location successfully',
    data: {
      jobId,
      sourcePath,
      destPath,
      filename: filename || require('path').basename(sourcePath),
      subdir,
      keepTmpMode: tempFileService.getKeepTmpMode(),
      timestamp: new Date().toISOString(),
    },
  });
}));

module.exports = router;
