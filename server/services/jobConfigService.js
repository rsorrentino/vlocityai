const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');
const logger = require('../utils/logger');

/**
 * Job Config Service
 * Manages default job settings and query definitions
 * Based on patterns from official Vlocity Build Tool
 */
class JobConfigService {
  constructor() {
    this.defaultSettingsPath = path.join(__dirname, '../config/default-job-settings.yaml');
    this.queryDefinitionsPath = path.join(__dirname, '../config/query-definitions.yaml');
    this.defaultSettings = {};
    this.queryDefinitions = {};
    this.loadDefaults();
  }

  /**
   * Load default settings and query definitions
   */
  loadDefaults() {
    try {
      // Load default job settings
      if (fs.existsSync(this.defaultSettingsPath)) {
        this.defaultSettings = yaml.load(
          fs.readFileSync(this.defaultSettingsPath, 'utf8')
        ) || {};
        logger.info('Default job settings loaded', { 
          settingCount: Object.keys(this.defaultSettings).length 
        });
      } else {
        logger.warn('Default job settings file not found', { 
          path: this.defaultSettingsPath 
        });
      }

      // Load query definitions
      if (fs.existsSync(this.queryDefinitionsPath)) {
        this.queryDefinitions = yaml.load(
          fs.readFileSync(this.queryDefinitionsPath, 'utf8')
        ) || {};
        logger.info('Query definitions loaded', { 
          definitionCount: Object.keys(this.queryDefinitions).length 
        });
      } else {
        logger.warn('Query definitions file not found', { 
          path: this.queryDefinitionsPath 
        });
      }
    } catch (error) {
      logger.error('Failed to load job configuration', { error: error.message });
    }
  }

  /**
   * Merge user job config with defaults
   * @param {Object} userConfig - User-provided job configuration
   * @returns {Object} Merged configuration
   */
  mergeWithDefaults(userConfig) {
    return {
      ...this.defaultSettings,
      ...userConfig
    };
  }

  /**
   * Resolve query definitions (convert shorthand to full query objects)
   * @param {Array} queries - Queries array (may contain strings or objects)
   * @returns {Array} Resolved query objects
   */
  resolveQueries(queries) {
    if (!queries || !Array.isArray(queries)) {
      return [];
    }

    return queries.map(query => {
      // If it's a string, try to resolve from query definitions
      if (typeof query === 'string') {
        const definition = this.queryDefinitions[query];
        
        if (definition) {
          return {
            VlocityDataPackType: definition.VlocityDataPackType,
            query: definition.query,
            description: definition.description,
            name: query // Store original name
          };
        } else {
          logger.warn('Query definition not found', { query });
          // Return as-is, let Vlocity handle it
          return query;
        }
      }

      // Already an object, return as-is
      return query;
    });
  }

  /**
   * Get default settings
   * @returns {Object} Default settings
   */
  getDefaultSettings() {
    return { ...this.defaultSettings };
  }

  /**
   * Get query definitions
   * @returns {Object} Query definitions
   */
  getQueryDefinitions() {
    return { ...this.queryDefinitions };
  }

  /**
   * Get available query types
   * @returns {Array<string>} Array of query type names
   */
  getAvailableQueryTypes() {
    return Object.keys(this.queryDefinitions);
  }

  /**
   * Validate job configuration
   * @param {Object} config - Job configuration
   * @returns {Object} Validation result
   */
  validateConfig(config) {
    const errors = [];
    const warnings = [];

    // Required fields
    if (!config.projectPath) {
      warnings.push('projectPath not specified, using current directory');
    }

    // Validate queries
    if (config.queries) {
      config.queries.forEach((query, index) => {
        if (typeof query === 'string') {
          if (!this.queryDefinitions[query]) {
            warnings.push(`Query ${index + 1} "${query}" not found in definitions, using as-is`);
          }
        } else if (typeof query === 'object') {
          // Support both formats: VlocityDataPackType with query, or name with soql_query
          if (!query.VlocityDataPackType && !query.name) {
            errors.push(`Query ${index + 1}: must have either VlocityDataPackType or name`);
          }
          // Additional validation is done by configValidator which is called later
        }
      });
    }

    // Validate settings
    if (config.defaultMaxParallel && (config.defaultMaxParallel < 1 || config.defaultMaxParallel > 50)) {
      warnings.push('defaultMaxParallel should be between 1 and 50');
    }

    if (config.exportPacksMaxSize && (config.exportPacksMaxSize < 100 || config.exportPacksMaxSize > 10000)) {
      warnings.push('exportPacksMaxSize should be between 100 and 10000');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
}

module.exports = new JobConfigService();

