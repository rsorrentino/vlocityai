const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Properties File Management Service
 * Handles multiple properties files with fallback support
 */
class PropertiesService {
  constructor() {
    this.propertiesCache = new Map();
    this.fallbackOrder = [
      'vlocity-build.properties',
      'vlocity.properties',
      'build.properties',
      'default.properties'
    ];
    this.propertiesDir = process.env.PROPERTIES_DIR || './properties';
    this.ensurePropertiesDir();
  }

  /**
   * Ensure properties directory exists (removed - not used)
   */
  ensurePropertiesDir() {
    // Directory creation removed - not used
  }

  /**
   * Get properties file path
   */
  getPropertiesPath(filename) {
    return path.join(this.propertiesDir, filename);
  }

  /**
   * Load properties from a file
   */
  async loadPropertiesFile(filePath) {
    try {
      if (!await fs.pathExists(filePath)) {
        return null;
      }

      const content = await fs.readFile(filePath, 'utf8');
      const properties = this.parseProperties(content);
      
      logger.logDebug('Properties file loaded', {
        filePath,
        propertyCount: Object.keys(properties).length,
        service: 'propertiesService'
      });

      return properties;
    } catch (error) {
      logger.logError(error, {
        operation: 'loadPropertiesFile',
        filePath,
        service: 'propertiesService'
      });
      return null;
    }
  }

  /**
   * Parse properties file content
   */
  parseProperties(content) {
    const properties = {};
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip empty lines and comments
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        continue;
      }
      
      // Parse key=value pairs
      const equalIndex = trimmedLine.indexOf('=');
      if (equalIndex > 0) {
        const key = trimmedLine.substring(0, equalIndex).trim();
        const value = trimmedLine.substring(equalIndex + 1).trim();
        
        // Remove quotes if present
        const cleanValue = value.replace(/^["']|["']$/g, '');
        properties[key] = cleanValue;
      }
    }
    
    return properties;
  }

  /**
   * Load properties with fallback support
   */
  async loadProperties(environment = null, customFallbackOrder = null) {
    const fallbackOrder = customFallbackOrder || this.fallbackOrder;
    const cacheKey = `${environment || 'default'}_${fallbackOrder.join('_')}`;
    
    // Check cache first
    if (this.propertiesCache.has(cacheKey)) {
      return this.propertiesCache.get(cacheKey);
    }

    let mergedProperties = {};
    const loadedFiles = [];
    const errors = [];

    // Try each file in fallback order
    for (const filename of fallbackOrder) {
      try {
        let filePath;
        
        // Check for environment-specific file first
        if (environment) {
          const envFilename = filename.replace('.properties', `-${environment}.properties`);
          const envFilePath = this.getPropertiesPath(envFilename);
          
          if (await fs.pathExists(envFilePath)) {
            filePath = envFilePath;
          }
        }
        
        // Fall back to regular filename
        if (!filePath) {
          filePath = this.getPropertiesPath(filename);
        }
        
        const properties = await this.loadPropertiesFile(filePath);
        
        if (properties) {
          // Merge properties (later files override earlier ones)
          mergedProperties = { ...mergedProperties, ...properties };
          loadedFiles.push(filePath);
          
          logger.logVerbose(`Properties loaded from ${path.basename(filePath)}`, {
            filePath,
            propertyCount: Object.keys(properties).length,
            service: 'propertiesService'
          });
        }
      } catch (error) {
        errors.push({
          filename,
          error: error.message
        });
      }
    }

    const result = {
      properties: mergedProperties,
      loadedFiles,
      errors,
      environment,
      fallbackOrder: fallbackOrder.slice(0, loadedFiles.length)
    };

    // Cache the result
    this.propertiesCache.set(cacheKey, result);

    logger.log('info', `Properties loaded with fallback support`, {
      environment,
      loadedFiles: loadedFiles.length,
      totalProperties: Object.keys(mergedProperties).length,
      errors: errors.length,
      service: 'propertiesService'
    });

    return result;
  }

  /**
   * Get a specific property value
   */
  async getProperty(key, environment = null, defaultValue = null) {
    const result = await this.loadProperties(environment);
    return result.properties[key] || defaultValue;
  }

  /**
   * Set a property value
   */
  async setProperty(key, value, environment = null, targetFile = null) {
    const filename = targetFile || (environment ? `vlocity-${environment}.properties` : 'vlocity.properties');
    const filePath = this.getPropertiesPath(filename);
    
    // Load existing properties
    const existingProperties = await this.loadPropertiesFile(filePath) || {};
    
    // Update the property
    existingProperties[key] = value;
    
    // Write back to file
    const content = this.serializeProperties(existingProperties);
    await fs.writeFile(filePath, content, 'utf8');
    
    // Clear cache
    this.clearCache();
    
    logger.log('info', `Property set: ${key}=${value}`, {
      key,
      value,
      filePath,
      environment,
      service: 'propertiesService'
    });
    
    return filePath;
  }

