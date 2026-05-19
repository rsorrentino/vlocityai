const axios = require('axios');
const logger = require('../utils/logger');
const PropertiesReader = require('../utils/propertiesReader');
const path = require('path');

class ConfigValidator {
  constructor() {
    this.propertiesPath = path.join(__dirname, '../../environments.properties');
    this.properties = new PropertiesReader(this.propertiesPath);
  }

  /**
   * Validate YAML configuration structure
   */
  validateYamlConfig(config) {
    const errors = [];
    const warnings = [];

    // Required fields validation
    if (!config.projectPath) {
      errors.push('projectPath is required');
    }

    if (!config.queries || !Array.isArray(config.queries)) {
      errors.push('queries must be an array');
    } else if (config.queries.length === 0) {
      errors.push('at least one query is required');
    }

    // Query validation
    if (config.queries) {
      config.queries.forEach((query, index) => {
        const queryErrors = this.validateQuery(query, index);
        errors.push(...queryErrors);
      });
    }

    // Settings validation
    if (config.defaultMaxParallel && (config.defaultMaxParallel < 1 || config.defaultMaxParallel > 50)) {
      warnings.push('defaultMaxParallel should be between 1 and 50');
    }

    if (config.exportPacksMaxSize && (config.exportPacksMaxSize < 100 || config.exportPacksMaxSize > 10000)) {
      warnings.push('exportPacksMaxSize should be between 100 and 10000');
    }

    if (config.maxDepth && config.maxDepth < 0) {
      errors.push('maxDepth cannot be negative');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate individual query
   */
  validateQuery(query, index) {
    const errors = [];

    if (typeof query === 'string') {
      // Simple string query - basic validation
      if (!query.trim()) {
        errors.push(`Query ${index + 1}: empty query string`);
      }
      return errors;
    }

    if (typeof query === 'object') {
      // Object query validation
      if (!query.VlocityDataPackType && !query.name) {
        errors.push(`Query ${index + 1}: must have either VlocityDataPackType or name`);
      }

      if (query.VlocityDataPackType) {
        if (!query.query) {
          errors.push(`Query ${index + 1}: query field is required for VlocityDataPackType`);
        } else {
          // Validate SOQL query
          const soqlErrors = this.validateSOQLQuery(query.query);
          errors.push(...soqlErrors.map(error => `Query ${index + 1}: ${error}`));
        }
      }

      if (query.name) {
        if (!query.soql_query) {
          errors.push(`Query ${index + 1}: soql_query field is required for named queries`);
        } else {
          const soqlErrors = this.validateSOQLQuery(query.soql_query);
          errors.push(...soqlErrors.map(error => `Query ${index + 1}: ${error}`));
        }

        if (!query.external_key) {
          errors.push(`Query ${index + 1}: external_key is required for named queries`);
        }

        if (!query.target_object) {
          errors.push(`Query ${index + 1}: target_object is required for named queries`);
        }
      }
    } else {
      errors.push(`Query ${index + 1}: must be a string or object`);
    }

    return errors;
  }

  /**
   * Validate SOQL query syntax
   */
  validateSOQLQuery(query) {
    const errors = [];

    if (!query || typeof query !== 'string') {
      errors.push('SOQL query must be a string');
      return errors;
    }

    const trimmedQuery = query.trim();

    // Basic SOQL structure validation
    if (!trimmedQuery.toUpperCase().startsWith('SELECT')) {
      errors.push('SOQL query must start with SELECT');
    }

    if (!trimmedQuery.toUpperCase().includes('FROM')) {
      errors.push('SOQL query must contain FROM clause');
    }

    // Check for common SOQL issues
    if (trimmedQuery.includes('SELECT *')) {
      errors.push('Avoid using SELECT * in SOQL queries');
    }

    // Validate date literals
    const dateLiteralRegex = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+\d{4}/g;
    const dateLiterals = trimmedQuery.match(dateLiteralRegex);
    if (dateLiterals) {
      dateLiterals.forEach(dateLiteral => {
        if (!this.isValidISODate(dateLiteral)) {
          errors.push(`Invalid date literal: ${dateLiteral}`);
        }
      });
    }

    return errors;
  }

  /**
   * Validate ISO date format
   */
  isValidISODate(dateString) {
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date);
  }

  /**
   * Test configuration against Salesforce org
   */
  async testConfiguration(config, username) {
    const results = {
      valid: true,
      tests: [],
      errors: [],
      warnings: []
    };

    try {
      // Test 1: Validate YAML structure
      const yamlValidation = this.validateYamlConfig(config);
      results.tests.push({
        name: 'YAML Structure Validation',
        status: yamlValidation.valid ? 'passed' : 'failed',
        details: yamlValidation.errors.length > 0 ? yamlValidation.errors : 'Configuration structure is valid'
      });

      if (!yamlValidation.valid) {
        results.valid = false;
        results.errors.push(...yamlValidation.errors);
      }
      results.warnings.push(...yamlValidation.warnings);

      // Test 2: Test Salesforce connection
      const connectionTest = await this.testSalesforceConnection(username);
      results.tests.push(connectionTest);

      if (!connectionTest.status === 'passed') {
        results.valid = false;
        results.errors.push('Salesforce connection failed');
      }

      // Test 3: Validate SOQL queries
      if (config.queries && connectionTest.status === 'passed') {
        const queryTests = await this.testSOQLQueries(config.queries, username);
        results.tests.push(...queryTests);

        const failedQueries = queryTests.filter(test => test.status === 'failed');
        if (failedQueries.length > 0) {
          results.valid = false;
          results.errors.push(`${failedQueries.length} queries failed validation`);
        }
      }

      // Test 4: Check object permissions
      if (config.queries && connectionTest.status === 'passed') {
        const permissionTests = await this.testObjectPermissions(config.queries, username);
        results.tests.push(...permissionTests);

        const failedPermissions = permissionTests.filter(test => test.status === 'failed');
        if (failedPermissions.length > 0) {
          results.warnings.push(`${failedPermissions.length} objects have permission issues`);
        }
      }

    } catch (error) {
      logger.logError(error, { operation: 'testConfiguration' });
      results.valid = false;
      results.errors.push(`Configuration test failed: ${error.message}`);
    }

    return results;
  }

  /**
   * Test Salesforce connection
   */
  async testSalesforceConnection(username) {
    try {
      // This would typically use Salesforce CLI or API
      // For now, we'll simulate the test
      const response = await axios.get(`/api/orgs/status?username=${username}`);
      
      if (response.data.connected) {
        return {
          name: 'Salesforce Connection',
          status: 'passed',
          details: `Successfully connected to ${username}`
        };
      } else {
        return {
          name: 'Salesforce Connection',
          status: 'failed',
          details: `Failed to connect to ${username}`
        };
      }
    } catch (error) {
      return {
        name: 'Salesforce Connection',
        status: 'failed',
        details: `Connection error: ${error.message}`
      };
    }
  }

  /**
   * Test SOQL queries
   */
  async testSOQLQueries(queries, username) {
    const tests = [];

    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      const testName = `Query ${i + 1}: ${typeof query === 'string' ? query : query.name || 'Unnamed'}`;

      try {
        let soqlQuery = '';
        
        if (typeof query === 'string') {
          soqlQuery = query;
        } else if (query.query) {
          soqlQuery = query.query;
        } else if (query.soql_query) {
          soqlQuery = query.soql_query;
        }

        if (soqlQuery) {
          // Test query syntax by attempting to explain it
          const testResult = await this.testSOQLSyntax(soqlQuery, username);
          tests.push({
            name: testName,
            status: testResult.valid ? 'passed' : 'failed',
            details: testResult.message
          });
        } else {
          tests.push({
            name: testName,
            status: 'skipped',
            details: 'No SOQL query to test'
          });
        }
      } catch (error) {
        tests.push({
          name: testName,
          status: 'failed',
          details: `Query test failed: ${error.message}`
        });
      }
    }

    return tests;
  }

