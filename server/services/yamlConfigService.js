const fs = require('fs-extra');
const path = require('path');
const yaml = require('yaml');
const logger = require('../utils/logger');

class YamlConfigService {
  constructor() {
    this.configDir = path.join(__dirname, '../../');
    this.jobsDir = path.join(this.configDir, 'jobs');
    
    // Ensure directories exist
    this.ensureDirectories();
  }

  ensureDirectories() {
    // Only ensure jobs directory - templates directory removed
    fs.ensureDirSync(this.jobsDir);
  }

  /**
   * Get all available YAML configuration files
   */
  async getConfigFiles() {
    try {
      const files = await fs.readdir(this.configDir);
      const yamlFiles = files.filter(file => 
        file.endsWith('.yaml') && 
        (file.includes('export') || file.includes('deploy'))
      );

      const configs = [];
      for (const file of yamlFiles) {
        const filePath = path.join(this.configDir, file);
        const stats = await fs.stat(filePath);
        const content = await fs.readFile(filePath, 'utf8');
        
        try {
          const parsed = yaml.parse(content);
          configs.push({
            name: file,
            path: filePath,
            type: file.includes('export') ? 'export' : 'deploy',
            environment: this.extractEnvironment(file),
            size: stats.size,
            modified: stats.mtime,
            config: parsed,
            queries: parsed.queries || [],
            projectPath: parsed.projectPath || './export',
            settings: {
              defaultMaxParallel: parsed.defaultMaxParallel || 10,
              exportPacksMaxSize: parsed.exportPacksMaxSize || 5000,
              removeInvalidMatchingKeyFields: parsed.removeInvalidMatchingKeyFields || true,
              maxDepth: parsed.maxDepth || 0,
            }
          });
        } catch (error) {
          logger.logError(error, { operation: 'parseYamlConfig', file });
        }
      }

      return configs.sort((a, b) => b.modified - a.modified);
    } catch (error) {
      logger.logError(error, { operation: 'getConfigFiles' });
      throw error;
    }
  }

  /**
   * Extract environment from filename
   */
  extractEnvironment(filename) {
    const match = filename.match(/-([a-z]+)\.yaml$/);
    return match ? match[1] : 'default';
  }

  /**
   * Get a specific configuration file
   */
  async getConfig(filename) {
    try {
      const filePath = path.join(this.configDir, filename);
      
      if (!await fs.pathExists(filePath)) {
        throw new Error(`Configuration file ${filename} not found`);
      }

      const content = await fs.readFile(filePath, 'utf8');
      const config = yaml.parse(content);
      
      return {
        name: filename,
        path: filePath,
        content,
        config,
        queries: config.queries || [],
        projectPath: config.projectPath || './export',
        settings: {
          defaultMaxParallel: config.defaultMaxParallel || 10,
          exportPacksMaxSize: config.exportPacksMaxSize || 5000,
          removeInvalidMatchingKeyFields: config.removeInvalidMatchingKeyFields || true,
          maxDepth: config.maxDepth || 0,
        }
      };
    } catch (error) {
      logger.logError(error, { operation: 'getConfig', filename });
      throw error;
    }
  }

  /**
   * Create a new configuration file
   */
  async createConfig(configData) {
    try {
      const { name, type, environment, queries, settings, projectPath } = configData;
      
      // Generate filename
      const envSuffix = environment && environment !== 'default' ? `-${environment}` : '';
      const filename = `EPC-${type}${envSuffix}.yaml`;
      const filePath = path.join(this.configDir, filename);

      // Check if file already exists
      if (await fs.pathExists(filePath)) {
        throw new Error(`Configuration file ${filename} already exists`);
      }

      // Build configuration object
      const config = {
        projectPath: projectPath || `./${type}${envSuffix ? `/${environment}` : ''}`,
        ...settings,
        queries: queries || []
      };

      // Convert to YAML
      const yamlContent = yaml.stringify(config, {
        indent: 2,
        lineWidth: 120,
        minContentWidth: 0
      });

      // Write file
      await fs.writeFile(filePath, yamlContent, 'utf8');

      logger.logOperation('YAML configuration created', { 
        filename, 
        type, 
        environment, 
        queriesCount: queries.length 
      });

      return {
        name: filename,
        path: filePath,
        config,
        content: yamlContent
      };
    } catch (error) {
      logger.logError(error, { operation: 'createConfig', configData });
      throw error;
    }
  }

