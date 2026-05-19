const Joi = require('joi');
const PropertiesReader = require('./propertiesReader');
const path = require('path');

// Load properties from environments.properties file
const propertiesPath = path.join(__dirname, '../../environments.properties');
const properties = new PropertiesReader(propertiesPath);

// Environment validation schema
const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3001),
  VLOCITY_VERSION: Joi.string().default('1.17.12'),
  VLOCITY_TIMEOUT: Joi.number().positive().default(300000),
  DEFAULT_SFDX_USERNAME: Joi.string().email().default(properties.get('SFDX_USERNAME', 'rocco.sorrentino@amplifonapac.com.mastcatdev')),
  DEFAULT_SOURCE_SFDX_USERNAME: Joi.string().email().default(properties.get('SOURCE_SFDX_USERNAME', 'rocco.sorrentino@amplifonapac.com.mastcatdev')),
  DEFAULT_TARGET_SFDX_USERNAME: Joi.string().email().default(properties.get('TARGET_SFDX_USERNAME', 'rocco.sorrentino@amplifonapac.com.symporting')),
  DEFAULT_MAX_PARALLEL: Joi.number().positive().default(10),
  DEFAULT_EXPORT_PACKS_MAX_SIZE: Joi.number().positive().default(5000),
  DEFAULT_MAX_DEPTH: Joi.number().min(0).default(0),
  DEFAULT_MAX_ITERATIONS: Joi.number().positive().default(10),
  DEFAULT_ATTEMPTS: Joi.number().positive().default(3),
  PREALIGN_SETTINGS: Joi.boolean().default(false),
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  LOG_FILE_PATH: Joi.string().default('./logs/vlocity-manager.log'),
  JWT_SECRET: Joi.string().min(32).default('vlocity-datapack-manager-default-secret-change-in-production'),
  SESSION_SECRET: Joi.string().min(32).default('vlocity-datapack-manager-session-secret-change-in-production'),
  MAX_FILE_SIZE: Joi.string().default('50MB'),
  UPLOAD_PATH: Joi.string().default('./uploads'),
  RATE_LIMIT_WINDOW_MS: Joi.number().positive().default(900000),
  RATE_LIMIT_MAX_REQUESTS: Joi.number().positive().default(100),
}).unknown();

// Validate environment configuration
const validateEnvironment = () => {
  const { error, value } = envSchema.validate(process.env);
  
  if (error) {
    console.error('❌ Environment validation failed:');
    console.error(error.details.map(detail => `  - ${detail.message}`).join('\n'));
    process.exit(1);
  }
  
  // Update process.env with validated values
  Object.assign(process.env, value);
  
  console.log('✅ Environment configuration validated successfully');
};

