const logger = require('../utils/logger');

/**
 * Vlocity Error Handler
 * Categorizes and sanitizes Vlocity-specific errors for better handling
 * Based on patterns from official Vlocity Build Tool
 */
class VlocityErrorHandler {
  constructor() {
    this.errorCategories = {
      'NotFound': {
        handler: this.handleNotFound.bind(this),
        severity: 'warning',
        autoRecoverable: false,
        description: 'Referenced object not found'
      },
      'NoMatchFound': {
        handler: this.handleNoMatchFound.bind(this),
        severity: 'error',
        autoRecoverable: true,
        description: 'Parent dependency not found - can retry after deploying parent'
      },
      'SettingsMismatch': {
        handler: this.handleSettingsMismatch.bind(this),
        severity: 'error',
        autoRecoverable: true,
        description: 'Settings mismatch - can auto-sync settings'
      },
      'DuplicateValue': {
        handler: this.handleDuplicateValue.bind(this),
        severity: 'error',
        autoRecoverable: false,
        description: 'Duplicate value found - data cleanup required'
      },
      'OrphanedReference': {
        handler: this.handleOrphanedReference.bind(this),
        severity: 'error',
        autoRecoverable: true,
        description: 'Orphaned reference - can deploy parent first'
      },
      'SObjectUniqueness': {
        handler: this.handleSObjectUniqueness.bind(this),
        severity: 'error',
        autoRecoverable: false,
        description: 'Unique constraint violation'
      },
      'WereNotProcessed': {
        handler: this.handleWereNotProcessed.bind(this),
        severity: 'error',
        autoRecoverable: true,
        description: 'Some records were not processed - may resolve on retry'
      },
      'ValidationError': {
        handler: this.handleValidationError.bind(this),
        severity: 'error',
        autoRecoverable: false,
        description: 'Data validation failed'
      },
      'PermissionError': {
        handler: this.handlePermissionError.bind(this),
        severity: 'error',
        autoRecoverable: false,
        description: 'Permission denied'
      }
    };
  }

  /**
   * Categorize an error
   * @param {Error|Object} error - Error to categorize
   * @param {Object} context - Context information
   * @returns {Promise<Object>} Categorized error information
   */
  async categorizeError(error, context = {}) {
    const errorMessage = error.message || String(error);
    const errorCode = error.code || error.errorCode;

    try {
      // Try to match error to a category
      for (const [category, config] of Object.entries(this.errorCategories)) {
        if (this.matchesCategory(errorMessage, errorCode, category)) {
          const sanitizedMessage = await config.handler(error, context);

          return {
            category,
            severity: config.severity,
            autoRecoverable: config.autoRecoverable,
            sanitizedMessage,
            description: config.description,
            originalError: error,
            context
          };
        }
      }

      // Default: Unknown error
      return {
        category: 'Unknown',
        severity: 'error',
        autoRecoverable: false,
        sanitizedMessage: errorMessage,
        description: 'Uncategorized error',
        originalError: error,
        context
      };
    } catch (err) {
      logger.error('Error in categorizeError', {
        originalError: error,
        categorizationError: err
      });

      return {
        category: 'CategorizationError',
        severity: 'error',
        autoRecoverable: false,
        sanitizedMessage: errorMessage,
        description: 'Failed to categorize error',
        originalError: error,
        context
      };
    }
  }

  /**
   * Check if error matches a category
   * @param {string} message - Error message
   * @param {string} code - Error code
   * @param {string} category - Category to check
   * @returns {boolean} True if matches
   */
  matchesCategory(message, code, category) {
    const patterns = {
      'NotFound': /not found|does not exist|missing|was not found/i,
      'NoMatchFound': /no match found|could not find|not found for/i,
      'SettingsMismatch': /setting.*mismatch|configuration.*not.*found|no configuration found/i,
      'DuplicateValue': /duplicate.*value|unique constraint|duplicate.*found/i,
      'OrphanedReference': /orphan|missing.*reference|parent.*not.*found|no.*parent/i,
      'SObjectUniqueness': /incorrect.*import.*data|multiple.*records.*will.*incorrectly.*create/i,
      'WereNotProcessed': /some records were not processed|records.*not.*processed/i,
      'ValidationError': /validation.*error|invalid.*data|data.*quality/i,
      'PermissionError': /permission|access.*denied|insufficient.*privileges/i
    };

    const pattern = patterns[category];
    if (!pattern) {
      return false;
    }

    return pattern.test(message) || pattern.test(code || '');
  }

  /**
   * Handle "Not Found" errors
   */
  async handleNotFound(error, context) {
    const message = error.message || String(error);
    
    // Extract referenced object type and name
    const match = message.match(/(\w+)\s+--\s+(\w+)\s+--\s+Not Found/i);
    if (match) {
      return `${match[1]} "${match[2]}" was not found. Ensure it exists in the source org or exclude it from export.`;
    }

    // Alternative pattern: "VlocityUITemplate --- ShowProducts --- Not Found"
    const match2 = message.match(/(\w+)\s+---\s+(\w+)\s+---\s+Not Found/i);
    if (match2) {
      return `${match2[1]} "${match2[2]}" was not found. This may be safe to ignore if the template is embedded in a Visualforce page.`;
    }

    return message;
  }

