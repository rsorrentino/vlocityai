const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const PropertiesReader = require('../utils/propertiesReader');
const fs = require('fs-extra');
const path = require('path');

// Countries configuration removed - not used

// Load properties from environments.properties file
const propertiesPath = path.join(__dirname, '../../environments.properties');
let properties = new PropertiesReader(propertiesPath);

// Get configuration settings
router.get('/settings', asyncHandler(async (req, res) => {
  const settings = {
    // Vlocity settings
    vlocityVersion: process.env.VLOCITY_VERSION || '1.17.12',
    vlocityTimeout: parseInt(process.env.VLOCITY_TIMEOUT) || 300000,
    
    // Default usernames from properties
    defaultSfdxUsername: properties.get('SFDX_USERNAME'),
    defaultSourceSfdxUsername: properties.get('SOURCE_SFDX_USERNAME'),
    defaultTargetSfdxUsername: properties.get('TARGET_SFDX_USERNAME'),
    
    // Default labels from properties
    defaultSourceSfdxUsernameLabel: properties.get('SOURCE_SFDX_USERNAME_LABEL'),
    defaultTargetSfdxUsernameLabel: properties.get('TARGET_SFDX_USERNAME_LABEL'),
    
    // Export settings
    defaultMaxParallel: parseInt(process.env.DEFAULT_MAX_PARALLEL) || 10,
    defaultExportPacksMaxSize: parseInt(process.env.DEFAULT_EXPORT_PACKS_MAX_SIZE) || 5000,
    defaultMaxDepth: parseInt(process.env.DEFAULT_MAX_DEPTH) || 10,
    defaultMaxIterations: parseInt(process.env.DEFAULT_MAX_ITERATIONS) || 10,
    defaultAttempts: parseInt(process.env.DEFAULT_ATTEMPTS) || 3,
    prealignSettings: process.env.PREALIGN_SETTINGS === 'true',
    
    // Logging settings
    logLevel: process.env.LOG_LEVEL || 'info',
    logFilePath: process.env.LOG_FILE_PATH || './logs/vlocity-manager.log',
    
    // Security settings
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
    rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    
    // File settings
    maxFileSize: process.env.MAX_FILE_SIZE || '50MB',
    uploadPath: process.env.UPLOAD_PATH || './uploads',
  };

  res.json({
    settings,
    timestamp: new Date().toISOString(),
  });
}));

// Update configuration settings
router.post('/settings', asyncHandler(async (req, res) => {
  const { settings } = req.body;
  
  // Update environment variables (in memory only)
  Object.entries(settings).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      process.env[key.toUpperCase()] = value.toString();
    }
  });
  
  logger.logOperation('Configuration updated', { settings });
  
  res.json({
    message: 'Configuration updated successfully',
    timestamp: new Date().toISOString(),
  });
}));

// Get environment information
router.get('/environment', asyncHandler(async (req, res) => {
  res.json({
    environment: {
      nodeEnv: process.env.NODE_ENV || 'development',
      port: process.env.PORT || 3001,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    },
    timestamp: new Date().toISOString(),
  });
}));

// Get properties from environments.properties file
router.get('/properties', asyncHandler(async (req, res) => {
  try {
    // Reload properties to get latest values
    properties = new PropertiesReader(propertiesPath);
    
    // Get all properties as an object
    const allProperties = {};
    
    // Read the file content to get all properties
    if (await fs.pathExists(propertiesPath)) {
      const content = await fs.readFile(propertiesPath, 'utf8');
      const lines = content.split('\n');
      
      lines.forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
          const [key, ...valueParts] = trimmedLine.split('=');
          if (key && valueParts.length > 0) {
            allProperties[key.trim()] = valueParts.join('=').trim();
          }
        }
      });
    }
    
    res.json({
      properties: allProperties,
      count: Object.keys(allProperties).length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.logError(error, { operation: 'getProperties' });
    throw error;
  }
}));

