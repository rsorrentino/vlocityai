const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');
const salesforceService = require('./salesforceService');

/**
 * DataPack Dependency Service
 * Tracks and resolves DataPack dependencies to ensure correct deployment order
 * Based on patterns from official Vlocity Build Tool
 */
class DataPackDependencyService {
  constructor() {
    this.dependencyGraph = new Map();
    this.objectDependencies = new Map(); // Cache object field dependencies
  }

  /**
   * Resolve dependencies for a set of DataPack keys
   * @param {Array<string>} dataPackKeys - Array of DataPack keys
   * @param {string} username - Salesforce username
   * @returns {Promise<Array>} DataPack keys in dependency order (parents before children)
   */
  async resolveDependencies(dataPackKeys, username) {
    try {
      logger.info('Resolving DataPack dependencies', { 
        keyCount: dataPackKeys.length 
      });

      const resolved = [];
      const pending = [...dataPackKeys];
      const visited = new Set();
      const dependencyMap = new Map();

      // Build dependency map
      await this.buildDependencyMap(pending, username, dependencyMap);

      // Topological sort: parents before children
      const sorted = this.topologicalSort(dependencyMap, pending);

      logger.info('Dependencies resolved', { 
        originalCount: dataPackKeys.length,
        resolvedCount: sorted.length
      });

      return sorted;
    } catch (error) {
      logger.error('Failed to resolve dependencies', { 
        error: error.message,
        keyCount: dataPackKeys.length
      });
      throw error;
    }
  }

  /**
   * Build dependency map for DataPack keys
   * @param {Array<string>} dataPackKeys - DataPack keys
   * @param {string} username - Salesforce username
   * @param {Map} dependencyMap - Map to populate
   */
  async buildDependencyMap(dataPackKeys, username, dependencyMap) {
    await salesforceService.authenticateWithSfdx(username);

    for (const key of dataPackKeys) {
      if (!dependencyMap.has(key)) {
        dependencyMap.set(key, new Set());
      }

      const dependencies = await this.getDependencies(key, username);
      
      dependencies.forEach(dep => {
        if (!dependencyMap.has(dep)) {
          dependencyMap.set(dep, new Set());
        }
        dependencyMap.get(dep).add(key); // Reverse: dep depends on key means key is parent of dep
      });
    }
  }

  /**
   * Get dependencies for a DataPack key
   * @param {string} dataPackKey - DataPack key (e.g., "Product2/guid")
   * @param {string} username - Salesforce username
   * @returns {Promise<Array<string>>} Array of dependent DataPack keys
   */
  async getDependencies(dataPackKey, username) {
    try {
      const [type, name] = dataPackKey.split('/');
      const dataPackPath = this.getDataPackPath(dataPackKey);

      if (!await fs.pathExists(dataPackPath)) {
        // If DataPack not exported, try to infer from type
        return this.inferDependenciesFromType(type, name);
      }

      const dataPack = await fs.readJson(dataPackPath);
      return this.extractDependencies(dataPack);
    } catch (error) {
      logger.warn('Failed to get dependencies', { 
        dataPackKey, 
        error: error.message 
      });
      return [];
    }
  }

  /**
   * Extract dependencies from DataPack JSON
   * @param {Object} dataPack - DataPack JSON object
   * @returns {Array<string>} Array of dependent DataPack keys
   */
  extractDependencies(dataPack) {
    const dependencies = [];
    
    if (!dataPack || !dataPack.VlocityDataPackData) {
      return dependencies;
    }

    const dataPackData = dataPack.VlocityDataPackData;
    
    // Walk through all records looking for references
    Object.values(dataPackData).forEach(records => {
      if (Array.isArray(records)) {
        records.forEach(record => {
          this.extractRecordDependencies(record, dependencies);
        });
      }
    });

    return [...new Set(dependencies)]; // Remove duplicates
  }

  /**
   * Extract dependencies from a single record
   * @param {Object} record - Record object
   * @param {Array<string>} dependencies - Dependencies array to populate
   */
  extractRecordDependencies(record, dependencies) {
    if (!record || typeof record !== 'object') {
      return;
    }

    Object.keys(record).forEach(key => {
      const value = record[key];

      // Check for relationship fields (ends with __r or __c with Id reference)
      if (key.endsWith('__r') && value && typeof value === 'object') {
        // Parent relationship
        if (value.VlocityDataPackType && value.VlocityDataPackKey) {
          dependencies.push(value.VlocityDataPackKey);
        }
      } else if (key.endsWith('Id__c') || key.endsWith('Id') || key === 'ParentId' || key === 'Product2Id') {
        // ID reference - try to resolve to DataPack key
        if (value && typeof value === 'string' && value.length === 18) {
          // Looks like a Salesforce ID
          const inferredKey = this.inferKeyFromId(key, value);
          if (inferredKey) {
            dependencies.push(inferredKey);
          }
        }
      } else if (key.includes('GlobalKey') && value) {
        // Global key reference
        const parentType = this.inferTypeFromField(key);
        if (parentType && value) {
          dependencies.push(`${parentType}/${value}`);
        }
      } else if (Array.isArray(value)) {
        // Recursively check arrays
        value.forEach(item => {
          this.extractRecordDependencies(item, dependencies);
        });
      } else if (typeof value === 'object' && value !== null) {
        // Recursively check nested objects
        this.extractRecordDependencies(value, dependencies);
      }
    });
  }