  /**
   * Update an existing configuration file
   */
  async updateConfig(filename, configData) {
    try {
      const filePath = path.join(this.configDir, filename);
      
      if (!await fs.pathExists(filePath)) {
        throw new Error(`Configuration file ${filename} not found`);
      }

      const { queries, settings, projectPath } = configData;

      // Build configuration object
      const config = {
        projectPath: projectPath || './export',
        ...settings,
        queries: queries || []
      };

      // Convert to YAML
      const yamlContent = yaml.stringify(config, {
        indent: 2,
        lineWidth: 120,
        minContentWidth: 0
      });

      // Write file
      await fs.writeFile(filePath, yamlContent, 'utf8');

      logger.logOperation('YAML configuration updated', { 
        filename, 
        queriesCount: queries.length 
      });

      return {
        name: filename,
        path: filePath,
        config,
        content: yamlContent
      };
    } catch (error) {
      logger.logError(error, { operation: 'updateConfig', filename, configData });
      throw error;
    }
  }

  /**
   * Delete a configuration file
   */
  async deleteConfig(filename) {
    try {
      const filePath = path.join(this.configDir, filename);
      
      if (!await fs.pathExists(filePath)) {
        throw new Error(`Configuration file ${filename} not found`);
      }

      await fs.remove(filePath);

      logger.logOperation('YAML configuration deleted', { filename });

      return { success: true, filename };
    } catch (error) {
      logger.logError(error, { operation: 'deleteConfig', filename });
      throw error;
    }
  }

  /**
   * Clone a configuration for a different environment
   */
  async cloneConfig(sourceFilename, targetEnvironment) {
    try {
      const sourceConfig = await this.getConfig(sourceFilename);
      const sourceEnv = this.extractEnvironment(sourceFilename);
      
      if (sourceEnv === targetEnvironment) {
        throw new Error('Source and target environments cannot be the same');
      }

      // Generate target filename
      const targetFilename = sourceFilename.replace(`-${sourceEnv}`, `-${targetEnvironment}`);
      
      // Update project path for new environment
      const updatedConfig = {
        ...sourceConfig.config,
        projectPath: sourceConfig.config.projectPath.replace(`/${sourceEnv}`, `/${targetEnvironment}`)
      };

      // Convert to YAML
      const yamlContent = yaml.stringify(updatedConfig, {
        indent: 2,
        lineWidth: 120,
        minContentWidth: 0
      });

      const targetPath = path.join(this.configDir, targetFilename);
      await fs.writeFile(targetPath, yamlContent, 'utf8');

      logger.logOperation('YAML configuration cloned', { 
        sourceFilename, 
        targetFilename, 
        sourceEnv, 
        targetEnvironment 
      });

      return {
        name: targetFilename,
        path: targetPath,
        config: updatedConfig,
        content: yamlContent
      };
    } catch (error) {
      logger.logError(error, { operation: 'cloneConfig', sourceFilename, targetEnvironment });
      throw error;
    }
  }

  /**
   * Get configuration templates
   */
  async getTemplates() {
    try {
      const templates = [
        {
          name: 'Basic Export',
          type: 'export',
          description: 'Basic export configuration with common Vlocity objects',
          config: {
            projectPath: './export',
            defaultMaxParallel: 10,
            exportPacksMaxSize: 5000,
            removeInvalidMatchingKeyFields: true,
            maxDepth: 10,
            queries: [
              {
                VlocityDataPackType: 'SObject',
                query: 'SELECT Id FROM Product2 WHERE LastModifiedDate >= 2025-01-01T00:00:00.000+0000 AND GT_IsTechnicalProduct__c = false'
              },
              {
                VlocityDataPackType: 'SObject',
                query: 'SELECT Id FROM vlocity_cmt__PricingElement__c WHERE LastModifiedDate >= 2025-01-01T00:00:00.000+0000'
              }
            ]
          }
        },
        {
          name: 'Basic Deploy',
          type: 'deploy',
          description: 'Basic deploy configuration',
          config: {
            projectPath: './export',
            queries: [
              'Product2',
              'VlocityPicklist',
              'SObject_PricebookEntry'
            ]
          }
        },
        {
          name: 'Full Export',
          type: 'export',
          description: 'Comprehensive export with all Vlocity objects',
          config: {
            projectPath: './export',
            defaultMaxParallel: 10,
            exportPacksMaxSize: 5000,
            removeInvalidMatchingKeyFields: true,
            maxDepth: 10,
            queries: [
              { VlocityDataPackType: 'SObject', query: 'SELECT Id FROM Product2 WHERE GT_IsTechnicalProduct__c = false' },
              { VlocityDataPackType: 'SObject', query: 'SELECT Id FROM vlocity_cmt__PricingElement__c' },
              { VlocityDataPackType: 'SObject', query: 'SELECT Id FROM vlocity_cmt__AttributeCategory__c' },
              { VlocityDataPackType: 'SObject', query: 'SELECT Id FROM vlocity_cmt__ObjectClass__c' },
              { VlocityDataPackType: 'SObject', query: 'SELECT Id FROM vlocity_cmt__Attribute__c' },
              { VlocityDataPackType: 'SObject', query: 'SELECT Id FROM vlocity_cmt__Picklist__c' },
              { VlocityDataPackType: 'SObject', query: 'SELECT Id FROM vlocity_cmt__PriceListEntry__c' },
              { VlocityDataPackType: 'SObject', query: 'SELECT Id FROM vlocity_cmt__CatalogProductRelationship__c' },
              { VlocityDataPackType: 'SObject', query: 'SELECT Id FROM vlocity_cmt__AttributeAssignment__c' },
              { VlocityDataPackType: 'SObject', query: 'SELECT Id FROM PricebookEntry' }
            ]
          }
        }
      ];

      return templates;
    } catch (error) {
      logger.logError(error, { operation: 'getTemplates' });
      throw error;
    }
  }

