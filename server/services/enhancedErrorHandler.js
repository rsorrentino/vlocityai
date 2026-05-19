/**
 * Enhanced Error Handler
 * Provides comprehensive error categorization and user-friendly guidance
 */

class EnhancedErrorHandler {
  constructor() {
    this.errorCategories = {
      // Authentication & Authorization
      Authentication: {
        severity: 'critical',
        recoverable: true,
        retryable: false,
        userMessage: 'Authentication failed. Please log in to Salesforce again.',
        technicalMessage: 'Invalid or expired Salesforce credentials',
        actions: [
          'Run: sfdx auth:web:login -a <org-alias>',
          'Verify your username is correct',
          'Check if your session has expired',
        ],
        relatedDocs: 'https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_auth.htm',
      },
      Permission: {
        severity: 'critical',
        recoverable: false,
        retryable: false,
        userMessage: 'You don\'t have permission to perform this operation.',
        technicalMessage: 'Insufficient privileges or object/field access',
        actions: [
          'Contact your Salesforce administrator',
          'Request access to the required objects/fields',
          'Verify your user profile permissions',
        ],
        relatedDocs: 'https://help.salesforce.com/s/articleView?id=sf.users_profiles.htm',
      },

      // Network & Connectivity
      Network: {
        severity: 'high',
        recoverable: true,
        retryable: true,
        userMessage: 'Network connection failed. Please check your internet connection.',
        technicalMessage: 'Unable to connect to Salesforce servers',
        actions: [
          'Check your internet connection',
          'Verify Salesforce is accessible (https://status.salesforce.com)',
          'Check firewall and proxy settings',
          'Try again in a few moments',
        ],
        retryStrategy: {
          maxAttempts: 3,
          delayMs: 5000,
          backoffMultiplier: 2,
        },
      },
      Timeout: {
        severity: 'high',
        recoverable: true,
        retryable: true,
        userMessage: 'Operation timed out. The request took too long to complete.',
        technicalMessage: 'Request exceeded maximum execution time',
        actions: [
          'Reduce the number of records in one batch',
          'Split the operation into smaller chunks',
          'Check Salesforce performance (https://status.salesforce.com)',
          'Increase timeout settings if appropriate',
        ],
        retryStrategy: {
          maxAttempts: 2,
          delayMs: 10000,
          backoffMultiplier: 1.5,
        },
      },

      // Rate Limiting & Quotas
      RateLimit: {
        severity: 'high',
        recoverable: true,
        retryable: true,
        userMessage: 'API rate limit exceeded. Too many requests in a short period.',
        technicalMessage: 'Salesforce API rate limit reached',
        actions: [
          'Wait a few minutes before retrying',
          'Reduce concurrent operations',
          'Check API usage in Setup > System Overview',
          'Consider upgrading your Salesforce edition for higher limits',
        ],
        retryStrategy: {
          maxAttempts: 3,
          delayMs: 60000, // 1 minute
          backoffMultiplier: 2,
        },
      },
      QuotaExceeded: {
        severity: 'critical',
        recoverable: false,
        retryable: false,
        userMessage: 'Storage quota or API limit exceeded for your organization.',
        technicalMessage: 'Salesforce org limits reached',
        actions: [
          'Check org limits in Setup > System Overview',
          'Free up storage space or data storage',
          'Contact Salesforce support for limit increases',
          'Consider archiving old data',
        ],
        relatedDocs: 'https://help.salesforce.com/s/articleView?id=sf.overview_limits.htm',
      },

      // Data Issues
      Duplicate: {
        severity: 'medium',
        recoverable: false,
        retryable: false,
        userMessage: 'Duplicate record detected. A record with the same unique field value already exists.',
        technicalMessage: 'Duplicate value on record with unique field constraint',
        actions: [
          'Check if the record already exists in Salesforce',
          'Update the existing record instead of creating new',
          'Modify the unique field value',
          'Review duplicate rules in your org',
        ],
      },
      Validation: {
        severity: 'medium',
        recoverable: false,
        retryable: false,
        userMessage: 'Validation rule failed. The data doesn\'t meet required criteria.',
        technicalMessage: 'Salesforce validation rule prevented the operation',
        actions: [
          'Review validation rules for the object',
          'Correct the field values to meet validation criteria',
          'Temporarily deactivate validation rules if appropriate',
          'Contact your Salesforce administrator',
        ],
      },
      NotFound: {
        severity: 'medium',
        recoverable: true,
        retryable: false,
        userMessage: 'Referenced record not found. A required record is missing.',
        technicalMessage: 'Record or field reference not found in target org',
        actions: [
          'Deploy dependencies first',
          'Verify the record exists in the source org',
          'Check if the record was deleted',
          'Enable export recovery to automatically fetch dependencies',
        ],
      },
      OrphanedReference: {
        severity: 'medium',
        recoverable: true,
        retryable: true,
        userMessage: 'Orphaned reference detected. A related record is missing.',
        technicalMessage: 'Reference to non-existent record',
        actions: [
          'Deploy parent records first',
          'Export with dependencies',
          'Use packUpdateSettings to sync relationships',
          'Check data integrity in source org',
        ],
        retryStrategy: {
          maxAttempts: 2,
          delayMs: 5000,
          backoffMultiplier: 1,
        },
      },

      // Configuration Issues
      SettingsMismatch: {
        severity: 'medium',
        recoverable: true,
        retryable: true,
        userMessage: 'Settings mismatch detected between source and target orgs.',
        technicalMessage: 'Organization settings differ between source and target',
        actions: [
          'Run packUpdateSettings command',
          'Manually sync settings in both orgs',
          'Use pre-align settings option',
          'Check Setup > Company Settings for differences',
        ],
        retryStrategy: {
          maxAttempts: 1,
          delayMs: 2000,
          backoffMultiplier: 1,
          autoFix: 'updateSettings',
        },
      },

      // Syntax & Format
      Syntax: {
        severity: 'high',
        recoverable: false,
        retryable: false,
        userMessage: 'Syntax error in command or query.',
        technicalMessage: 'Invalid syntax in SOQL query or command arguments',
        actions: [
          'Verify SOQL query syntax',
          'Check command arguments format',
          'Review Salesforce SOQL documentation',
          'Test query in Developer Console first',
        ],
        relatedDocs: 'https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/',
      },

      // Resource Issues
      OutOfMemory: {
        severity: 'critical',
        recoverable: true,
        retryable: true,
        userMessage: 'Out of memory. The operation required too much memory.',
        technicalMessage: 'Node.js heap memory limit exceeded',
        actions: [
          'Reduce batch size',
          'Process fewer records at once',
          'Increase Node.js memory: node --max-old-space-size=4096',
          'Close other applications to free memory',
        ],
        retryStrategy: {
          maxAttempts: 1,
          delayMs: 5000,
          backoffMultiplier: 1,
        },
      },

      // CLI-Specific
      CLINotFound: {
        severity: 'critical',
        recoverable: false,
        retryable: false,
        userMessage: 'Salesforce or Vlocity CLI not found.',
        technicalMessage: 'Required CLI tool not installed or not in PATH',
        actions: [
          'Install Salesforce CLI: npm install -g @salesforce/cli',
          'Install Vlocity Build: npm install -g vlocity',
          'Verify PATH environment variable includes npm global bin',
          'Restart terminal after installation',
        ],
        relatedDocs: 'https://developer.salesforce.com/tools/sfdxcli',
      },
      CLIVersionMismatch: {
        severity: 'medium',
        recoverable: false,
        retryable: false,
        userMessage: 'CLI version incompatibility detected.',
        technicalMessage: 'Installed CLI version doesn\'t match requirements',
        actions: [
          'Update CLI: npm update -g @salesforce/cli',
          'Check version: sfdx version',
          'Review version requirements in documentation',
        ],
      },

      // Unknown
      Unknown: {
        severity: 'medium',
        recoverable: false,
        retryable: false,
        userMessage: 'An unexpected error occurred.',
        technicalMessage: 'Unrecognized error type',
        actions: [
          'Check the full error logs for details',
          'Search Salesforce forums for similar issues',
          'Contact support with the error details',
          'Try the operation again',
        ],
      },
    };
  }