  /**
   * Infer dependencies from object type
   * @param {string} type - DataPack type
   * @param {string} name - DataPack name
   * @returns {Array<string>} Inferred dependencies
   */
  inferDependenciesFromType(type, name) {
    const dependencies = [];

    // Common dependency patterns
    const typeDependencies = {
      'ProductChildItem': ['Product2'],
      'PriceListEntry': ['PriceList', 'Product2'],
      'PricingElement': ['PriceList', 'PricingVariable'],
      'PromotionItem': ['Promotion', 'Product2'],
      'RateTable': ['RateCode', 'Product2']
    };

    if (typeDependencies[type]) {
      return typeDependencies[type];
    }

    return dependencies;
  }

  /**
   * Infer DataPack key from ID field
   * @param {string} fieldName - Field name
   * @param {string} id - Salesforce ID
   * @returns {string|null} Inferred DataPack key
   */
  inferKeyFromId(fieldName, id) {
    // Map common field patterns to object types
    const fieldToType = {
      'PriceListId': 'PriceList',
      'Product2Id': 'Product2',
      'ParentId': 'Product2',
      'RateCodeId': 'RateCode',
      'PromotionId': 'Promotion'
    };

    const type = fieldToType[fieldName.replace(/__c$/, '').replace(/Id$/, '')];
    if (type) {
      // For now, return placeholder - would need to query to get GlobalKey
      return `${type}/${id}`;
    }

    return null;
  }

  /**
   * Infer object type from field name
   * @param {string} fieldName - Field name
   * @returns {string|null} Object type
   */
  inferTypeFromField(fieldName) {
    // Common patterns
    if (fieldName.includes('PriceList')) return 'PriceList';
    if (fieldName.includes('Product')) return 'Product2';
    if (fieldName.includes('RateCode')) return 'RateCode';
    if (fieldName.includes('Promotion')) return 'Promotion';
    
    return null;
  }

  /**
   * Get DataPack file path
   * @param {string} dataPackKey - DataPack key
   * @returns {string} File path
   */
  getDataPackPath(dataPackKey) {
    const [type, name] = dataPackKey.split('/');
    const projectPath = process.env.PROJECT_PATH || './export';
    return path.join(projectPath, type, name, `${name}_DataPack.json`);
  }

  /**
   * Topological sort of dependencies
   * @param {Map} dependencyMap - Dependency map (key -> Set of dependents)
   * @param {Array<string>} dataPackKeys - Original DataPack keys
   * @returns {Array<string>} Sorted keys (parents before children)
   */
  topologicalSort(dependencyMap, dataPackKeys) {
    const sorted = [];
    const visited = new Set();
    const visiting = new Set();

    const visit = (key) => {
      if (visiting.has(key)) {
        // Circular dependency detected
        logger.warn('Circular dependency detected', { key });
        return;
      }

      if (visited.has(key)) {
        return;
      }

      visiting.add(key);

      // Visit dependencies first
      const dependents = dependencyMap.get(key) || new Set();
      dependents.forEach(dep => visit(dep));

      visiting.delete(key);
      visited.add(key);
      sorted.push(key);
    };

    // Visit all keys
    dataPackKeys.forEach(key => {
      if (!visited.has(key)) {
        visit(key);
      }
    });

    return sorted;
  }

  /**
   * Validate deployment order
   * @param {Array<string>} dataPackKeys - DataPack keys to deploy
   * @param {string} username - Salesforce username
   * @returns {Promise<Object>} Validation result
   */
  async validateDeploymentOrder(dataPackKeys, username) {
    try {
      const resolved = await this.resolveDependencies(dataPackKeys, username);
      
      // Check if order matches dependency requirements
      const issues = [];
      const orderMap = new Map();
      resolved.forEach((key, index) => {
        orderMap.set(key, index);
      });

      for (const key of resolved) {
        const dependencies = await this.getDependencies(key, username);
        
        dependencies.forEach(dep => {
          const depIndex = orderMap.get(dep);
          const keyIndex = orderMap.get(key);
          
          if (depIndex !== undefined && depIndex > keyIndex) {
            issues.push({
              type: 'ORDER_VIOLATION',
              child: key,
              parent: dep,
              message: `${key} depends on ${dep} but ${dep} comes after in deployment order`
            });
          }
        });
      }

      return {
        valid: issues.length === 0,
        issues,
        recommendedOrder: resolved
      };
    } catch (error) {
      logger.error('Failed to validate deployment order', { error: error.message });
      throw error;
    }
  }
}

module.exports = new DataPackDependencyService();

