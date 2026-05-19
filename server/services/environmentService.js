const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');
const propertiesReader = require('../utils/propertiesReader');

/**
 * Service for managing environment-based configuration
 * **NEW FEATURE**: Support for dev/uat/prod environments with separate paths and configs
 */
class EnvironmentService {
  constructor() {
    this.environments = ['dev', 'uat', 'prod'];
    this.propertiesFiles = [
      'environments.properties',
      'placeholder.properties',
      'default.properties'
    ];
  }

  /**
   * Get environment configuration with adjusted paths
   * @param {string} environment - Environment name (dev/uat/prod/empty)
   * @returns {Object} Environment-specific configuration
   */
  getEnvironmentConfig(environment = '') {
    const envSuffix = environment ? `.${environment}` : '';
    const envPath = environment ? `/${environment}` : '';

    const config = {
      environment: environment || 'default',
      envSuffix,
      envPath,
      
      // Export paths
      exportPath: `./export${envPath}`,
      projectPath: `./export${envPath}`,
      
      // Deploy paths
      deployPath: `./deploy${envPath}`,
      
      // Job file names
      exportJobFile: `EPC-export${envSuffix}.yaml`,
      deployJobFile: `EPC-deploy${envSuffix}.yaml`,
      recoveryJobFile: `EPC-export-recovery${envSuffix}.yaml`,
      mergeJobFile: `EPC-export-merge${envSuffix}.yaml`,
      
      // Temp directories
      tempPath: `./temp${envPath}`,
      
      // Logs
      logsPath: `./logs${envPath}`,
      
      // Vlocity temp
      vlocityTempPath: `./vlocity-temp/logs${envPath}`
    };

    logger.debug('Environment config generated', config);
    return config;
  }

  /**
   * Load properties for a specific environment
   * Checks environment-specific keys first (e.g., SOURCE_SFDX_USERNAME.dev)
   * Falls back to default keys (e.g., SOURCE_SFDX_USERNAME)
   * @param {string} environment - Environment name (dev/uat/prod)
   * @returns {Object} Environment properties
   */
  async loadEnvironmentProperties(environment = '') {
    try {
      const properties = {};
      
      // Try loading from multiple properties files (fallback mechanism)
      for (const propertiesFile of this.propertiesFiles) {
        const filePath = path.join(process.cwd(), propertiesFile);
        
        if (await fs.pathExists(filePath)) {
          logger.info(`Loading properties from ${propertiesFile}`);
          const fileProperties = await this.parsePropertiesFile(filePath, environment);
          
          // Merge properties (first file wins for conflicts)
          Object.keys(fileProperties).forEach(key => {
            if (!properties[key]) {
              properties[key] = fileProperties[key];
            }
          });
        }
      }

      logger.info('Environment properties loaded', {
        environment,
        propertiesCount: Object.keys(properties).length
      });

      return properties;
    } catch (error) {
      logger.logError(error, { operation: 'loadEnvironmentProperties', environment });
      return {};
    }
  }

  /**
   * Parse properties file with environment-specific key resolution
   * @param {string} filePath - Path to properties file
   * @param {string} environment - Environment name
   * @returns {Object} Parsed properties
   */
  async parsePropertiesFile(filePath, environment = '') {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n');
      const properties = {};

      for (const line of lines) {
        const trimmed = line.trim();
        
        // Skip comments and empty lines
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
          continue;
        }

        // Parse key=value
        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) continue;

        const key = trimmed.substring(0, separatorIndex).trim();
        const value = trimmed.substring(separatorIndex + 1).trim();