// Validation schemas for API requests
const schemas = {
  // Salesforce org validation
  org: Joi.object({
    username: Joi.string().email().required(),
    alias: Joi.string().optional(),
    environment: Joi.string().valid('dev', 'uat', 'prod').optional(),
  }),

  // Export job validation
  exportJob: Joi.object({
    name: Joi.string().required(),
    projectPath: Joi.string().required(),
    queries: Joi.array().items(
      Joi.alternatives().try(
        // Standard format: VlocityDataPackType with optional query (query validation happens elsewhere)
        Joi.object({
          VlocityDataPackType: Joi.string().required(),
          query: Joi.string().optional(),
          description: Joi.string().optional(),
        }).unknown(true), // Allow other fields
        // Named query format: name with soql_query, external_key, and target_object (for data tree export)
        Joi.object({
          name: Joi.string().required(),
          object: Joi.string().optional(),
          soql_query: Joi.string().required(),
          external_key: Joi.string().required(),
          target_object: Joi.string().required(),
        }).unknown(true), // Allow other fields
        // SF CLI query format: name with object and soql_query (for data query - relationship queries)
        Joi.object({
          name: Joi.string().required(),
          object: Joi.string().required(),
          soql_query: Joi.string().required(),
          // external_key and target_object are optional for relationship queries that use data query
        }).unknown(true) // Allow other fields
      )
    ).min(1).required(),
    defaultMaxParallel: Joi.number().positive().default(10),
    exportPacksMaxSize: Joi.number().positive().default(5000),
    removeInvalidMatchingKeyFields: Joi.boolean().default(true),
    maxDepth: Joi.number().min(0).default(10),
    cliType: Joi.string().valid('vlocity', 'sf').default('vlocity'),
    enableRecovery: Joi.boolean().optional(),
    maxRecoveryIterations: Joi.number().positive().optional(),
    useDependencyOrder: Joi.boolean().optional(),
  }),

  // Deploy job validation
  deployJob: Joi.object({
    name: Joi.string().required(),
    projectPath: Joi.string().required(),
    // Queries can be:
    // 1. Array of strings (folder names) - for deploying from export folders
    // 2. Array of objects (VlocityDataPackType with query) - for defining new queries
    // 3. Optional/empty if deploying from existing export folder (will be auto-discovered)
    queries: Joi.alternatives().try(
      Joi.array().items(Joi.string()).min(1),
      Joi.array().items(
        Joi.object({
          VlocityDataPackType: Joi.string().required(),
          query: Joi.string().optional(),
          description: Joi.string().optional(),
        }).unknown(true)
      ).min(1),
      Joi.array().items(Joi.string()).min(0), // Allow empty array
      Joi.array().allow(null) // Allow null/undefined
    ).optional().default([]), // Default to empty array if not provided
    // Salesforce usernames can have additional segments (e.g., .mastcatdev, .symporting)
    // Use pattern instead of strict email validation
    sourceUsername: Joi.string().pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+(\.[^\s@]+)*$/).required(),
    targetUsername: Joi.string().pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+(\.[^\s@]+)*$/).required(),
    attempts: Joi.number().positive().default(3),
    maxRetries: Joi.number().positive().optional(),
    prealignSettings: Joi.boolean().default(false),
    deployCommand: Joi.string().valid('packDeploy', 'packContinue', 'packRetry').optional(),
    useDependencyOrder: Joi.boolean().optional(),
    stopOnNoProgress: Joi.boolean().optional(),
    // Flag to indicate deploying from export folder (auto-discover queries)
    deployFromExportFolder: Joi.boolean().default(false),
  }),

  // Environment configuration validation
  environmentConfig: Joi.object({
    name: Joi.string().required(),
    sfdxUsername: Joi.string().email().required(),
    sourceSfdxUsername: Joi.string().email().required(),
    targetSfdxUsername: Joi.string().email().required(),
    description: Joi.string().optional(),
  }),

  // Query validation - supports both formats
  query: Joi.alternatives().try(
    // Standard format: VlocityDataPackType with optional query
    Joi.object({
      VlocityDataPackType: Joi.string().required(),
      query: Joi.string().optional(),
      description: Joi.string().optional(),
    }).unknown(true),
    // Named query format: name with soql_query, external_key, and target_object
    Joi.object({
      name: Joi.string().required(),
      object: Joi.string().optional(),
      soql_query: Joi.string().required(),
      external_key: Joi.string().required(),
      target_object: Joi.string().required(),
    }).unknown(true)
  ),

  // Vlocity metadata deployment validation
  deployMetadataSchema: Joi.object({
    sourceUsername: Joi.string().email().required(),
    targetUsername: Joi.string().email().required(),
    metadataType: Joi.string().required(),
    metadataName: Joi.string().required(),
  }),

  // Vlocity components export validation
  exportComponentsSchema: Joi.object({
    username: Joi.string().email().required(),
    metadataType: Joi.string().required(),
    metadataNames: Joi.array().items(Joi.string()).min(1).required(),
  }),
};

// Validation middleware factory
const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errorDetails = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value,
      }));

      return res.status(400).json({
        error: 'Validation Error',
        details: errorDetails,
      });
    }

    req[property] = value;
    next();
  };
};

module.exports = {
  validateEnvironment,
  schemas,
  validate,
};