// Update properties in environments.properties file
router.post('/properties', asyncHandler(async (req, res) => {
  try {
    const { properties: newProperties } = req.body;
    
    if (!newProperties || typeof newProperties !== 'object') {
      return res.status(400).json({
        error: 'Properties object is required',
      });
    }
    
    // Convert properties object to file content
    let content = '# Environment Configuration\n';
    content += '# Updated via Settings UI\n\n';
    
    // Add properties
    Object.entries(newProperties).forEach(([key, value]) => {
      content += `${key}=${value}\n`;
    });
    
    // Write to file
    await fs.writeFile(propertiesPath, content, 'utf8');
    
    // Reload properties
    properties = new PropertiesReader(propertiesPath);
    
    logger.logOperation('Properties updated', { 
      count: Object.keys(newProperties).length,
      keys: Object.keys(newProperties).slice(0, 5) // Log first 5 keys
    });
    
    res.json({
      message: 'Properties updated successfully',
      count: Object.keys(newProperties).length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.logError(error, { operation: 'updateProperties' });
    throw error;
  }
}));

// Refresh application (reload properties and settings)
router.post('/refresh', asyncHandler(async (req, res) => {
  try {
    // Reload properties
    properties = new PropertiesReader(propertiesPath);
    
    // Update environment variables from properties
    const allProperties = {};
    
    if (await fs.pathExists(propertiesPath)) {
      const content = await fs.readFile(propertiesPath, 'utf8');
      const lines = content.split('\n');
      
      lines.forEach(line => {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
          const [key, ...valueParts] = trimmedLine.split('=');
          if (key && valueParts.length > 0) {
            allProperties[key.trim()] = valueParts.join('=').trim();
          }
        }
      });
    }
    
    // Update relevant environment variables
    Object.entries(allProperties).forEach(([key, value]) => {
      if (key.includes('SFDX_USERNAME') || key.includes('LABEL')) {
        process.env[key] = value;
      }
    });
    
    logger.logOperation('Application refreshed', { 
      propertiesReloaded: true,
      environmentVariablesUpdated: Object.keys(allProperties).length
    });
    
    res.json({
      message: 'Application refreshed successfully',
      propertiesReloaded: true,
      environmentVariablesUpdated: Object.keys(allProperties).length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.logError(error, { operation: 'refreshApplication' });
    throw error;
  }
}));

// Get countries configuration from countries.json
router.get('/countries', asyncHandler(async (req, res) => {
  try {
    const countriesFilePath = path.join(__dirname, '../config/countries.json');
    const includeAll = req.query.includeAll === 'true';
    
    // Check if file exists
    if (!await fs.pathExists(countriesFilePath)) {
      logger.log('warn', 'Countries configuration file not found', {
        filePath: countriesFilePath,
        operation: 'getCountries'
      });
      return res.json({
        success: true,
        countries: [],
        count: 0,
        timestamp: new Date().toISOString(),
      });
    }
    
    // Read and parse countries.json
    const countriesData = await fs.readJson(countriesFilePath);
    let countries = countriesData.countries || [];
    
    // Filter by active status if includeAll is false
    if (!includeAll) {
      countries = countries.filter(country => country.active === true);
    }
    
    logger.log('info', 'Countries configuration loaded', {
      totalCountries: countries.length,
      includeAll,
      operation: 'getCountries'
    });
    
    res.json({
      success: true,
      countries,
      count: countries.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.logError(error, {
      operation: 'getCountries',
      filePath: path.join(__dirname, '../config/countries.json')
    });
    throw error;
  }
}));

// Get all configuration
router.get('/', asyncHandler(async (req, res) => {
  res.json({
    config: {
      environment: process.env.NODE_ENV || 'development',
      port: process.env.PORT || 3001,
      vlocityVersion: process.env.VLOCITY_VERSION || '1.17.12',
    },
    timestamp: new Date().toISOString(),
  });
}));

module.exports = router;