        properties[key] = value;
      }

      // If environment is specified, resolve environment-specific keys
      if (environment) {
        const resolved = this.resolveEnvironmentKeys(properties, environment);
        return resolved;
      }

      return properties;
    } catch (error) {
      logger.logError(error, { operation: 'parsePropertiesFile', filePath, environment });
      return {};
    }
  }

  /**
   * Resolve environment-specific keys
   * Example: SOURCE_SFDX_USERNAME.dev takes precedence over SOURCE_SFDX_USERNAME
   * @param {Object} properties - All properties
   * @param {string} environment - Environment name
   * @returns {Object} Resolved properties
   */
  resolveEnvironmentKeys(properties, environment) {
    const resolved = {};

    // First pass: Add all non-environment-specific keys
    Object.keys(properties).forEach(key => {
      if (!key.includes('.')) {
        resolved[key] = properties[key];
      }
    });

    // Second pass: Override with environment-specific keys
    Object.keys(properties).forEach(key => {
      if (key.endsWith(`.${environment}`)) {
        // Extract base key (remove .env suffix)
        const baseKey = key.substring(0, key.length - environment.length - 1);
        resolved[baseKey] = properties[key];
      }
    });

    logger.debug('Environment keys resolved', {
      environment,
      totalKeys: Object.keys(resolved).length
    });

    return resolved;
  }

  /**
   * Get property value with environment fallback
   * @param {string} key - Property key
   * @param {string} environment - Environment name
   * @param {string} defaultValue - Default value if not found
   * @returns {string} Property value
   */
  async getProperty(key, environment = '', defaultValue = '') {
    const properties = await this.loadEnvironmentProperties(environment);
    return properties[key] || defaultValue;
  }

  /**
   * Get source username for environment
   * @param {string} environment - Environment name
   * @returns {string} Source username
   */
  async getSourceUsername(environment = '') {
    return await this.getProperty('SOURCE_SFDX_USERNAME', environment, process.env.SOURCE_SFDX_USERNAME);
  }

  /**
   * Get target username for environment
   * @param {string} environment - Environment name
   * @returns {string} Target username
   */
  async getTargetUsername(environment = '') {
    return await this.getProperty('TARGET_SFDX_USERNAME', environment, process.env.TARGET_SFDX_USERNAME);
  }

  /**
   * Get all configured environments
   * @returns {Array<Object>} List of environments with their configurations
   */
  async getAllEnvironments() {
    const environments = [];

    for (const env of ['', 'dev', 'uat', 'prod']) {
      const config = this.getEnvironmentConfig(env);
      const properties = await this.loadEnvironmentProperties(env);
      
      const envInfo = {
        name: env || 'default',
        displayName: env ? env.toUpperCase() : 'Default',
        config,
        sourceUsername: properties.SOURCE_SFDX_USERNAME || properties.SOURCE_SFDX_USERNAME_LABEL || '',
        targetUsername: properties.TARGET_SFDX_USERNAME || properties.TARGET_SFDX_USERNAME_LABEL || '',
        sourceLabel: properties.SOURCE_SFDX_USERNAME_LABEL || '',
        targetLabel: properties.TARGET_SFDX_USERNAME_LABEL || '',
        paths: {
          export: config.exportPath,
          deploy: config.deployPath,
          temp: config.tempPath,
          logs: config.logsPath
        }
      };

      environments.push(envInfo);
    }

    return environments;
  }

  /**
   * Ensure environment directories exist
   * @param {string} environment - Environment name
   * @returns {Object} Created directories
   */
  async ensureEnvironmentDirectories(environment = '') {
    const config = this.getEnvironmentConfig(environment);
    const directories = [];

    const dirsToCreate = [
      config.exportPath,
      config.deployPath,
      config.tempPath,
      config.logsPath,
      config.vlocityTempPath
    ];

    for (const dir of dirsToCreate) {
      const fullPath = path.join(process.cwd(), dir);
      await fs.ensureDir(fullPath);
      directories.push(fullPath);
    }

    logger.info('Environment directories ensured', {
      environment,
      directoriesCreated: directories.length
    });

    return {
      success: true,
      environment,
      directories
    };
  }

  /**
   * Validate environment name
   * @param {string} environment - Environment name
   * @returns {boolean} True if valid
   */
  isValidEnvironment(environment) {
    return !environment || this.environments.includes(environment);
  }

  /**
   * Get environment from job configuration
   * @param {Object} jobConfig - Job configuration
   * @returns {string} Environment name
   */
  getEnvironmentFromJobConfig(jobConfig) {
    if (jobConfig.environment) {
      return jobConfig.environment;
    }

    // Try to infer from project path
    if (jobConfig.projectPath) {
      for (const env of this.environments) {
        if (jobConfig.projectPath.includes(`/${env}`) || jobConfig.projectPath.includes(`\\${env}`)) {
          return env;
        }
      }
    }

    return '';
  }

  /**
   * Update job configuration with environment-specific paths
   * @param {Object} jobConfig - Original job configuration
   * @param {string} environment - Environment name
   * @returns {Object} Updated job configuration
   */
  applyEnvironmentToJobConfig(jobConfig, environment = '') {
    const envConfig = this.getEnvironmentConfig(environment);
    
    const updatedConfig = {
      ...jobConfig,
      environment,
      projectPath: jobConfig.projectPath || envConfig.projectPath,
      // Add environment metadata
      environmentConfig: {
        environment,
        exportPath: envConfig.exportPath,
        deployPath: envConfig.deployPath,
        appliedAt: new Date().toISOString()
      }
    };

    return updatedConfig;
  }
}

module.exports = new EnvironmentService();