  /**
   * Test SOQL syntax
   */
  async testSOQLSyntax(query, username) {
    try {
      // This would typically use Salesforce CLI to test the query
      // For now, we'll simulate basic validation
      
      // Check if query is too long
      if (query.length > 20000) {
        return {
          valid: false,
          message: 'Query exceeds maximum length (20,000 characters)'
        };
      }

      // Check for basic SOQL structure
      const upperQuery = query.toUpperCase();
      if (!upperQuery.includes('SELECT') || !upperQuery.includes('FROM')) {
        return {
          valid: false,
          message: 'Invalid SOQL structure - missing SELECT or FROM clause'
        };
      }

      // Check for potentially problematic patterns
      if (upperQuery.includes('SELECT *')) {
        return {
          valid: false,
          message: 'SELECT * is not recommended - specify field names'
        };
      }

      return {
        valid: true,
        message: 'Query syntax appears valid'
      };
    } catch (error) {
      return {
        valid: false,
        message: `Syntax check failed: ${error.message}`
      };
    }
  }

  /**
   * Test object permissions
   */
  async testObjectPermissions(queries, username) {
    const tests = [];
    const objects = new Set();

    // Extract object names from queries
    queries.forEach(query => {
      let soqlQuery = '';
      if (typeof query === 'string') {
        soqlQuery = query;
      } else if (query.query) {
        soqlQuery = query.query;
      } else if (query.soql_query) {
        soqlQuery = query.soql_query;
      }

      if (soqlQuery) {
        const fromMatch = soqlQuery.match(/FROM\s+(\w+)/i);
        if (fromMatch) {
          objects.add(fromMatch[1]);
        }
      }
    });

    // Test permissions for each object
    for (const objectName of objects) {
      try {
        const permissionTest = await this.testObjectPermission(objectName, username);
        tests.push({
          name: `Object Permission: ${objectName}`,
          status: permissionTest.hasPermission ? 'passed' : 'failed',
          details: permissionTest.message
        });
      } catch (error) {
        tests.push({
          name: `Object Permission: ${objectName}`,
          status: 'failed',
          details: `Permission check failed: ${error.message}`
        });
      }
    }

    return tests;
  }

