/**
 * Command Validator
 * Validates CLI commands before execution to prevent failures
 */

const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

class CommandValidator {
  /**
   * Validate Vlocity export command
   */
  async validateVlocityExport(config) {
    const errors = [];
    const warnings = [];

    // Validate required fields
    if (!config.username) {
      errors.push({
        field: 'username',
        message: 'Salesforce username is required',
        code: 'MISSING_USERNAME',
      });
    }

    if (!config.jobFilePath) {
      errors.push({
        field: 'jobFilePath',
        message: 'Job file path is required',
        code: 'MISSING_JOB_PATH',
      });
    }

    // Validate job file exists
    if (config.jobFilePath) {
      try {
        await fs.access(config.jobFilePath);
      } catch (err) {
        errors.push({
          field: 'jobFilePath',
          message: `Job file not found: ${config.jobFilePath}`,
          code: 'JOB_FILE_NOT_FOUND',
        });
      }
    }

    // Validate CLI installation
    const cliCheck = await this.checkVlocityCLI();
    if (!cliCheck.installed) {
      errors.push({
        field: 'cli',
        message: 'Vlocity Build CLI is not installed',
        code: 'CLI_NOT_INSTALLED',
        suggestion: 'Run: npm install -g vlocity',
      });
    } else if (cliCheck.version) {
      // Version validation
      const minVersion = '1.16.0';
      if (this.compareVersions(cliCheck.version, minVersion) < 0) {
        warnings.push({
          field: 'cli',
          message: `Vlocity Build version ${cliCheck.version} is outdated (minimum: ${minVersion})`,
          code: 'CLI_VERSION_OLD',
          suggestion: 'Run: npm update -g vlocity',
        });
      }
    }

    // Validate authentication
    if (config.username) {
      const authCheck = await this.checkSalesforceAuth(config.username);
      if (!authCheck.authenticated) {
        errors.push({
          field: 'username',
          message: `Not authenticated to Salesforce org: ${config.username}`,
          code: 'NOT_AUTHENTICATED',
          suggestion: `Run: sfdx auth:web:login -a ${config.username}`,
        });
      } else if (authCheck.expired) {
        warnings.push({
          field: 'username',
          message: 'Authentication token may be expired soon',
          code: 'AUTH_EXPIRING',
          suggestion: 'Re-authenticate to avoid interruption',
        });
      }
    }

    // Validate export command
    const validCommands = ['packExport', 'packExportAllDefault', 'packExportSingle'];
    if (config.exportCommand && !validCommands.includes(config.exportCommand)) {
      errors.push({
        field: 'exportCommand',
        message: `Invalid export command: ${config.exportCommand}`,
        code: 'INVALID_COMMAND',
        suggestion: `Valid commands: ${validCommands.join(', ')}`,
      });
    }

    // Check disk space
    const diskCheck = await this.checkDiskSpace();
    if (diskCheck.available < 1024 * 1024 * 1024) { // < 1 GB
      warnings.push({
        field: 'disk',
        message: `Low disk space: ${Math.round(diskCheck.available / 1024 / 1024)} MB available`,
        code: 'LOW_DISK_SPACE',
        suggestion: 'Free up disk space before large exports',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate Vlocity deploy command
   */
  async validateVlocityDeploy(config) {
    const errors = [];
    const warnings = [];

    // Validate required fields
    if (!config.targetUsername) {
      errors.push({
        field: 'targetUsername',
        message: 'Target Salesforce username is required',
        code: 'MISSING_TARGET_USERNAME',
      });
    }

    if (!config.jobFilePath) {
      errors.push({
        field: 'jobFilePath',
        message: 'Job file path is required',
        code: 'MISSING_JOB_PATH',
      });
    }

    // Validate job file exists
    if (config.jobFilePath) {
      try {
        await fs.access(config.jobFilePath);
      } catch (err) {
        errors.push({
          field: 'jobFilePath',
          message: `Job file not found: ${config.jobFilePath}`,
          code: 'JOB_FILE_NOT_FOUND',
        });
      }
    }

    // Validate CLI installation
    const cliCheck = await this.checkVlocityCLI();
    if (!cliCheck.installed) {
      errors.push({
        field: 'cli',
        message: 'Vlocity Build CLI is not installed',
        code: 'CLI_NOT_INSTALLED',
        suggestion: 'Run: npm install -g vlocity',
      });
    }

    // Validate authentication
    if (config.targetUsername) {
      const authCheck = await this.checkSalesforceAuth(config.targetUsername);
      if (!authCheck.authenticated) {
        errors.push({
          field: 'targetUsername',
          message: `Not authenticated to Salesforce org: ${config.targetUsername}`,
          code: 'NOT_AUTHENTICATED',
          suggestion: `Run: sfdx auth:web:login -a ${config.targetUsername}`,
        });
      }
    }

    // Validate deploy command
    const validCommands = ['packDeploy', 'packContinue', 'packRetry'];
    if (config.deployCommand && !validCommands.includes(config.deployCommand)) {
      errors.push({
        field: 'deployCommand',
        message: `Invalid deploy command: ${config.deployCommand}`,
        code: 'INVALID_COMMAND',
        suggestion: `Valid commands: ${validCommands.join(', ')}`,
      });
    }

    // Validate attempts
    if (config.attempts && (config.attempts < 1 || config.attempts > 10)) {
      warnings.push({
        field: 'attempts',
        message: `Unusual retry attempts count: ${config.attempts}`,
        code: 'UNUSUAL_ATTEMPTS',
        suggestion: 'Typical range is 1-5 attempts',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate Salesforce CLI command
   */
  async validateSalesforceCLI(config) {
    const errors = [];
    const warnings = [];

    // Validate required fields
    if (!config.username) {
      errors.push({
        field: 'username',
        message: 'Salesforce username is required',
        code: 'MISSING_USERNAME',
      });
    }

    // Validate CLI installation
    const cliCheck = await this.checkSalesforceCLI();
    if (!cliCheck.installed) {
      errors.push({
        field: 'cli',
        message: 'Salesforce CLI is not installed',
        code: 'CLI_NOT_INSTALLED',
        suggestion: 'Run: npm install -g @salesforce/cli',
      });
    }

    // Validate SOQL query if provided
    if (config.query) {
      const queryCheck = this.validateSOQLQuery(config.query);
      if (!queryCheck.valid) {
        errors.push({
          field: 'query',
          message: queryCheck.error,
          code: 'INVALID_SOQL',
          suggestion: 'Check SOQL syntax: https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/',
        });
      }
    }

    // Validate authentication
    if (config.username) {
      const authCheck = await this.checkSalesforceAuth(config.username);
      if (!authCheck.authenticated) {
        errors.push({
          field: 'username',
          message: `Not authenticated to Salesforce org: ${config.username}`,
          code: 'NOT_AUTHENTICATED',
          suggestion: `Run: sf org login web --alias ${config.username}`,
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Check if Vlocity CLI is installed
   */
  async checkVlocityCLI() {
    try {
      const { stdout } = await exec('vlocity --version');
      const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
      return {
        installed: true,
        version: versionMatch ? versionMatch[1] : null,
      };
    } catch (err) {
      return {
        installed: false,
        version: null,
      };
    }
  }

  /**
   * Check if Salesforce CLI is installed
   */
  async checkSalesforceCLI() {
    try {
      // Try 'sf' first (new CLI)
      const { stdout } = await exec('sf version');
      const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
      return {
        installed: true,
        version: versionMatch ? versionMatch[1] : null,
        binary: 'sf',
      };
    } catch (err) {
      try {
        // Fallback to 'sfdx' (legacy CLI)
        const { stdout } = await exec('sfdx version');
        const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
        return {
          installed: true,
          version: versionMatch ? versionMatch[1] : null,
          binary: 'sfdx',
        };
      } catch (err2) {
        return {
          installed: false,
          version: null,
          binary: null,
        };
      }
    }
  }

  /**
   * Check Salesforce authentication status
   */
  async checkSalesforceAuth(username) {
    try {
      const { stdout } = await exec(`sfdx org:list --json`);
      const result = JSON.parse(stdout);

      const org = result.result.nonScratchOrgs?.find(o => o.username === username) ||
                  result.result.scratchOrgs?.find(o => o.username === username);

      if (!org) {
        return {
          authenticated: false,
          expired: false,
        };
      }

      // Check if token is expiring soon (within 7 days)
      const expirationDate = org.expirationDate ? new Date(org.expirationDate) : null;
      const now = new Date();
      const daysUntilExpiration = expirationDate ?
        Math.floor((expirationDate - now) / (1000 * 60 * 60 * 24)) : null;

      return {
        authenticated: true,
        expired: daysUntilExpiration !== null && daysUntilExpiration < 7,
        expirationDate,
        daysUntilExpiration,
      };
    } catch (err) {
      // If command fails, assume not authenticated
      return {
        authenticated: false,
        expired: false,
        error: err.message,
      };
    }
  }

  /**
   * Validate SOQL query syntax
   */
  validateSOQLQuery(query) {
    // Basic SOQL syntax validation
    const trimmed = query.trim();

    // Must start with SELECT
    if (!trimmed.match(/^SELECT\s+/i)) {
      return {
        valid: false,
        error: 'SOQL query must start with SELECT',
      };
    }

    // Must have FROM clause
    if (!trimmed.match(/\s+FROM\s+/i)) {
      return {
        valid: false,
        error: 'SOQL query must include FROM clause',
      };
    }

    // Check for common errors
    if (trimmed.match(/SELECT\s+\*/i)) {
      return {
        valid: false,
        error: 'SELECT * is not allowed in SOQL. Specify fields explicitly.',
      };
    }

    // Check balanced parentheses
    const openParens = (trimmed.match(/\(/g) || []).length;
    const closeParens = (trimmed.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      return {
        valid: false,
        error: 'Unbalanced parentheses in query',
      };
    }

    return {
      valid: true,
    };
  }

  /**
   * Check available disk space
   */
  async checkDiskSpace() {
    try {
      if (process.platform === 'win32') {
        const { stdout } = await exec('wmic logicaldisk get size,freespace,caption');
        const lines = stdout.trim().split('\n');
        // Parse C: drive
        const cDrive = lines.find(line => line.includes('C:'));
        if (cDrive) {
          const match = cDrive.match(/(\d+)\s+(\d+)/);
          if (match) {
            return {
              available: parseInt(match[1]),
              total: parseInt(match[2]),
            };
          }
        }
      } else {
        const { stdout } = await exec('df -k .');
        const lines = stdout.trim().split('\n');
        if (lines.length > 1) {
          const parts = lines[1].trim().split(/\s+/);
          return {
            available: parseInt(parts[3]) * 1024, // Convert KB to bytes
            total: parseInt(parts[1]) * 1024,
          };
        }
      }
    } catch (err) {
      // If disk space check fails, return default
    }

    return {
      available: 10 * 1024 * 1024 * 1024, // Assume 10 GB
      total: 100 * 1024 * 1024 * 1024,
    };
  }

  /**
   * Compare semantic versions
   */
  compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;

      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }

    return 0;
  }

  /**
   * Generate validation report
   */
  generateValidationReport(validation) {
    const lines = [];

    if (validation.valid) {
      lines.push('✅ Validation passed');
    } else {
      lines.push('❌ Validation failed');
    }

    if (validation.errors.length > 0) {
      lines.push('\nErrors:');
      validation.errors.forEach((error, index) => {
        lines.push(`  ${index + 1}. [${error.field}] ${error.message}`);
        if (error.suggestion) {
          lines.push(`     💡 ${error.suggestion}`);
        }
      });
    }

    if (validation.warnings.length > 0) {
      lines.push('\nWarnings:');
      validation.warnings.forEach((warning, index) => {
        lines.push(`  ${index + 1}. [${warning.field}] ${warning.message}`);
        if (warning.suggestion) {
          lines.push(`     💡 ${warning.suggestion}`);
        }
      });
    }

    return lines.join('\n');
  }
}

module.exports = new CommandValidator();