  /**
   * Get error category information
   */
  getErrorCategory(errorType) {
    return this.errorCategories[errorType] || this.errorCategories.Unknown;
  }

  /**
   * Format error for user display
   */
  formatUserError(error) {
    const category = this.getErrorCategory(error.type);

    return {
      title: `${this.getSeverityIcon(category.severity)} ${error.type}`,
      message: category.userMessage,
      technicalDetails: error.message,
      severity: category.severity,
      recoverable: category.recoverable,
      retryable: category.retryable,
      actions: category.actions,
      documentation: category.relatedDocs,
      timestamp: new Date().toISOString(),
      context: error.context,
    };
  }

  /**
   * Get severity icon
   */
  getSeverityIcon(severity) {
    const icons = {
      critical: '🔴',
      high: '🟠',
      medium: '🟡',
      low: '🟢',
    };
    return icons[severity] || '⚪';
  }

  /**
   * Determine if error should trigger auto-retry
   */
  shouldAutoRetry(errorType, attemptNumber = 1) {
    const category = this.getErrorCategory(errorType);

    if (!category.retryable || !category.retryStrategy) {
      return false;
    }

    return attemptNumber < category.retryStrategy.maxAttempts;
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  getRetryDelay(errorType, attemptNumber = 1) {
    const category = this.getErrorCategory(errorType);

    if (!category.retryStrategy) {
      return 0;
    }

    const { delayMs, backoffMultiplier } = category.retryStrategy;
    return delayMs * Math.pow(backoffMultiplier, attemptNumber - 1);
  }

  /**
   * Get auto-fix action if available
   */
  getAutoFix(errorType) {
    const category = this.getErrorCategory(errorType);
    return category.retryStrategy?.autoFix || null;
  }

  /**
   * Analyze multiple errors and provide aggregate guidance
   */
  analyzeErrors(errors) {
    const analysis = {
      totalErrors: errors.length,
      errorsByType: {},
      errorsBySeverity: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      },
      recoverableErrors: 0,
      retryableErrors: 0,
      topErrorTypes: [],
      recommendations: [],
    };

    // Categorize errors
    errors.forEach(error => {
      const category = this.getErrorCategory(error.type);

      // Count by type
      if (!analysis.errorsByType[error.type]) {
        analysis.errorsByType[error.type] = {
          count: 0,
          severity: category.severity,
          recoverable: category.recoverable,
          retryable: category.retryable,
          examples: [],
        };
      }
      analysis.errorsByType[error.type].count++;
      analysis.errorsByType[error.type].examples.push(error.message.substring(0, 100));

      // Count by severity
      analysis.errorsBySeverity[category.severity]++;

      // Count recoverable/retryable
      if (category.recoverable) analysis.recoverableErrors++;
      if (category.retryable) analysis.retryableErrors++;
    });

    // Get top error types
    analysis.topErrorTypes = Object.entries(analysis.errorsByType)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([type, data]) => ({
        type,
        count: data.count,
        severity: data.severity,
      }));

