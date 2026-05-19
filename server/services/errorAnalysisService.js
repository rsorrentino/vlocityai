const salesforceMetadataService = require('./salesforceMetadataService');
const logger = require('../utils/logger');

/**
 * Service for analyzing errors in export/deploy jobs
 * Extracts Salesforce IDs, identifies object types, and generates SOQL queries
 */
class ErrorAnalysisService {
  /**
   * Extract Salesforce IDs from error messages
   * Salesforce IDs are 15 or 18 characters, starting with 3-character prefix
   * @param {string} errorMessage - Error message text
   * @returns {Array<string>} Array of unique Salesforce IDs
   */
  extractSalesforceIds(errorMessage) {
    if (!errorMessage || typeof errorMessage !== 'string') {
      return [];
    }

    // Salesforce ID pattern: 15 or 18 characters, alphanumeric
    // Common formats: "Id: 001xxx", "Record ID: 003yyy", standalone IDs
    const idPattern = /\b([a-zA-Z0-9]{15}|[a-zA-Z0-9]{18})\b/g;
    const matches = errorMessage.match(idPattern);
    
    if (!matches) {
      return [];
    }

    // Filter out pure numbers and pure lowercase words (likely timestamps or English words)
    // Salesforce IDs always contain at least one letter and at least one digit
    const validIds = matches.filter(id => {
      return /[A-Za-z]/.test(id) && /[0-9]/.test(id);
    });

    // Return unique IDs
    return [...new Set(validIds)];
  }

  /**
   * Generate SOQL query for a set of record IDs
   * @param {string} objectType - Salesforce object type (e.g., 'Product2')
   * @param {Array<string>} ids - Array of record IDs
   * @param {Array<string>} fields - Fields to include in query (default: ['Id', 'Name'])
   * @returns {string} SOQL query string
   */
  generateSOQLQuery(objectType, ids, fields = ['Id', 'Name']) {
    if (!ids || ids.length === 0) {
      return null;
    }

    // SOQL IN clause limit is 10,000, but we'll use 200 for safety
    const fieldList = fields.join(', ');
    
    if (ids.length === 1) {
      return `SELECT ${fieldList} FROM ${objectType} WHERE Id = '${ids[0]}'`;
    }

    // For multiple IDs, split into chunks if needed
    const chunks = [];
    const chunkSize = 200;
    
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const idList = chunk.map(id => `'${id}'`).join(', ');
      chunks.push(`SELECT ${fieldList} FROM ${objectType} WHERE Id IN (${idList})`);
    }

    return chunks.join('\n\n-- OR --\n\n');
  }

  /**
   * Analyze errors and extract IDs with object types
   * @param {Array<Object>} errors - Array of error objects with message property
   * @param {string} username - Salesforce username for resolving object types
   * @returns {Promise<Object>} Analysis results with object types and queries
   */
  async analyzeErrors(errors, username) {
    try {
      if (!errors || !Array.isArray(errors) || errors.length === 0) {
        return {
          analyzed: false,
          message: 'No errors to analyze'
        };
      }

      // Extract all IDs from all error messages
      const allIds = new Set();
      errors.forEach(error => {
        const message = error.message || error.toString();
        const ids = this.extractSalesforceIds(message);
        ids.forEach(id => allIds.add(id));
      });

      if (allIds.size === 0) {
        return {
          analyzed: false,
          message: 'No Salesforce IDs found in error messages'
        };
      }

      const idsArray = Array.from(allIds);
      logger.info(`Analyzing ${idsArray.length} unique IDs from ${errors.length} errors`, { username });

      // Resolve ID prefixes to object types (best-effort — fall back to "Unknown" if SF CLI fails)
      let prefixMap = new Map();
      try {
        prefixMap = await salesforceMetadataService.resolveIdPrefixes(idsArray, username);
      } catch (resolveErr) {
        logger.warn('Could not resolve ID prefixes via SF CLI, falling back to unknown types', {
          error: resolveErr.message
        });
      }

      // Map IDs to object types; any unresolved ID goes into "Unknown"
      const objectMap = salesforceMetadataService.mapIdsToObjects(idsArray, prefixMap);
      if (objectMap.size === 0 && idsArray.length > 0) {
        objectMap.set('Unknown', idsArray);
      }

      // Generate queries for each object type
      const queries = [];
      const objectStats = {};

      objectMap.forEach((ids, objectType) => {
        objectStats[objectType] = {
          count: ids.length,
          ids: ids.slice(0, 10) // Show first 10 IDs as examples
        };

        // Determine fields based on object type
        let fields = ['Id', 'Name'];
        
        // Add common fields for specific object types
        if (objectType === 'Product2') {
          fields = ['Id', 'Name', 'ProductCode', 'IsActive', 'CreatedDate', 'LastModifiedDate'];
        } else if (objectType === 'PricebookEntry') {
          fields = ['Id', 'Name', 'Product2Id', 'Pricebook2Id', 'UnitPrice', 'IsActive'];
        } else if (objectType.includes('vlocity_cmt__')) {
          // For Vlocity objects, try to include GlobalKey if available
          fields = ['Id', 'Name', 'vlocity_cmt__GlobalKey__c', 'CreatedDate', 'LastModifiedDate'];
        } else {
          fields = ['Id', 'Name', 'CreatedDate', 'LastModifiedDate'];
        }

        const query = this.generateSOQLQuery(objectType, ids, fields);
        
        queries.push({
          objectType,
          recordCount: ids.length,
          query,
          sampleIds: ids.slice(0, 5) // Show first 5 as samples
        });
      });

      return {
        analyzed: true,
        totalIds: idsArray.length,
        objectTypes: Array.from(objectMap.keys()),
        objectStats,
        queries,
        summary: {
          totalErrors: errors.length,
          uniqueIds: idsArray.length,
          objectTypesCount: objectMap.size
        }
      };
    } catch (error) {
      logger.logError(error, { operation: 'analyzeErrors', username, errorCount: errors?.length });
      return {
        analyzed: false,
        error: error.message,
        message: `Error analysis failed: ${error.message}`
      };
    }
  }
}

module.exports = new ErrorAnalysisService();

