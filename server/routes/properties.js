const express = require('express');
const router = express.Router();
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const propertiesService = require('../services/propertiesService');

/**
 * @swagger
 * /api/properties:
 *   get:
 *     operationId: getProperties
 *     summary: Get properties
 *     description: Load properties from files with optional environment filtering and custom fallback order
 *     tags: [Properties]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: environment
 *         schema:
 *           type: string
 *         description: Environment name to filter properties (e.g. dev, uat, prod)
 *       - in: query
 *         name: fallbackOrder
 *         schema:
 *           type: string
 *         description: Comma-separated list of .properties filenames defining fallback order
 *     responses:
 *       200:
 *         description: Properties loaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/PropertiesConfig'
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', asyncHandler(async (req, res) => {
  const { environment = null, fallbackOrder = null } = req.query;
  
  const customFallbackOrder = fallbackOrder ? fallbackOrder.split(',') : null;
  const result = await propertiesService.loadProperties(environment, customFallbackOrder);
  
  res.json({
    success: true,
    data: result,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/properties/{key}:
 *   get:
 *     operationId: getProperty
 *     summary: Get property by key
 *     description: Retrieve a single property value by key, with optional environment and default value
 *     tags: [Properties]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: Property key name
 *       - in: query
 *         name: environment
 *         schema:
 *           type: string
 *         description: Environment name to scope the lookup
 *       - in: query
 *         name: defaultValue
 *         schema:
 *           type: string
 *         description: Value to return if the property is not found
 *     responses:
 *       200:
 *         description: Property value
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
 *                     key:
 *                       type: string
 *                     value:
 *                       type: string
 *                     environment:
 *                       type: string
 *                     defaultValue:
 *                       type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error
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
router.get('/:key', asyncHandler(async (req, res) => {
  const { key } = req.params;
  const { environment = null, defaultValue = null } = req.query;
  
  if (!key) {
    throw new ValidationError('Property key is required');
  }
  
  const value = await propertiesService.getProperty(key, environment, defaultValue);
  
  res.json({
    success: true,
    data: {
      key,
      value,
      environment,
      defaultValue
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/properties/{key}:
 *   post:
 *     operationId: setProperty
 *     summary: Set property
 *     description: Set or update a property value in a target file
 *     tags: [Properties]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         description: Property key name
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - value
 *             properties:
 *               value:
 *                 type: string
 *                 description: Property value to set
 *               environment:
 *                 type: string
 *                 description: Target environment
 *               targetFile:
 *                 type: string
 *                 description: Specific .properties filename to write into
 *     responses:
 *       200:
 *         description: Property set successfully
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
 *                 data:
 *                   type: object
 *                   properties:
 *                     key:
 *                       type: string
 *                     value:
 *                       type: string
 *                     filePath:
 *                       type: string
 *                     environment:
 *                       type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error
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
router.post('/:key', asyncHandler(async (req, res) => {
  const { key } = req.params;
  const { value, environment = null, targetFile = null } = req.body;
  
  if (!key) {
    throw new ValidationError('Property key is required');
  }
  
  if (value === undefined || value === null) {
    throw new ValidationError('Property value is required');
  }
  
  const filePath = await propertiesService.setProperty(key, value, environment, targetFile);
  
  res.json({
    success: true,
    message: `Property ${key} set successfully`,
    data: {
      key,
      value,
      filePath,
      environment
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/properties/files/available:
 *   get:
 *     operationId: getAvailablePropertiesFiles
 *     summary: List properties files
 *     description: Returns all available .properties files on disk
 *     tags: [Properties]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of available properties files
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
 *                     files:
 *                       type: array
 *                       items:
 *                         type: string
 *                     totalFiles:
 *                       type: integer
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/files/available', asyncHandler(async (req, res) => {
  const files = await propertiesService.getAvailablePropertiesFiles();
  
  res.json({
    success: true,
    data: {
      files,
      totalFiles: files.length
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/properties/files/stats:
 *   get:
 *     operationId: getPropertiesStats
 *     summary: Properties file statistics
 *     description: Returns aggregate statistics across all properties files
 *     tags: [Properties]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Properties statistics
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
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/files/stats', asyncHandler(async (req, res) => {
  const stats = await propertiesService.getPropertiesStats();
  
  res.json({
    success: true,
    data: stats,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/properties/files:
 *   post:
 *     operationId: createPropertiesFile
 *     summary: Create properties file
 *     description: Create a new .properties file with optional initial key-value pairs
 *     tags: [Properties]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - filename
 *             properties:
 *               filename:
 *                 type: string
 *                 description: Must end with .properties
 *                 example: dev.properties
 *               properties:
 *                 type: object
 *                 description: Initial key-value pairs
 *                 additionalProperties:
 *                   type: string
 *               environment:
 *                 type: string
 *     responses:
 *       200:
 *         description: Properties file created
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
 *                 data:
 *                   type: object
 *                   properties:
 *                     filename:
 *                       type: string
 *                     filePath:
 *                       type: string
 *                     propertyCount:
 *                       type: integer
 *                     environment:
 *                       type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error
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
router.post('/files', asyncHandler(async (req, res) => {
  const { filename, properties = {}, environment = null } = req.body;
  
  if (!filename) {
    throw new ValidationError('Filename is required');
  }
  
  if (!filename.endsWith('.properties')) {
    throw new ValidationError('Filename must end with .properties');
  }
  
  const filePath = await propertiesService.createPropertiesFile(filename, properties, environment);
  
  res.json({
    success: true,
    message: `Properties file ${filename} created successfully`,
    data: {
      filename,
      filePath,
      propertyCount: Object.keys(properties).length,
      environment
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/properties/files/{filename}:
 *   delete:
 *     operationId: deletePropertiesFile
 *     summary: Delete properties file
 *     description: Permanently delete a .properties file from disk
 *     tags: [Properties]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the .properties file to delete
 *     responses:
 *       200:
 *         description: Properties file deleted
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
 *                 data:
 *                   type: object
 *                   properties:
 *                     filename:
 *                       type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: File not found or validation error
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
router.delete('/files/:filename', asyncHandler(async (req, res) => {
  const { filename } = req.params;
  
  if (!filename) {
    throw new ValidationError('Filename is required');
  }
  
  const deleted = await propertiesService.deletePropertiesFile(filename);
  
  if (!deleted) {
    throw new ValidationError(`Properties file ${filename} not found`);
  }
  
  res.json({
    success: true,
    message: `Properties file ${filename} deleted successfully`,
    data: {
      filename
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/properties/files/{filename}/validate:
 *   get:
 *     operationId: validatePropertiesFile
 *     summary: Validate properties file
 *     description: Validate the syntax and structure of a .properties file
 *     tags: [Properties]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *         description: Name of the .properties file to validate
 *     responses:
 *       200:
 *         description: Validation result
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
 *                     filename:
 *                       type: string
 *                     filePath:
 *                       type: string
 *                     valid:
 *                       type: boolean
 *                     errors:
 *                       type: array
 *                       items:
 *                         type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error
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
router.get('/files/:filename/validate', asyncHandler(async (req, res) => {
  const { filename } = req.params;
  
  if (!filename) {
    throw new ValidationError('Filename is required');
  }
  
  const filePath = propertiesService.getPropertiesPath(filename);
  const validation = await propertiesService.validatePropertiesFile(filePath);
  
  res.json({
    success: true,
    data: {
      filename,
      filePath,
      ...validation
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/properties/merge:
 *   post:
 *     operationId: mergeProperties
 *     summary: Merge properties
 *     description: Merge properties from multiple source files into a single result
 *     tags: [Properties]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sources
 *             properties:
 *               sources:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of .properties filenames to merge
 *               environment:
 *                 type: string
 *     responses:
 *       200:
 *         description: Merged properties result
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
 *                 data:
 *                   type: object
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error
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
router.post('/merge', asyncHandler(async (req, res) => {
  const { sources, environment = null } = req.body;
  
  if (!sources || !Array.isArray(sources) || sources.length === 0) {
    throw new ValidationError('Sources array is required and must not be empty');
  }
  
  const result = await propertiesService.mergeProperties(sources, environment);
  
  res.json({
    success: true,
    message: `Properties merged from ${result.sourceInfo.length} sources`,
    data: result,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/properties/clear-cache:
 *   post:
 *     operationId: clearPropertiesCache
 *     summary: Clear properties cache
 *     description: Invalidates the in-memory properties cache, forcing a fresh file read on next request
 *     tags: [Properties]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cache cleared
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
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/clear-cache', asyncHandler(async (req, res) => {
  propertiesService.clearCache();
  
  res.json({
    success: true,
    message: 'Properties cache cleared',
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/properties/fallback-order:
 *   get:
 *     operationId: getFallbackOrder
 *     summary: Get fallback order
 *     description: Returns the current properties file fallback resolution order
 *     tags: [Properties]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current fallback order
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
 *                     fallbackOrder:
 *                       type: array
 *                       items:
 *                         type: string
 *                     propertiesDir:
 *                       type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/fallback-order', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      fallbackOrder: propertiesService.fallbackOrder,
      propertiesDir: propertiesService.propertiesDir
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/properties/fallback-order:
 *   post:
 *     operationId: setFallbackOrder
 *     summary: Set fallback order
 *     description: Override the properties file resolution fallback order for the current session
 *     tags: [Properties]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fallbackOrder
 *             properties:
 *               fallbackOrder:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Ordered array of .properties filenames
 *                 example: ["local.properties", "dev.properties", "default.properties"]
 *     responses:
 *       200:
 *         description: Fallback order updated
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
 *                 data:
 *                   type: object
 *                   properties:
 *                     fallbackOrder:
 *                       type: array
 *                       items:
 *                         type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error
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
router.post('/fallback-order', asyncHandler(async (req, res) => {
  const { fallbackOrder } = req.body;
  
  if (!fallbackOrder || !Array.isArray(fallbackOrder)) {
    throw new ValidationError('Fallback order must be an array of filenames');
  }
  
  // Validate all filenames end with .properties
  const invalidFiles = fallbackOrder.filter(filename => !filename.endsWith('.properties'));
  if (invalidFiles.length > 0) {
    throw new ValidationError(`Invalid filenames (must end with .properties): ${invalidFiles.join(', ')}`);
  }
  
  propertiesService.fallbackOrder = fallbackOrder;
  
  res.json({
    success: true,
    message: 'Fallback order updated successfully',
    data: {
      fallbackOrder: propertiesService.fallbackOrder
    },
    timestamp: new Date().toISOString(),
  });
}));

module.exports = router;
