const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');
const salesforceService = require('./salesforceService');

/**
 * Service to automatically fix resolvable Vlocity deployment errors
 */
class VlocityErrorFixer {
  constructor() {
    this.errorLogPath = path.join(process.cwd(), 'VlocityBuildErrors.log');
  }

  /**
   * Parse duplicate field errors from error log
   * @param {string} errorLogPath - Path to error log file
   * @returns {Array} Array of duplicate field errors
   */
  parseDuplicateFieldErrors(errorLogPath = null) {
    try {
      const targetPath = errorLogPath || this.errorLogPath;
      
      if (!fs.pathExistsSync(targetPath)) {
        return [];
      }

      const content = fs.readFileSync(targetPath, 'utf8');
      const lines = content.split('\n');
      const duplicateErrors = [];

      for (const line of lines) {
        if (line.includes('duplicate field value found')) {
          // Match pattern: duplicate field value found: VALUE on the field: FIELD on record with id: RECORD_ID
          const match = line.match(/duplicate field value found: (.+?) on the field: (.+?) on record with id: ([A-Za-z0-9]{15,18})/);
          if (match) {
            duplicateErrors.push({
              value: match[1].trim(),
              field: match[2].trim(),
              recordId: match[3].trim(),
              fullLine: line
            });
          }
        }
      }

      return duplicateErrors;
    } catch (error) {
      logger.logError(error, { operation: 'parseDuplicateFieldErrors', errorLogPath });
      return [];
    }
  }

  /**
   * Fix duplicate field values by generating unique values
   * @param {Array} duplicateErrors - Array of duplicate field errors
   * @param {string} targetUsername - Target Salesforce username
   * @param {string} jobId - Optional job ID for logging
   * @returns {Promise<Object>} Fix result
   */
  async fixDuplicateFields(duplicateErrors, targetUsername, jobId = null) {
    if (duplicateErrors.length === 0) {
      return { success: true, fixesApplied: 0 };
    }

    logger.info(`Fixing ${duplicateErrors.length} duplicate field errors`, { targetUsername });

    if (jobId) {
      const jobMonitor = require('./jobMonitor');
      jobMonitor.addJobLog(jobId, `🔧 Fixing ${duplicateErrors.length} duplicate field errors...`, 'info');
    }

    // Group duplicates by field and value
    const duplicatesByField = {};
    
    for (const error of duplicateErrors) {
      const key = `${error.field}_${error.value}`;
      if (!duplicatesByField[key]) {
        duplicatesByField[key] = [];
      }
      duplicatesByField[key].push(error);
    }

    const fixes = [];
    let fixCounter = 10000; // Start from a high number to avoid conflicts

    // Generate fixes for duplicate records (keep first one, fix the rest)
    for (const [key, records] of Object.entries(duplicatesByField)) {
      if (records.length > 1) {
        // Multiple records with same value - need to fix all but one
        for (let i = 1; i < records.length; i++) {
          const record = records[i];
          let newValue;
          
          if (record.field === 'vlocity_cmt__Code__c') {
            // For Code field, append a suffix
            newValue = `${record.value}_FIX${fixCounter++}`;
          } else if (record.field === 'vlocity_cmt__DisplaySequence__c') {
            // For DisplaySequence, use a unique number
            newValue = fixCounter++;
          } else {
            // Generic fix
            newValue = `${record.value}_FIX${fixCounter++}`;
          }

          fixes.push({
            recordId: record.recordId,
            field: record.field,
            oldValue: record.value,
            newValue: newValue
          });
        }
      }
    }

    if (fixes.length === 0) {
      return { success: true, fixesApplied: 0 };
    }

    // Authenticate with Salesforce
    await salesforceService.authenticateWithSfdx(targetUsername);

    // Determine object type from field name
    const objectType = 'vlocity_cmt__AttributeCategory__c'; // Most common case

    // Create update statements
    const updates = fixes.map(fix => {
      const updateObj = { id: fix.recordId };
      updateObj[fix.field] = fix.field === 'vlocity_cmt__DisplaySequence__c' 
        ? parseInt(fix.newValue) 
        : fix.newValue;
      return updateObj;
    });

    // Update in batches
    const batchSize = 200;
    let totalSuccess = 0;
    let totalFailed = 0;

    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      
      if (jobId) {
        const jobMonitor = require('./jobMonitor');
        jobMonitor.addJobLog(jobId, `  Updating batch ${batchNum} (${batch.length} records)...`, 'info');
      }

      const results = await Promise.allSettled(
        batch.map(async (update) => {
          const fieldName = Object.keys(update).find(k => k !== 'id');
          const fieldValue = update[fieldName];
          
          await salesforceService.update(objectType, update.id, {
            [fieldName]: fieldValue
          });
          
          return { success: true, recordId: update.id, field: fieldName, value: fieldValue };
        })
      );

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      
      totalSuccess += successful;
      totalFailed += failed;

      if (jobId) {
        const jobMonitor = require('./jobMonitor');
        jobMonitor.addJobLog(jobId, `    ✅ ${successful} updated, ❌ ${failed} failed`, successful > 0 ? 'info' : 'warn');
      }
    }

    const result = {
      success: totalFailed === 0,
      fixesApplied: totalSuccess,
      fixesFailed: totalFailed,
      totalFixes: fixes.length
    };

    if (jobId) {
      const jobMonitor = require('./jobMonitor');
      if (result.success) {
        jobMonitor.addJobLog(jobId, `✅ Fixed ${totalSuccess} duplicate field errors successfully!`, 'info');
      } else {
        jobMonitor.addJobLog(jobId, `⚠️  Fixed ${totalSuccess} errors, ${totalFailed} failed`, 'warn');
      }
    }

    logger.info('Duplicate field fixes completed', {
      targetUsername,
      totalSuccess,
      totalFailed,
      totalFixes: fixes.length
    });

    return result;
  }

  /**
   * Check if error log contains duplicate field errors
   * @param {string} errorLogPath - Path to error log file
   * @returns {boolean} True if duplicate field errors found
   */
  hasDuplicateFieldErrors(errorLogPath = null) {
    const errors = this.parseDuplicateFieldErrors(errorLogPath);
    return errors.length > 0;
  }
}

module.exports = new VlocityErrorFixer();