    // Generate recommendations
    if (analysis.errorsBySeverity.critical > 0) {
      analysis.recommendations.push({
        priority: 'high',
        message: `${analysis.errorsBySeverity.critical} critical error(s) require immediate attention`,
        action: 'Review and fix critical errors before retrying',
      });
    }

    if (analysis.retryableErrors > analysis.totalErrors * 0.5) {
      analysis.recommendations.push({
        priority: 'medium',
        message: 'Most errors are retryable',
        action: 'Wait a few moments and retry the operation',
      });
    }

    if (analysis.errorsByType.SettingsMismatch) {
      analysis.recommendations.push({
        priority: 'high',
        message: 'Settings mismatch detected',
        action: 'Run packUpdateSettings to automatically sync settings',
      });
    }

    if (analysis.errorsByType.RateLimit) {
      analysis.recommendations.push({
        priority: 'high',
        message: 'API rate limit exceeded',
        action: 'Wait at least 1 minute before retrying, or reduce concurrent operations',
      });
    }

    if (analysis.errorsByType.NotFound || analysis.errorsByType.OrphanedReference) {
      analysis.recommendations.push({
        priority: 'medium',
        message: 'Missing dependencies detected',
        action: 'Enable export recovery or deploy parent records first',
      });
    }

    return analysis;
  }

  /**
   * Generate user-friendly error report
   */
  generateErrorReport(errors) {
    const analysis = this.analyzeErrors(errors);
    const lines = [];

    lines.push('═══════════════════════════════════════════════════════');
    lines.push('                   ERROR REPORT                        ');
    lines.push('═══════════════════════════════════════════════════════');
    lines.push('');

    // Summary
    lines.push(`Total Errors: ${analysis.totalErrors}`);
    lines.push(`  🔴 Critical: ${analysis.errorsBySeverity.critical}`);
    lines.push(`  🟠 High:     ${analysis.errorsBySeverity.high}`);
    lines.push(`  🟡 Medium:   ${analysis.errorsBySeverity.medium}`);
    lines.push(`  🟢 Low:      ${analysis.errorsBySeverity.low}`);
    lines.push('');

    // Top errors
    if (analysis.topErrorTypes.length > 0) {
      lines.push('Top Error Types:');
      analysis.topErrorTypes.forEach((errorType, index) => {
        const icon = this.getSeverityIcon(errorType.severity);
        lines.push(`  ${index + 1}. ${icon} ${errorType.type}: ${errorType.count} occurrence(s)`);
      });
      lines.push('');
    }

    // Recommendations
    if (analysis.recommendations.length > 0) {
      lines.push('📋 Recommendations:');
      analysis.recommendations.forEach((rec, index) => {
        const icon = rec.priority === 'high' ? '⚠️' : 'ℹ️';
        lines.push(`  ${index + 1}. ${icon} ${rec.message}`);
        lines.push(`     → ${rec.action}`);
      });
      lines.push('');
    }

    // Detailed errors (first 5)
    lines.push('Detailed Errors:');
    errors.slice(0, 5).forEach((error, index) => {
      const formatted = this.formatUserError(error);
      lines.push(`\n${index + 1}. ${formatted.title}`);
      lines.push(`   ${formatted.message}`);
      if (formatted.actions && formatted.actions.length > 0) {
        lines.push(`   Actions:`);
        formatted.actions.slice(0, 3).forEach(action => {
          lines.push(`     • ${action}`);
        });
      }
    });

    if (errors.length > 5) {
      lines.push(`\n... and ${errors.length - 5} more error(s)`);
    }

    lines.push('');
    lines.push('═══════════════════════════════════════════════════════');

    return lines.join('\n');
  }
}

module.exports = new EnhancedErrorHandler();
