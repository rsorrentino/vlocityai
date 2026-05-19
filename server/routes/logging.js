const express = require('express');
const router = express.Router();
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

/**
 * @swagger
 * /api/logging/config:
 *   get:
 *     summary: Get current logging configuration
 *     description: Retrieve the current logging configuration including verbose/debug modes and log level
 *     tags: [Logging]
 *     responses:
 *       200:
 *         description: Logging configuration retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/LoggingConfig'
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 */
router.get('/config', asyncHandler(async (req, res) => {
  const config = logger.getLoggingConfig();
  
  res.json({
    success: true,
    data: config,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/logging/verbose:
 *   post:
 *     summary: Enable or disable verbose mode
 *     description: Toggle verbose logging mode which provides detailed operational logs
 *     tags: [Logging]
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
 *                 description: Enable verbose mode
 *                 example: true
 *     responses:
 *       200:
 *         description: Verbose mode updated successfully
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
 *                   example: Verbose mode enabled
 *                 data:
 *                   $ref: '#/components/schemas/LoggingConfig'
 */
router.post('/verbose', asyncHandler(async (req, res) => {
  const { enabled } = req.body;
  
  if (typeof enabled !== 'boolean') {
    throw new ValidationError('enabled must be a boolean value');
  }
  
  if (enabled) {
    logger.enableVerboseMode();
  } else {
    logger.disableVerboseMode();
  }
  
  const config = logger.getLoggingConfig();
  
  res.json({
    success: true,
    message: `Verbose mode ${enabled ? 'enabled' : 'disabled'}`,
    data: config,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/logging/debug:
 *   post:
 *     summary: Enable or disable debug mode
 *     description: Toggle debug logging mode which provides the most detailed logs including internal operations
 *     tags: [Logging]
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
 *                 description: Enable debug mode
 *                 example: false
 *     responses:
 *       200:
 *         description: Debug mode updated successfully
 */
router.post('/debug', asyncHandler(async (req, res) => {
  const { enabled } = req.body;
  
  if (typeof enabled !== 'boolean') {
    throw new ValidationError('enabled must be a boolean value');
  }
  
  if (enabled) {
    logger.enableDebugMode();
  } else {
    logger.disableDebugMode();
  }
  
  const config = logger.getLoggingConfig();
  
  res.json({
    success: true,
    message: `Debug mode ${enabled ? 'enabled' : 'disabled'}`,
    data: config,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/logging/mode:
 *   post:
 *     summary: Set logging mode (verbose and debug)
 *     description: Set both verbose and debug modes simultaneously
 *     tags: [Logging]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               verbose:
 *                 type: boolean
 *                 description: Enable verbose mode
 *                 example: true
 *               debug:
 *                 type: boolean
 *                 description: Enable debug mode
 *                 example: false
 *     responses:
 *       200:
 *         description: Logging mode set successfully
 */
router.post('/mode', asyncHandler(async (req, res) => {
  const { verbose = false, debug = false } = req.body;
  
  if (typeof verbose !== 'boolean') {
    throw new ValidationError('verbose must be a boolean value');
  }
  
  if (typeof debug !== 'boolean') {
    throw new ValidationError('debug must be a boolean value');
  }
  
  logger.setLoggingMode(verbose, debug);
  
  const config = logger.getLoggingConfig();
  const mode = debug ? 'debug' : (verbose ? 'verbose' : 'normal');
  
  res.json({
    success: true,
    message: `Logging mode set to: ${mode}`,
    data: config,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route POST /api/logging/cleanup
 * @desc Clean up old log files
 * @access Public
 */
router.post('/cleanup', asyncHandler(async (req, res) => {
  const { olderThanDays = 30 } = req.body;
  
  if (typeof olderThanDays !== 'number' || olderThanDays < 1) {
    throw new ValidationError('olderThanDays must be a positive number');
  }
  
  const cleanedCount = await logger.cleanupLogs(olderThanDays);
  
  res.json({
    success: true,
    message: `Cleaned up ${cleanedCount} old log files`,
    data: {
      cleanedCount,
      olderThanDays,
      timestamp: new Date().toISOString(),
    },
  });
}));

/**
 * @route GET /api/logging/jobs/:jobId/logs
 * @desc Get logs for a specific job
 * @access Public
 */
router.get('/jobs/:jobId/logs', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const { level = 'all', limit = 100, offset = 0 } = req.query;
  
  if (!jobId) {
    throw new ValidationError('Job ID is required');
  }
  
  // This would typically read from the job log files
  // For now, we'll return a placeholder response
  res.json({
    success: true,
    message: 'Job logs retrieved',
    data: {
      jobId,
      level,
      limit: parseInt(limit),
      offset: parseInt(offset),
      logs: [], // Would be populated from actual log files
      timestamp: new Date().toISOString(),
    },
  });
}));

/**
 * @route POST /api/logging/test
 * @desc Test logging functionality
 * @access Public
 */
router.post('/test', asyncHandler(async (req, res) => {
  const { message = 'Test log message', level = 'info' } = req.body;
  
  // Test different logging levels
  logger.log(level, message, { test: true });
  logger.logVerbose('This is a verbose test message', { test: true });
  logger.logDebug('This is a debug test message', { test: true });
  
  const config = logger.getLoggingConfig();
  
  res.json({
    success: true,
    message: 'Test logs generated',
    data: {
      config,
      testMessage: message,
      testLevel: level,
      timestamp: new Date().toISOString(),
    },
  });
}));

module.exports = router;
