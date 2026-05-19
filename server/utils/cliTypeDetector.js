const logger = require('./logger');

/**
 * Auto-detect CLI type (SF CLI vs Vlocity CLI) based on job configuration.
 *
 * Detection logic:
 * 1. If cliType is explicitly set, use it
 * 2. If queries use SF CLI format (object/soql_query, no VlocityDataPackType), use 'sf'
 * 3. If queries target GT custom objects, use 'sf'
 * 4. Default to 'vlocity'
 *
 * @param {Object} jobConfig - The job configuration object
 * @param {string} [jobConfig.cliType] - Explicit CLI type
 * @param {Array} [jobConfig.queries] - Query configurations
 * @param {string} [jobConfig.name] - Job name for logging
 * @returns {string} - 'sf' or 'vlocity'
 */
function detectCliType(jobConfig) {
  // Return explicit CLI type if provided
  if (jobConfig.cliType) {
    return jobConfig.cliType;
  }

  // Check queries for SF CLI format indicators
  if (jobConfig.queries && Array.isArray(jobConfig.queries)) {
    // SF CLI format: has 'object' or 'soql_query', but NO 'VlocityDataPackType'
    const hasSfCliFormat = jobConfig.queries.some(query => {
      return (query.object || query.soql_query) && !query.VlocityDataPackType;
    });

    if (hasSfCliFormat) {
      logger.logOperation('Auto-detected SF CLI based on query format', {
        jobName: jobConfig.name
      });
      return 'sf';
    }

    // Fallback: Check if any query targets GT custom objects
    const hasGTCustomObjects = jobConfig.queries.some(query => {
      const objectName = query.object || query.target_object || '';
      return objectName.startsWith('GT_') && objectName.endsWith('__c');
    });

    if (hasGTCustomObjects) {
      logger.logOperation('Auto-detected SF CLI for GT custom objects', {
        jobName: jobConfig.name
      });
      return 'sf';
    }
  }

  // Default to vlocity
  return 'vlocity';
}

module.exports = {
  detectCliType,
};
