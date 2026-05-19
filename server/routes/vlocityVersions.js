const express = require('express');
const router = express.Router();
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const vlocityVersionService = require('../services/vlocityVersionService');

/**
 * @swagger
 * /api/vlocity/versions:
 *   get:
 *     summary: Get available Vlocity versions
 *     description: Retrieve list of all available Vlocity CLI versions
 *     tags: [Versions]
 *     responses:
 *       200:
 *         description: Versions retrieved successfully
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
 *                   properties:
 *                     versions:
 *                       type: array
 *                       items:
 *                         type: string
 *                         example: '1.17.18'
 *                     defaultVersion:
 *                       type: string
 *                       example: '1.17.18'
 *                     totalVersions:
 *                       type: number
 */
router.get('/', asyncHandler(async (req, res) => {
  const versions = vlocityVersionService.getAvailableVersions();
  const stats = vlocityVersionService.getVersionStats();
  
  res.json({
    success: true,
    data: {
      versions,
      defaultVersion: stats.defaultVersion,
      totalVersions: stats.totalVersions,
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route GET /api/vlocity/versions/stats
 * @desc Get version statistics
 * @access Public
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const stats = vlocityVersionService.getVersionStats();
  
  res.json({
    success: true,
    data: stats,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/versions/validate:
 *   post:
 *     summary: Validate a specific version
 *     description: Check if a Vlocity version is available and valid
 *     tags: [Versions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - version
 *             properties:
 *               version:
 *                 type: string
 *                 description: Vlocity version to validate
 *                 example: '1.17.18'
 *               jobId:
 *                 type: string
 *                 description: Optional job ID for logging
 *     responses:
 *       200:
 *         description: Version validation result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/VersionInfo'
 */
router.post('/validate', asyncHandler(async (req, res) => {
  const { version, jobId = null } = req.body;
  
  if (!version) {
    throw new ValidationError('Version is required');
  }
  
  const validation = await vlocityVersionService.validateJobVersion(version, jobId);
  
  res.json({
    success: true,
    message: validation.message,
    data: validation,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route GET /api/vlocity/versions/job/:jobId
 * @desc Get version info for a specific job
 * @access Public
 */
router.get('/job/:jobId', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const { version = null } = req.query;
  
  if (!jobId) {
    throw new ValidationError('Job ID is required');
  }
  
  const versionInfo = vlocityVersionService.getJobVersionInfo(version);
  
  res.json({
    success: true,
    data: {
      jobId,
      ...versionInfo,
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route POST /api/vlocity/versions/default
 * @desc Set default version
 * @access Public
 */
router.post('/default', asyncHandler(async (req, res) => {
  const { version } = req.body;
  
  if (!version) {
    throw new ValidationError('Version is required');
  }
  
  const success = vlocityVersionService.setDefaultVersion(version);
  
  if (!success) {
    throw new ValidationError(`Version ${version} is not available`);
  }
  
  res.json({
    success: true,
    message: `Default version set to ${version}`,
    data: {
      defaultVersion: version,
      availableVersions: vlocityVersionService.getAvailableVersions(),
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route POST /api/vlocity/versions/add
 * @desc Add a version to available versions
 * @access Public
 */
router.post('/add', asyncHandler(async (req, res) => {
  const { version } = req.body;
  
  if (!version) {
    throw new ValidationError('Version is required');
  }
  
  // Validate version format (basic check)
  const versionRegex = /^\d+\.\d+\.\d+$/;
  if (!versionRegex.test(version)) {
    throw new ValidationError('Version must be in format x.y.z (e.g., 1.17.18)');
  }
  
  vlocityVersionService.addVersion(version);
  
  res.json({
    success: true,
    message: `Version ${version} added to available versions`,
    data: {
      version,
      availableVersions: vlocityVersionService.getAvailableVersions(),
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route DELETE /api/vlocity/versions/:version
 * @desc Remove a version from available versions
 * @access Public
 */
router.delete('/:version', asyncHandler(async (req, res) => {
  const { version } = req.params;
  
  if (!version) {
    throw new ValidationError('Version is required');
  }
  
  const removed = vlocityVersionService.removeVersion(version);
  
  if (!removed) {
    throw new ValidationError(`Version ${version} was not found in available versions`);
  }
  
  res.json({
    success: true,
    message: `Version ${version} removed from available versions`,
    data: {
      version,
      availableVersions: vlocityVersionService.getAvailableVersions(),
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route POST /api/vlocity/versions/refresh
 * @desc Refresh available versions
 * @access Public
 */
router.post('/refresh', asyncHandler(async (req, res) => {
  await vlocityVersionService.refreshAvailableVersions();
  
  const stats = vlocityVersionService.getVersionStats();
  
  res.json({
    success: true,
    message: 'Available versions refreshed',
    data: stats,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route POST /api/vlocity/versions/clear-cache
 * @desc Clear version cache
 * @access Public
 */
router.post('/clear-cache', asyncHandler(async (req, res) => {
  vlocityVersionService.clearCache();
  
  res.json({
    success: true,
    message: 'Version cache cleared',
    data: {
      availableVersions: vlocityVersionService.getAvailableVersions(),
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route GET /api/vlocity/versions/check/:version
 * @desc Check if a specific version is available
 * @access Public
 */
router.get('/check/:version', asyncHandler(async (req, res) => {
  const { version } = req.params;
  
  if (!version) {
    throw new ValidationError('Version is required');
  }
  
  const isAvailable = await vlocityVersionService.validateVersion(version);
  
  res.json({
    success: true,
    data: {
      version,
      isAvailable,
      command: vlocityVersionService.getVersionCommand(version),
    },
    timestamp: new Date().toISOString(),
  });
}));

module.exports = router;