  /**
   * Bulk operations for configurations
   */
  async bulkDelete(filenames) {
    const results = {
      success: [],
      failed: [],
      total: filenames.length
    };

    for (const filename of filenames) {
      try {
        await this.deleteConfig(filename);
        results.success.push(filename);
      } catch (error) {
        results.failed.push({
          filename,
          error: error.message
        });
      }
    }

    logger.logOperation('Bulk delete completed', {
      successCount: results.success.length,
      failedCount: results.failed.length
    });

    return results;
  }

  async bulkClone(sourceFilename, targetEnvironments) {
    const results = {
      success: [],
      failed: [],
      total: targetEnvironments.length
    };

    for (const environment of targetEnvironments) {
      try {
        const clonedConfig = await this.cloneConfig(sourceFilename, environment);
        results.success.push({
          environment,
          filename: clonedConfig.name
        });
      } catch (error) {
        results.failed.push({
          environment,
          error: error.message
        });
      }
    }

    logger.logOperation('Bulk clone completed', {
      sourceFilename,
      successCount: results.success.length,
      failedCount: results.failed.length
    });

    return results;
  }

  async bulkUpdate(filenames, updateData) {
    const results = {
      success: [],
      failed: [],
      total: filenames.length
    };

    for (const filename of filenames) {
      try {
        const config = await this.getConfig(filename);
        const updatedConfig = {
          ...config,
          ...updateData
        };
        
        await this.updateConfig(filename, updatedConfig);
        results.success.push(filename);
      } catch (error) {
        results.failed.push({
          filename,
          error: error.message
        });
      }
    }

    logger.logOperation('Bulk update completed', {
      successCount: results.success.length,
      failedCount: results.failed.length
    });

    return results;
  }

  async bulkValidate(filenames) {
    const results = {
      valid: [],
      invalid: [],
      total: filenames.length
    };

    for (const filename of filenames) {
      try {
        const config = await this.getConfig(filename);
        const validation = this.validateConfig(config.config);
        
        if (validation.valid) {
          results.valid.push({
            filename,
            warnings: validation.warnings
          });
        } else {
          results.invalid.push({
            filename,
            errors: validation.errors,
            warnings: validation.warnings
          });
        }
      } catch (error) {
        results.invalid.push({
          filename,
          errors: [error.message]
        });
      }
    }

    logger.logOperation('Bulk validation completed', {
      validCount: results.valid.length,
      invalidCount: results.invalid.length
    });

    return results;
  }

  async bulkExport(filenames, format = 'yaml') {
    const results = {
      success: [],
      failed: [],
      total: filenames.length
    };

    for (const filename of filenames) {
      try {
        const config = await this.getConfig(filename);
        
        if (format === 'json') {
          results.success.push({
            filename,
            content: JSON.stringify(config.config, null, 2),
            type: 'json'
          });
        } else {
          results.success.push({
            filename,
            content: config.content,
            type: 'yaml'
          });
        }
      } catch (error) {
        results.failed.push({
          filename,
          error: error.message
        });
      }
    }

    logger.logOperation('Bulk export completed', {
      format,
      successCount: results.success.length,
      failedCount: results.failed.length
    });

    return results;
  }

