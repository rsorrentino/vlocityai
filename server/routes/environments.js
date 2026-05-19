const express = require('express');
const router = express.Router();
const environmentService = require('../services/environmentService');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

/**
 * @route GET /api/environments
 * @desc Get all configured environments
 * @access Public
 * **NEW FEATURE**: Multi-environment support (dev/uat/prod)
 */
router.get('/', asyncHandler(async (req, res) => {
  const environments = await environmentService.getAllEnvironments();
  
  logger.logOperation('Environments retrieved', {
    count: environments.length
  });
  
  res.json({
    success: true,
    environments,
    timestamp: new Date().toISOString()
  });
}));

/**
 * @route GET /api/environments/:environment/config
 * @desc Get configuration for a specific environment
 * @access Public
 */
router.get('/:environment/config', asyncHandler(async (req, res) => {
  const { environment } = req.params;
  
  if (!environmentService.isValidEnvironment(environment)) {
    throw new ValidationError(`Invalid environment: ${environment}. Valid values: dev, uat, prod, or empty for default`);
  }
  
  const config = environmentService.getEnvironmentConfig(environment);
  const properties = await environmentService.loadEnvironmentProperties(environment);
  
  logger.logOperation('Environment config retrieved', {
    environment
  });
  
  res.json({
    success: true,
    environment,
    config,
    properties,
    timestamp: new Date().toISOString()
  });
}));

/**
 * @route POST /api/environments/:environment/ensure-directories
 * @desc Ensure all directories for an environment exist
 * @access Public
 */
router.post('/:environment/ensure-directories', asyncHandler(async (req, res) => {
  const { environment } = req.params;
  
  if (!environmentService.isValidEnvironment(environment)) {
    throw new ValidationError(`Invalid environment: ${environment}`);
  }
  
  const result = await environmentService.ensureEnvironmentDirectories(environment);
  
  logger.logOperation('Environment directories ensured', {
    environment,
    directoriesCreated: result.directories.length
  });
  
  res.json({
    success: true,
    message: `Created ${result.directories.length} directories for environment: ${environment || 'default'}`,
    ...result,
    timestamp: new Date().toISOString()
  });
}));

/**
 * @route GET /api/environments/:environment/property/:key
 * @desc Get a specific property value for an environment
 * @access Public
 */
router.get('/:environment/property/:key', asyncHandler(async (req, res) => {
  const { environment, key } = req.params;
  const { defaultValue = '' } = req.query;
  
  if (!environmentService.isValidEnvironment(environment)) {
    throw new ValidationError(`Invalid environment: ${environment}`);
  }
  
  const value = await environmentService.getProperty(key, environment, defaultValue);
  
  logger.logOperation('Environment property retrieved', {
    environment,
    key,
    hasValue: !!value
  });
  
  res.json({
    success: true,
    environment,
    key,
    value,
    timestamp: new Date().toISOString()
  });
}));

/**
 * @route GET /api/environments/:environment/usernames
 * @desc Get source and target usernames for an environment
 * @access Public
 */
router.get('/:environment/usernames', asyncHandler(async (req, res) => {
  const { environment } = req.params;
  
  if (!environmentService.isValidEnvironment(environment)) {
    throw new ValidationError(`Invalid environment: ${environment}`);
  }
  
  const sourceUsername = await environmentService.getSourceUsername(environment);
  const targetUsername = await environmentService.getTargetUsername(environment);
  
  logger.logOperation('Environment usernames retrieved', {
    environment,
    hasSource: !!sourceUsername,
    hasTarget: !!targetUsername
  });
  
  res.json({
    success: true,
    environment,
    sourceUsername,
    targetUsername,
    timestamp: new Date().toISOString()
  });
}));

module.exports = router;