  /**
   * Serialize properties to file content
   */
  serializeProperties(properties) {
    const lines = [];
    
    // Add header comment
    lines.push('# Vlocity Properties File');
    lines.push(`# Generated on ${new Date().toISOString()}`);
    lines.push('');
    
    // Add properties
    for (const [key, value] of Object.entries(properties)) {
      lines.push(`${key}=${value}`);
    }
    
    return lines.join('\n');
  }

  /**
   * Get all available properties files
   */
  async getAvailablePropertiesFiles() {
    try {
      const files = await fs.readdir(this.propertiesDir);
      const propertiesFiles = files
        .filter(file => file.endsWith('.properties'))
        .map(file => ({
          filename: file,
          filePath: this.getPropertiesPath(file),
          environment: this.extractEnvironmentFromFilename(file)
        }));
      
      return propertiesFiles;
    } catch (error) {
      logger.logError(error, {
        operation: 'getAvailablePropertiesFiles',
        service: 'propertiesService'
      });
      return [];
    }
  }

  /**
   * Extract environment from filename
   */
  extractEnvironmentFromFilename(filename) {
    const match = filename.match(/-(\w+)\.properties$/);
    return match ? match[1] : 'default';
  }

  /**
   * Create a new properties file
   */
  async createPropertiesFile(filename, properties = {}, environment = null) {
    const filePath = this.getPropertiesPath(filename);
    
    // Add environment-specific properties if environment is specified
    if (environment) {
      properties = {
        ...properties,
        environment,
        created: new Date().toISOString()
      };
    }
    
    const content = this.serializeProperties(properties);
    await fs.writeFile(filePath, content, 'utf8');
    
    // Clear cache
    this.clearCache();
    
    logger.log('info', `Properties file created: ${filename}`, {
      filename,
      filePath,
      propertyCount: Object.keys(properties).length,
      environment,
      service: 'propertiesService'
    });
    
    return filePath;
  }

  /**
   * Delete a properties file
   */
  async deletePropertiesFile(filename) {
    const filePath = this.getPropertiesPath(filename);
    
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
      
      // Clear cache
      this.clearCache();
      
      logger.log('info', `Properties file deleted: ${filename}`, {
        filename,
        filePath,
        service: 'propertiesService'
      });
      
      return true;
    }
    
    return false;
  }

  /**
   * Get properties file statistics
   */
  async getPropertiesStats() {
    const files = await this.getAvailablePropertiesFiles();
    const stats = {
      totalFiles: files.length,
      environments: [...new Set(files.map(f => f.environment))],
      totalProperties: 0,
      files: []
    };
    
    for (const file of files) {
      const properties = await this.loadPropertiesFile(file.filePath);
      const propertyCount = properties ? Object.keys(properties).length : 0;
      
      stats.totalProperties += propertyCount;
      stats.files.push({
        filename: file.filename,
        environment: file.environment,
        propertyCount,
        filePath: file.filePath
      });
    }
    
    return stats;
  }

  /**
   * Clear properties cache
   */
  clearCache() {
    this.propertiesCache.clear();
    logger.logDebug('Properties cache cleared', {
      service: 'propertiesService'
    });
  }

  /**
   * Validate properties file
   */
  async validatePropertiesFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const properties = this.parseProperties(content);
      
      const validation = {
        valid: true,
        errors: [],
        warnings: [],
        propertyCount: Object.keys(properties).length
      };
      
      // Check for common issues
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNumber = i + 1;
        
        // Check for lines with = but no key
        if (line.includes('=') && !line.match(/^\s*\w+\s*=/)) {
          validation.warnings.push(`Line ${lineNumber}: Invalid property format`);
        }
        
        // Check for duplicate keys
        const keyMatch = line.match(/^([^=]+)=/);
        if (keyMatch) {
          const key = keyMatch[1].trim();
          const duplicates = Object.keys(properties).filter(k => k === key);
          if (duplicates.length > 1) {
            validation.warnings.push(`Duplicate key: ${key}`);
          }
        }
      }
      
      return validation;
    } catch (error) {
      return {
        valid: false,
        errors: [error.message],
        warnings: [],
        propertyCount: 0
      };
    }
  }

  /**
   * Merge properties from multiple sources
   */
  async mergeProperties(sources, environment = null) {
    const merged = {};
    const sourceInfo = [];
    
    for (const source of sources) {
      try {
        let properties;
        
        if (typeof source === 'string') {
          // File path
          properties = await this.loadPropertiesFile(source);
        } else if (source.properties) {
          // Properties object
          properties = source.properties;
        } else {
          continue;
        }
        
        if (properties) {
          Object.assign(merged, properties);
          sourceInfo.push({
            source: typeof source === 'string' ? source : source.name || 'object',
            propertyCount: Object.keys(properties).length
          });
        }
      } catch (error) {
        logger.logError(error, {
          operation: 'mergeProperties',
          source,
          service: 'propertiesService'
        });
      }
    }
    
    return {
      properties: merged,
      sourceInfo,
      totalProperties: Object.keys(merged).length
    };
  }
}

// Create singleton instance
const propertiesService = new PropertiesService();

module.exports = propertiesService;