  async bulkImport(configs) {
    const results = {
      success: [],
      failed: [],
      total: configs.length
    };

    for (const configData of configs) {
      try {
        const config = await this.createConfig(configData);
        results.success.push({
          filename: config.name,
          config: config.config
        });
      } catch (error) {
        results.failed.push({
          configName: configData.name || 'Unknown',
          error: error.message
        });
      }
    }

    logger.logOperation('Bulk import completed', {
      successCount: results.success.length,
      failedCount: results.failed.length
    });

    return results;
  }

  /**
   * Validate configuration data
   */
  validateConfig(config) {
    const errors = [];
    const warnings = [];

    // Required fields
    if (!config.queries || !Array.isArray(config.queries)) {
      errors.push('Queries array is required');
    } else if (config.queries.length === 0) {
      warnings.push('No queries defined');
    }

    // Validate project path
    if (!config.projectPath) {
      warnings.push('Project path not specified, using default');
    }

    // Validate settings
    if (config.defaultMaxParallel && (config.defaultMaxParallel < 1 || config.defaultMaxParallel > 50)) {
      warnings.push('defaultMaxParallel should be between 1 and 50');
    }

    if (config.exportPacksMaxSize && (config.exportPacksMaxSize < 100 || config.exportPacksMaxSize > 10000)) {
      warnings.push('exportPacksMaxSize should be between 100 and 10000');
    }

    // Validate queries
    if (config.queries && Array.isArray(config.queries)) {
      config.queries.forEach((query, index) => {
        if (typeof query === 'string') {
          if (!query.trim()) {
            errors.push(`Query ${index + 1} is empty`);
          }
        } else if (typeof query === 'object') {
          // Support both formats: VlocityDataPackType with query, or name with soql_query
          if (query.VlocityDataPackType) {
            // Standard format: requires query field
            if (!query.query) {
              errors.push(`Query ${index + 1} missing query field for VlocityDataPackType`);
            }
          } else if (query.name) {
            // Named query format: requires soql_query, external_key, and target_object
            if (!query.soql_query) {
              errors.push(`Query ${index + 1} missing soql_query field for named query`);
            }
            if (!query.external_key) {
              errors.push(`Query ${index + 1} missing external_key field for named query`);
            }
            if (!query.target_object) {
              errors.push(`Query ${index + 1} missing target_object field for named query`);
            }
          } else {
            errors.push(`Query ${index + 1}: must have either VlocityDataPackType or name`);
          }
        } else {
          errors.push(`Query ${index + 1} has invalid format`);
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
  async generateReport() {
    const configs = await this.getConfigFiles();
    const report = {
      summary: {
        total: configs.length,
        byType: {},
        byEnvironment: {},
        totalQueries: 0,
        avgQueriesPerConfig: 0
      },
      configs: configs.map(config => ({
        name: config.name,
        type: config.type,
        environment: config.environment,
        queryCount: config.queries.length,
        size: config.size,
        modified: config.modified,
        settings: config.settings
      })),
      recommendations: []
    };

    // Calculate statistics
    configs.forEach(config => {
      // By type
      report.summary.byType[config.type] = (report.summary.byType[config.type] || 0) + 1;
      
      // By environment
      report.summary.byEnvironment[config.environment] = (report.summary.byEnvironment[config.environment] || 0) + 1;
      
      // Total queries
      report.summary.totalQueries += config.queries.length;
    });

    report.summary.avgQueriesPerConfig = configs.length > 0 ? 
      Math.round(report.summary.totalQueries / configs.length) : 0;

    // Generate recommendations
    if (report.summary.avgQueriesPerConfig > 15) {
      report.recommendations.push({
        type: 'performance',
        message: 'Average queries per configuration is high. Consider splitting large configurations.',
        priority: 'medium'
      });
    }

    const exportConfigs = configs.filter(c => c.type === 'export');
    const deployConfigs = configs.filter(c => c.type === 'deploy');

    if (exportConfigs.length > deployConfigs.length * 2) {
      report.recommendations.push({
        type: 'workflow',
        message: 'More export configurations than deploy configurations. Consider creating more deploy configs.',
        priority: 'low'
      });
    }

    return report;
  }
}

module.exports = new YamlConfigService();