  /**
   * Handle "No Match Found" errors (missing parent dependencies)
   */
  async handleNoMatchFound(error, context) {
    const message = error.message || String(error);
    
    // Extract parent reference info
    // Pattern: "No match found for vlocity_cmt__ProductChildItem__c.vlocity_cmt__ChildProductId__c - vlocity_cmt__GlobalKey__c=db65c1c5-ada4-7952-6aa5-8a6b2455ea02"
    const match = message.match(/No match found for\s+(\w+)\.(\w+)\s+.*GlobalKey__c=([^\s]+)/i);
    if (match) {
      return `${match[1]}.${match[2]} references missing record with GlobalKey ${match[3]}. Deploy parent record first or ensure it exists in the target org.`;
    }

    return message;
  }

  /**
   * Handle "Settings Mismatch" errors
   */
  async handleSettingsMismatch(error, context) {
    const message = error.message || String(error);
    
    if (message.includes('No Configuration Found')) {
      return 'Settings mismatch detected. Run "packUpdateSettings" or enable "autoUpdateSettings: true" in job file to automatically sync settings.';
    }

    return 'Settings configuration mismatch between source and target org. Sync settings before deploying.';
  }

  /**
   * Handle "Duplicate Value" errors
   */
  async handleDuplicateValue(error, context) {
    const message = error.message || String(error);
    
    // Pattern: "duplicate value found: <unknown> duplicates value on record with id: <unknown>"
    const match = message.match(/duplicate value found[^:]*:\s*([^\s]+)/i);
    if (match) {
      return `Duplicate value detected: ${match[1]}. Review and update duplicate values in the target org.`;
    }

    return 'Duplicate value found. Review data for duplicate entries and update or remove duplicates.';
  }

  /**
   * Handle "Orphaned Reference" errors
   */
  async handleOrphanedReference(error, context) {
    const message = error.message || String(error);
    
    // Pattern: "Orphan Rate Table (no Rate Code)"
    if (message.includes('Orphan')) {
      return message;
    }

    return 'Record references a missing parent object. Deploy parent object first or remove the orphaned reference.';
  }

  /**
   * Handle "SObject Uniqueness" errors
   */
  async handleSObjectUniqueness(error, context) {
    const message = error.message || String(error);
    
    // Pattern: "Multiple Imported Records will incorrectly create the same Salesforce Record. vlocity_cmt__CatalogProductRelationship__c: 20MB Plan"
    const match = message.match(/Multiple Imported Records.*?(\w+):\s*([^\s]+)/i);
    if (match) {
      return `Duplicate records detected for ${match[1]}: "${match[2]}". Remove duplicates from source org before deploying.`;
    }

    return 'Multiple records would create the same Salesforce record. Review and remove duplicates.';
  }

  /**
   * Handle "Were Not Processed" errors
   */
  async handleWereNotProcessed(error, context) {
    const message = error.message || String(error);
    
    return 'Some records were not processed. This may be due to missing dependencies or configuration mismatches. Re-run "packUpdateSettings" and retry deployment.';
  }

  /**
   * Handle "Validation Error" errors
   */
  async handleValidationError(error, context) {
    const message = error.message || String(error);
    
    // Extract validation details if available
    if (message.includes('validation')) {
      return `Data validation failed: ${message}. Review data quality and fix validation issues before deploying.`;
    }

    return message;
  }

  /**
   * Handle "Permission Error" errors
   */
  async handlePermissionError(error, context) {
    const message = error.message || String(error);
    
    if (message.includes('permission') || message.includes('access')) {
      return 'Permission denied. Ensure the user has necessary permissions to access the required objects and fields.';
    }

    return message;
  }

  /**
   * Batch categorize multiple errors
   * @param {Array<Error>} errors - Array of errors
   * @param {Object} context - Context information
   * @returns {Promise<Array>} Array of categorized errors
   */
  async categorizeErrors(errors, context = {}) {
    const categorized = await Promise.all(
      errors.map(error => this.categorizeError(error, context))
    );

    // Group by category
    const grouped = {};
    categorized.forEach(cat => {
      if (!grouped[cat.category]) {
        grouped[cat.category] = [];
      }
      grouped[cat.category].push(cat);
    });

    return {
      categorized,
      grouped,
      summary: {
        total: categorized.length,
        byCategory: Object.keys(grouped).reduce((acc, cat) => {
          acc[cat] = grouped[cat].length;
          return acc;
        }, {}),
        recoverable: categorized.filter(c => c.autoRecoverable).length,
        nonRecoverable: categorized.filter(c => !c.autoRecoverable).length
      }
    };
  }
}

module.exports = new VlocityErrorHandler();

