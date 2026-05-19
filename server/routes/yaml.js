const express = require('express');
const router = express.Router();
const yamlConfigService = require('../services/yamlConfigService');
const configValidator = require('../services/configValidator');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

/**
 * @swagger
 * /api/yaml/configs:
 *   get:
 *     operationId: listYamlConfigs
 *     summary: List YAML configs
 *     description: Returns all YAML configuration files, optionally filtered by type or environment
 *     tags: [YAML Configuration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by configuration type
 *       - in: query
 *         name: environment
 *         schema:
 *           type: string
 *         description: Filter by environment
 *     responses:
 *       200:
 *         description: List of YAML configurations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 configs:
 *                   type: array
 *                   items:
 *                     type: object
 *                 count:
 *                   type: integer
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
router.get('/configs', asyncHandler(async (req, res) => {
  const { type, environment } = req.query;
  
  let configs = await yamlConfigService.getConfigFiles();
  
  // Filter by type if specified
  if (type) {
    configs = configs.filter(config => config.type === type);
  }
  
  // Filter by environment if specified
  if (environment) {
    configs = configs.filter(config => config.environment === environment);
  }
  
  res.json({
    configs,
    count: configs.length,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/yaml/configs/{filename}:
 *   get:
 *     operationId: getYamlConfig
 *     summary: Get YAML config
 *     description: Retrieve a specific YAML configuration file by filename
 *     tags: [YAML Configuration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *         description: Configuration filename
 *     responses:
 *       200:
 *         description: Configuration file content
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 config:
 *                   type: object
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       404:
 *         description: Configuration not found
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
router.get('/configs/:filename', asyncHandler(async (req, res) => {
  const { filename } = req.params;
  
  const config = await yamlConfigService.getConfig(filename);
  
  res.json({
    config,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/yaml/configs:
 *   post:
 *     operationId: createYamlConfig
 *     summary: Create YAML config
 *     description: Create and persist a new YAML configuration file
 *     tags: [YAML Configuration]
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
 *               - type
 *             properties:
 *               name:
 *                 type: string
 *               type:
 *                 type: string
 *               environment:
 *                 type: string
 *     responses:
 *       201:
 *         description: Configuration created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 config:
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
router.post('/configs', asyncHandler(async (req, res) => {
  const configData = req.body;
  
  // Validate required fields
  if (!configData.name || !configData.type) {
    throw new ValidationError('Name and type are required');
  }
  
  // Validate configuration
  const validation = yamlConfigService.validateConfig(configData);
  if (!validation.valid) {
    throw new ValidationError(`Configuration validation failed: ${validation.errors.join(', ')}`);
  }
  
  const config = await yamlConfigService.createConfig(configData);
  
  res.status(201).json({
    success: true,
    config,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/yaml/configs/{filename}:
 *   put:
 *     operationId: updateYamlConfig
 *     summary: Update YAML config
 *     description: Replace the contents of an existing YAML configuration file
 *     tags: [YAML Configuration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *         description: Configuration filename to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Configuration updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 config:
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
 *       404:
 *         description: Configuration not found
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
router.put('/configs/:filename', asyncHandler(async (req, res) => {
  const { filename } = req.params;
  const configData = req.body;
  
  // Validate configuration
  const validation = yamlConfigService.validateConfig(configData);
  if (!validation.valid) {
    throw new ValidationError(`Configuration validation failed: ${validation.errors.join(', ')}`);
  }
  
  const config = await yamlConfigService.updateConfig(filename, configData);
  
  res.json({
    success: true,
    config,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/yaml/configs/{filename}:
 *   delete:
 *     operationId: deleteYamlConfig
 *     summary: Delete YAML config
 *     description: Permanently delete a YAML configuration file
 *     tags: [YAML Configuration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *         description: Configuration filename to delete
 *     responses:
 *       200:
 *         description: Configuration deleted
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
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       404:
 *         description: Configuration not found
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
router.delete('/configs/:filename', asyncHandler(async (req, res) => {
  const { filename } = req.params;
  
  const result = await yamlConfigService.deleteConfig(filename);
  
  res.json({
    success: true,
    result,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/yaml/configs/{filename}/clone:
 *   post:
 *     operationId: cloneYamlConfig
 *     summary: Clone YAML config
 *     description: Clone an existing configuration file for a different target environment
 *     tags: [YAML Configuration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *         description: Source configuration filename
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - targetEnvironment
 *             properties:
 *               targetEnvironment:
 *                 type: string
 *                 description: Environment for the cloned configuration
 *     responses:
 *       201:
 *         description: Configuration cloned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 config:
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
 *       404:
 *         description: Source configuration not found
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
router.post('/configs/:filename/clone', asyncHandler(async (req, res) => {
  const { filename } = req.params;
  const { targetEnvironment } = req.body;
  
  if (!targetEnvironment) {
    throw new ValidationError('targetEnvironment is required');
  }
  
  const config = await yamlConfigService.cloneConfig(filename, targetEnvironment);
  
  res.status(201).json({
    success: true,
    config,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/yaml/templates:
 *   get:
 *     operationId: getYamlTemplates
 *     summary: List templates
 *     description: Returns all available YAML configuration templates
 *     tags: [YAML Configuration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Available templates
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 templates:
 *                   type: array
 *                   items:
 *                     type: object
 *                 count:
 *                   type: integer
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
router.get('/templates', asyncHandler(async (req, res) => {
  const templates = await yamlConfigService.getTemplates();
  
  res.json({
    templates,
    count: templates.length,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/yaml/configs/{filename}/validate:
 *   post:
 *     operationId: validateYamlConfig
 *     summary: Validate YAML config
 *     description: Validate the structure and content of a stored YAML configuration file
 *     tags: [YAML Configuration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *         description: Configuration filename to validate
 *     responses:
 *       200:
 *         description: Validation result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 validation:
 *                   type: object
 *                   properties:
 *                     valid:
 *                       type: boolean
 *                     errors:
 *                       type: array
 *                       items:
 *                         type: string
 *                 config:
 *                   type: object
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       404:
 *         description: Configuration not found
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
router.post('/configs/:filename/validate', asyncHandler(async (req, res) => {
  const { filename } = req.params;
  
  const config = await yamlConfigService.getConfig(filename);
  const validation = yamlConfigService.validateConfig(config.config);
  
  res.json({
    validation,
    config: config.config,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/yaml/validate:
 *   post:
 *     operationId: validateYamlData
 *     summary: Validate config data
 *     description: Validate arbitrary configuration data without saving it to disk
 *     tags: [YAML Configuration]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Configuration data to validate
 *     responses:
 *       200:
 *         description: Validation result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 validation:
 *                   type: object
 *                   properties:
 *                     valid:
 *                       type: boolean
 *                     errors:
 *                       type: array
 *                       items:
 *                         type: string
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
router.post('/validate', asyncHandler(async (req, res) => {
  const configData = req.body;
  
  const validation = yamlConfigService.validateConfig(configData);
  
  res.json({
    validation,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/yaml/environments:
 *   get:
 *     operationId: getYamlEnvironments
 *     summary: List environments
 *     description: Returns a distinct sorted list of environment names found across all YAML configurations
 *     tags: [YAML Configuration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Available environments
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 environments:
 *                   type: array
 *                   items:
 *                     type: string
 *                 count:
 *                   type: integer
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
router.get('/environments', asyncHandler(async (req, res) => {
  const configs = await yamlConfigService.getConfigFiles();
  const environments = [...new Set(configs.map(config => config.environment))].sort();
  
  res.json({
    environments,
    count: environments.length,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/yaml/types:
 *   get:
 *     operationId: getYamlTypes
 *     summary: List config types
 *     description: Returns a distinct sorted list of configuration type names found across all YAML configurations
 *     tags: [YAML Configuration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Available configuration types
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 types:
 *                   type: array
 *                   items:
 *                     type: string
 *                 count:
 *                   type: integer
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
router.get('/types', asyncHandler(async (req, res) => {
  const configs = await yamlConfigService.getConfigFiles();
  const types = [...new Set(configs.map(config => config.type))].sort();
  
  res.json({
    types,
    count: types.length,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/yaml/configs/{filename}/test:
 *   post:
 *     operationId: testYamlConfig
 *     summary: Test YAML config
 *     description: Run a live test of a stored YAML configuration against a Salesforce org
 *     tags: [YAML Configuration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *         description: Configuration filename to test
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
 *                 description: Salesforce org username to test against
 *     responses:
 *       200:
 *         description: Test results and recommendations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 filename:
 *                   type: string
 *                 username:
 *                   type: string
 *                 testResults:
 *                   type: object
 *                 recommendations:
 *                   type: array
 *                   items:
 *                     type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Configuration not found
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
router.post('/configs/:filename/test', asyncHandler(async (req, res) => {
  const { filename } = req.params;
  const { username } = req.body;
  
  if (!username) {
    throw new ValidationError('Username is required for testing');
  }
  
  const config = await yamlConfigService.getConfig(filename);
  const testResults = await configValidator.testConfiguration(config.config, username);
  const recommendations = configValidator.generateRecommendations(config.config);
  
  res.json({
    success: true,
    filename,
    username,
    testResults,
    recommendations,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/yaml/test-config:
 *   post:
 *     operationId: testYamlConfigData
 *     summary: Test config data
 *     description: Test arbitrary configuration data against a Salesforce org without saving to disk
 *     tags: [YAML Configuration]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - config
 *               - username
 *             properties:
 *               config:
 *                 type: object
 *                 description: Configuration data to test
 *               username:
 *                 type: string
 *                 description: Salesforce org username
 *     responses:
 *       200:
 *         description: Test results and recommendations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 testResults:
 *                   type: object
 *                 recommendations:
 *                   type: array
 *                   items:
 *                     type: string
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
router.post('/test-config', asyncHandler(async (req, res) => {
  const { config, username } = req.body;
  
  if (!config) {
    throw new ValidationError('Configuration data is required');
  }
  
  if (!username) {
    throw new ValidationError('Username is required for testing');
  }
  
  const testResults = await configValidator.testConfiguration(config, username);
  const recommendations = configValidator.generateRecommendations(config);
  
  res.json({
    success: true,
    testResults,
    recommendations,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/yaml/configs/{filename}/recommendations:
 *   get:
 *     operationId: getYamlConfigRecommendations
 *     summary: Get config recommendations
 *     description: Generate improvement recommendations for a stored YAML configuration
 *     tags: [YAML Configuration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema:
 *           type: string
 *         description: Configuration filename
 *     responses:
 *       200:
 *         description: Recommendations for the configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 filename:
 *                   type: string
 *                 recommendations:
 *                   type: array
 *                   items:
 *                     type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       404:
 *         description: Configuration not found
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
router.get('/configs/:filename/recommendations', asyncHandler(async (req, res) => {
  const { filename } = req.params;
  
  const config = await yamlConfigService.getConfig(filename);
  const recommendations = configValidator.generateRecommendations(config.config);
  
  res.json({
    success: true,
    filename,
    recommendations,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/yaml/bulk/delete:
 *   post:
 *     operationId: bulkDeleteYamlConfigs
 *     summary: Bulk delete configs
 *     description: Delete multiple YAML configuration files in one request
 *     tags: [YAML Configuration]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - filenames
 *             properties:
 *               filenames:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Bulk delete results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
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
router.post('/bulk/delete', asyncHandler(async (req, res) => {
  const { filenames } = req.body;
  
  if (!filenames || !Array.isArray(filenames)) {
    throw new ValidationError('filenames array is required');
  }
  
  const results = await yamlConfigService.bulkDelete(filenames);
  
  res.json({
    success: true,
    results,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/yaml/bulk/clone:
 *   post:
 *     operationId: bulkCloneYamlConfigs
 *     summary: Bulk clone configs
 *     description: Clone a single source configuration file to multiple target environments
 *     tags: [YAML Configuration]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sourceFilename
 *               - targetEnvironments
 *             properties:
 *               sourceFilename:
 *                 type: string
 *               targetEnvironments:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Bulk clone results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
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
router.post('/bulk/clone', asyncHandler(async (req, res) => {
  const { sourceFilename, targetEnvironments } = req.body;
  
  if (!sourceFilename) {
    throw new ValidationError('sourceFilename is required');
  }
  
  if (!targetEnvironments || !Array.isArray(targetEnvironments)) {
    throw new ValidationError('targetEnvironments array is required');
  }
  
  const results = await yamlConfigService.bulkClone(sourceFilename, targetEnvironments);
  
  res.json({
    success: true,
    results,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/yaml/bulk/update:
 *   post:
 *     operationId: bulkUpdateYamlConfigs
 *     summary: Bulk update configs
 *     description: Apply the same update data to multiple YAML configuration files
 *     tags: [YAML Configuration]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - filenames
 *               - updateData
 *             properties:
 *               filenames:
 *                 type: array
 *                 items:
 *                   type: string
 *               updateData:
 *                 type: object
 *     responses:
 *       200:
 *         description: Bulk update results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
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
router.post('/bulk/update', asyncHandler(async (req, res) => {
  const { filenames, updateData } = req.body;
  
  if (!filenames || !Array.isArray(filenames)) {
    throw new ValidationError('filenames array is required');
  }
  
  if (!updateData) {
    throw new ValidationError('updateData is required');
  }
  
  const results = await yamlConfigService.bulkUpdate(filenames, updateData);
  
  res.json({
    success: true,
    results,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/yaml/bulk/validate:
 *   post:
 *     operationId: bulkValidateYamlConfigs
 *     summary: Bulk validate configs
 *     description: Validate multiple YAML configuration files in one request
 *     tags: [YAML Configuration]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - filenames
 *             properties:
 *               filenames:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Bulk validation results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
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
router.post('/bulk/validate', asyncHandler(async (req, res) => {
  const { filenames } = req.body;
  
  if (!filenames || !Array.isArray(filenames)) {
    throw new ValidationError('filenames array is required');
  }
  
  const results = await yamlConfigService.bulkValidate(filenames);
  
  res.json({
    success: true,
    results,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/yaml/bulk/export:
 *   post:
 *     operationId: bulkExportYamlConfigs
 *     summary: Bulk export configs
 *     description: Export multiple YAML configuration files in the specified format
 *     tags: [YAML Configuration]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - filenames
 *             properties:
 *               filenames:
 *                 type: array
 *                 items:
 *                   type: string
 *               format:
 *                 type: string
 *                 enum: [yaml, json]
 *                 default: yaml
 *     responses:
 *       200:
 *         description: Bulk export results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
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
router.post('/bulk/export', asyncHandler(async (req, res) => {
  const { filenames, format = 'yaml' } = req.body;
  
  if (!filenames || !Array.isArray(filenames)) {
    throw new ValidationError('filenames array is required');
  }
  
  const results = await yamlConfigService.bulkExport(filenames, format);
  
  res.json({
    success: true,
    results,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/yaml/bulk/import:
 *   post:
 *     operationId: bulkImportYamlConfigs
 *     summary: Bulk import configs
 *     description: Import multiple YAML configuration objects in one request
 *     tags: [YAML Configuration]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - configs
 *             properties:
 *               configs:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: Bulk import results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
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
router.post('/bulk/import', asyncHandler(async (req, res) => {
  const { configs } = req.body;
  
  if (!configs || !Array.isArray(configs)) {
    throw new ValidationError('configs array is required');
  }
  
  const results = await yamlConfigService.bulkImport(configs);
  
  res.json({
    success: true,
    results,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/yaml/report:
 *   get:
 *     operationId: getYamlReport
 *     summary: Configuration report
 *     description: Generate a summary report across all YAML configuration files
 *     tags: [YAML Configuration]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Configuration report
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 report:
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
router.get('/report', asyncHandler(async (req, res) => {
  const report = await yamlConfigService.generateReport();
  
  res.json({
    success: true,
    report,
    timestamp: new Date().toISOString(),
  });
}));

module.exports = router;
