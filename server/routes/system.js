const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const systemStatusService = require('../services/systemStatusService');
const databaseService = require('../services/databaseService');
const cacheService = require('../services/cacheService');
const logger = require('../utils/logger');
const { spawn } = require('child_process');

/**
 * @route GET /api/system/status
 * @desc Get system status
 * @access Public
 */
router.get('/status', asyncHandler(async (req, res) => {
  const status = await systemStatusService.getSystemStatus();
  
  res.json({
    success: true,
    ...status
  });
}));

/**
 * @route GET /api/system/health
 * @desc Get detailed health information
 * @access Public
 */
router.get('/health', asyncHandler(async (req, res) => {
  const dbStatus = databaseService.getConnectionStatus();
  const cacheStatus = cacheService.getConnectionStatus();
  const systemStatus = await systemStatusService.getSystemStatus();
  
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
    services: {
      database: dbStatus,
      cache: cacheStatus,
      system: systemStatus
    },
    memory: {
      used: process.memoryUsage(),
      free: require('os').freemem(),
      total: require('os').totalmem()
    }
  };

  // Determine overall health
  if (dbStatus.connected === false) {
    health.status = 'degraded';
  }
  
  if (systemStatus.overall === 'error') {
    health.status = 'unhealthy';
  }

  res.json(health);
}));

/**
 * @route POST /api/system/refresh-status
 * @desc Manually refresh system status
 * @access Public
 */
router.post('/refresh-status', asyncHandler(async (req, res) => {
  await systemStatusService.performAllChecks();
  
  const status = await systemStatusService.getSystemStatus();
  
  res.json({
    success: true,
    message: 'System status refreshed',
    ...status
  });
}));

/**
 * @swagger
 * /api/system/run-auth-command:
 *   post:
 *     summary: Execute Salesforce authentication command
 *     description: Runs 'sf org login web' command to re-authenticate a Salesforce org. Opens browser for authentication.
 *     tags: [System]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - alias
 *             properties:
 *               alias:
 *                 type: string
 *                 description: Salesforce org alias
 *                 example: AU-MasterCatalogDev
 *               instanceUrl:
 *                 type: string
 *                 description: Salesforce instance URL (optional)
 *                 example: https://test.salesforce.com
 *     responses:
 *       200:
 *         description: Authentication command executed successfully
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
 *                   example: Authentication command executed. Complete the login in your browser.
 *                 alias:
 *                   type: string
 *                   example: AU-MasterCatalogDev
 *                 instanceUrl:
 *                   type: string
 *                   example: https://test.salesforce.com
 *       400:
 *         description: Bad request - alias is required
 *       500:
 *         description: Failed to execute command
 */
router.post('/run-auth-command', asyncHandler(async (req, res) => {
  const { alias, instanceUrl } = req.body;
  
  if (!alias) {
    return res.status(400).json({
      success: false,
      error: 'Alias is required'
    });
  }
  
  try {
    // Build the sf org login web command
    const args = ['org', 'login', 'web', '--alias', alias];
    if (instanceUrl) {
      args.push('--instance-url', instanceUrl);
    }
    
    logger.info(`Executing SF CLI authentication command for alias: ${alias}`);
    
    // Spawn the command in a detached process so it doesn't block
    const child = spawn('sf', args, {
      detached: true,
      stdio: 'ignore', // Don't capture output, let it open browser
      shell: true,
      windowsHide: false // Show the browser window
    });
    
    // Detach the child process so it runs independently
    child.unref();
    
    logger.info(`Authentication command launched for alias: ${alias}`);
    
    res.json({
      success: true,
      message: 'Authentication command executed. Complete the login in your browser.',
      alias,
      instanceUrl
    });
    
  } catch (error) {
    logger.logError(error, { operation: 'runAuthCommand', alias, instanceUrl });
    
    res.status(500).json({
      success: false,
      error: 'Failed to execute authentication command. Please run the command manually in your terminal.'
    });
  }
}));

module.exports = router;