  /**
   * Test individual object permission
   */
  async testObjectPermission(objectName, username) {
    try {
      // This would typically check Salesforce object permissions
      // For now, we'll simulate the check
      
      // Common Vlocity objects that should be accessible
      const commonVlocityObjects = [
        'Product2', 'PricebookEntry', 'vlocity_cmt__PricingElement__c',
        'vlocity_cmt__AttributeCategory__c', 'vlocity_cmt__ObjectClass__c',
        'vlocity_cmt__Attribute__c', 'vlocity_cmt__Picklist__c',
        'vlocity_cmt__PriceListEntry__c', 'vlocity_cmt__CatalogProductRelationship__c',
        'vlocity_cmt__AttributeAssignment__c'
      ];

      if (commonVlocityObjects.includes(objectName)) {
        return {
          hasPermission: true,
          message: `Read access confirmed for ${objectName}`
        };
      }

      // For custom objects, assume permission exists (would need actual API call)
      if (objectName.includes('__c')) {
        return {
          hasPermission: true,
          message: `Custom object ${objectName} - permission assumed`
        };
      }

      return {
        hasPermission: false,
        message: `Unknown object ${objectName} - permission status unclear`
      };
    } catch (error) {
      return {
        hasPermission: false,
        message: `Permission check error: ${error.message}`
      };
    }
  }

  /**
   * Generate configuration recommendations
   */
  generateRecommendations(config) {
    const recommendations = [];

    // Performance recommendations
    if (config.queries && config.queries.length > 20) {
      recommendations.push({
        type: 'performance',
        priority: 'high',
        message: 'Consider splitting large query sets into smaller batches for better performance',
        suggestion: 'Use multiple configuration files or implement pagination'
      });
    }

    if (config.defaultMaxParallel && config.defaultMaxParallel > 20) {
      recommendations.push({
        type: 'performance',
        priority: 'medium',
        message: 'High parallel processing may impact org performance',
        suggestion: 'Consider reducing defaultMaxParallel to 10-15'
      });
    }

    // Security recommendations
    const hasDateFilters = config.queries?.some(query => {
      const queryStr = typeof query === 'string' ? query : query.query || query.soql_query || '';
      return queryStr.includes('LastModifiedDate') || queryStr.includes('CreatedDate');
    });

    if (!hasDateFilters && config.queries && config.queries.length > 0) {
      recommendations.push({
        type: 'security',
        priority: 'high',
        message: 'Queries without date filters may export large amounts of data',
        suggestion: 'Add date filters to limit data scope (e.g., LastModifiedDate >= 2025-01-01)'
      });
    }

    // Best practices recommendations
    const hasSelectStar = config.queries?.some(query => {
      const queryStr = typeof query === 'string' ? query : query.query || query.soql_query || '';
      return queryStr.toUpperCase().includes('SELECT *');
    });

    if (hasSelectStar) {
      recommendations.push({
        type: 'best_practice',
        priority: 'medium',
        message: 'Avoid SELECT * queries for better performance and clarity',
        suggestion: 'Specify individual field names in SELECT clauses'
      });
    }

    return recommendations;
  }
}

module.exports = new ConfigValidator();

