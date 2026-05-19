/**
 * Enhanced CLI Result Parser
 * Parses raw CLI output into structured, analyzable data
 * Supports both Vlocity CLI and Salesforce CLI
 */

class CLIResultParser {
  /**
   * Parse Vlocity CLI export output into structured result
   * @param {string} stdout - Raw stdout from CLI
   * @param {string} stderr - Raw stderr from CLI
   * @param {number} exitCode - Process exit code
   * @param {number} executionTimeMs - Execution time in milliseconds
   * @returns {Object} Structured result
   */
  parseVlocityExport(stdout, stderr, exitCode, executionTimeMs) {
    const result = {
      success: exitCode === 0,
      exitCode,
      executionTimeMs,
      summary: {
        totalPacks: 0,
        exportedPacks: 0,
        failedPacks: 0,
        skippedPacks: 0,
        totalRecords: 0,
        exportedRecords: 0,
      },
      packsByType: {},
      errors: [],
      warnings: [],
      performance: {
        averagePackTime: 0,
        slowestPack: null,
        fastestPack: null,
      },
      metadata: {
        timestamp: new Date().toISOString(),
        cliType: 'vlocity',
        operation: 'export',
      },
    };

    if (!stdout) {
      result.errors.push({
        type: 'NoOutput',
        message: 'CLI command produced no output',
        severity: 'error',
        recoverable: false,
      });
      return result;
    }

    const lines = stdout.split('\n');

    // Extract pack export information with detailed parsing
    const packRegex = /Exported:\s+(\w+)\/([^\/]+)(?:\s+\((\d+)\s+records?\))?/i;
    const errorRegex = /Error:\s+(.+)|Failed:\s+(.+)|Exception:\s+(.+)/i;
    const warningRegex = /Warning:\s+(.+)|Deprecated:\s+(.+)/i;
    const performanceRegex = /(\w+\/[^\s]+)\s+completed in\s+([\d.]+)\s*s/i;
    const summaryRegex = /Successfully exported (\d+) of (\d+) DataPacks/i;

    const packTimes = [];

    lines.forEach((line, index) => {
      // Parse pack exports
      const packMatch = line.match(packRegex);
      if (packMatch) {
        const [, type, name, recordCount] = packMatch;
        result.summary.exportedPacks++;

        if (!result.packsByType[type]) {
          result.packsByType[type] = {
            count: 0,
            records: 0,
            packs: [],
          };
        }

        const records = parseInt(recordCount) || 0;
        result.packsByType[type].count++;
        result.packsByType[type].records += records;
        result.packsByType[type].packs.push({
          name,
          records,
          lineNumber: index + 1,
        });

        result.summary.exportedRecords += records;
      }

      // Parse performance metrics
      const perfMatch = line.match(performanceRegex);
      if (perfMatch) {
        const [, packName, timeSeconds] = perfMatch;
        const timeMs = parseFloat(timeSeconds) * 1000;
        packTimes.push({ pack: packName, timeMs });
      }

      // Parse errors with context
      const errorMatch = line.match(errorRegex);
      if (errorMatch) {
        const errorMessage = errorMatch[1] || errorMatch[2] || errorMatch[3];
        result.errors.push({
          type: this.categorizeError(errorMessage),
          message: errorMessage.trim(),
          line: index + 1,
          severity: 'error',
          recoverable: this.isRecoverableError(errorMessage),
          context: this.extractErrorContext(lines, index),
        });
        result.summary.failedPacks++;
      }

      // Parse warnings
      const warningMatch = line.match(warningRegex);
      if (warningMatch) {
        const warningMessage = warningMatch[1] || warningMatch[2];
        result.warnings.push({
          message: warningMessage.trim(),
          line: index + 1,
          severity: 'warning',
        });
      }

      // Parse summary line
      const summaryMatch = line.match(summaryRegex);
      if (summaryMatch) {
        result.summary.exportedPacks = parseInt(summaryMatch[1]);
        result.summary.totalPacks = parseInt(summaryMatch[2]);
        result.summary.failedPacks = result.summary.totalPacks - result.summary.exportedPacks;
      }
    });

    // Calculate performance metrics
    if (packTimes.length > 0) {
      const totalTime = packTimes.reduce((sum, p) => sum + p.timeMs, 0);
      result.performance.averagePackTime = totalTime / packTimes.length;

      const sorted = packTimes.sort((a, b) => b.timeMs - a.timeMs);
      result.performance.slowestPack = sorted[0];
      result.performance.fastestPack = sorted[sorted.length - 1];
    }

    // Parse stderr for additional errors
    if (stderr && stderr.trim()) {
      const stderrLines = stderr.split('\n').filter(line => {
        // Filter out noise
        return !line.includes('DeprecationWarning') &&
               !line.includes('punycode') &&
               line.trim().length > 0;
      });

      stderrLines.forEach((line, index) => {
        if (!result.errors.find(e => e.message === line.trim())) {
          result.errors.push({
            type: 'StdErr',
            message: line.trim(),
            line: index + 1,
            severity: 'error',
            recoverable: false,
            source: 'stderr',
          });
        }
      });
    }

    // Validate success
    if (exitCode === 0 && result.errors.length > 0) {
      result.success = false; // Had errors despite exit code 0
    }

    return result;
  }

  /**
   * Parse Vlocity CLI deploy output into structured result
   */
  parseVlocityDeploy(stdout, stderr, exitCode, executionTimeMs) {
    const result = {
      success: exitCode === 0,
      exitCode,
      executionTimeMs,
      summary: {
        totalPacks: 0,
        deployedPacks: 0,
        failedPacks: 0,
        skippedPacks: 0,
        totalRecords: 0,
        deployedRecords: 0,
      },
      packsByType: {},
      errors: [],
      warnings: [],
      settingsMismatches: [],
      duplicates: [],
      orphanedReferences: [],
      performance: {
        averagePackTime: 0,
        slowestPack: null,
        fastestPack: null,
      },
      metadata: {
        timestamp: new Date().toISOString(),
        cliType: 'vlocity',
        operation: 'deploy',
      },
    };

    if (!stdout) {
      result.errors.push({
        type: 'NoOutput',
        message: 'CLI command produced no output',
        severity: 'error',
        recoverable: false,
      });
      return result;
    }

    const lines = stdout.split('\n');

    // Deploy-specific patterns
    const deployRegex = /Deployed:\s+(\w+)\/([^\/]+)(?:\s+\((\d+)\s+records?\))?/i;
    const settingsMismatchRegex = /Settings?\s+mismatch.+?(\w+)/i;
    const duplicateRegex = /Duplicate.+?field.+?(\w+)/i;
    const orphanedRegex = /Orphaned.+?reference.+?(\w+)/i;
    const errorRegex = /Error:\s+(.+)|Failed:\s+(.+)|Exception:\s+(.+)/i;
    const warningRegex = /Warning:\s+(.+)/i;

    lines.forEach((line, index) => {
      // Parse deploys
      const deployMatch = line.match(deployRegex);
      if (deployMatch) {
        const [, type, name, recordCount] = deployMatch;
        result.summary.deployedPacks++;

        if (!result.packsByType[type]) {
          result.packsByType[type] = {
            count: 0,
            records: 0,
            packs: [],
          };
        }

        const records = parseInt(recordCount) || 0;
        result.packsByType[type].count++;
        result.packsByType[type].records += records;
        result.packsByType[type].packs.push({
          name,
          records,
          lineNumber: index + 1,
        });

        result.summary.deployedRecords += records;
      }

      // Parse settings mismatches
      const settingsMatch = line.match(settingsMismatchRegex);
      if (settingsMatch) {
        result.settingsMismatches.push({
          setting: settingsMatch[1],
          line: index + 1,
          message: line.trim(),
        });
      }

      // Parse duplicates
      const duplicateMatch = line.match(duplicateRegex);
      if (duplicateMatch) {
        result.duplicates.push({
          field: duplicateMatch[1],
          line: index + 1,
          message: line.trim(),
        });
      }

      // Parse orphaned references
      const orphanedMatch = line.match(orphanedRegex);
      if (orphanedMatch) {
        result.orphanedReferences.push({
          reference: orphanedMatch[1],
          line: index + 1,
          message: line.trim(),
        });
      }

      // Parse errors
      const errorMatch = line.match(errorRegex);
      if (errorMatch) {
        const errorMessage = errorMatch[1] || errorMatch[2] || errorMatch[3];
        result.errors.push({
          type: this.categorizeError(errorMessage),
          message: errorMessage.trim(),
          line: index + 1,
          severity: 'error',
          recoverable: this.isRecoverableError(errorMessage),
          context: this.extractErrorContext(lines, index),
        });
        result.summary.failedPacks++;
      }

      // Parse warnings
      const warningMatch = line.match(warningRegex);
      if (warningMatch) {
        result.warnings.push({
          message: warningMatch[1].trim(),
          line: index + 1,
          severity: 'warning',
        });
      }
    });

    // Parse stderr
    if (stderr && stderr.trim()) {
      const stderrLines = stderr.split('\n').filter(line => {
        return !line.includes('DeprecationWarning') &&
               !line.includes('punycode') &&
               line.trim().length > 0;
      });

      stderrLines.forEach((line, index) => {
        if (!result.errors.find(e => e.message === line.trim())) {
          result.errors.push({
            type: 'StdErr',
            message: line.trim(),
            line: index + 1,
            severity: 'error',
            recoverable: false,
            source: 'stderr',
          });
        }
      });
    }

    // Validate success
    if (exitCode === 0 && result.errors.length > 0) {
      result.success = false;
    }

    return result;
  }

  /**
   * Parse Salesforce CLI output into structured result
   */
  parseSalesforceCLI(stdout, stderr, exitCode, executionTimeMs, operation) {
    const result = {
      success: exitCode === 0,
      exitCode,
      executionTimeMs,
      summary: {
        totalRecords: 0,
        processedRecords: 0,
        failedRecords: 0,
        batches: 0,
        successfulBatches: 0,
        failedBatches: 0,
      },
      errors: [],
      warnings: [],
      metadata: {
        timestamp: new Date().toISOString(),
        cliType: 'salesforce',
        operation,
      },
    };

    // Try parsing as JSON first (SF CLI returns JSON for many commands)
    try {
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const jsonResult = JSON.parse(jsonMatch[0]);

        if (jsonResult.status === 0 || jsonResult.result) {
          result.success = true;
          result.summary.totalRecords = jsonResult.result?.totalSize || 0;
          result.summary.processedRecords = jsonResult.result?.records?.length || 0;
        } else if (jsonResult.status === 1 || jsonResult.error) {
          result.success = false;
          result.errors.push({
            type: jsonResult.errorCode || jsonResult.name || 'SFCLIError',
            message: jsonResult.message || jsonResult.error,
            severity: 'error',
            recoverable: false,
          });
        }
      }
    } catch (err) {
      // Not JSON, parse as text
      const lines = stdout.split('\n');

      lines.forEach((line, index) => {
        if (line.includes('ERROR') || line.includes('Error')) {
          result.errors.push({
            type: this.categorizeError(line),
            message: line.trim(),
            line: index + 1,
            severity: 'error',
            recoverable: this.isRecoverableError(line),
          });
        }

        if (line.includes('WARNING') || line.includes('Warning')) {
          result.warnings.push({
            message: line.trim(),
            line: index + 1,
            severity: 'warning',
          });
        }

        // Extract record counts
        const recordMatch = line.match(/(\d+)\s+records?/i);
        if (recordMatch) {
          result.summary.processedRecords = parseInt(recordMatch[1]);
        }
      });
    }

    // Parse stderr
    if (stderr && stderr.trim()) {
      result.errors.push({
        type: 'StdErr',
        message: stderr.trim(),
        severity: 'error',
        recoverable: false,
        source: 'stderr',
      });
    }

    return result;
  }

  /**
   * Categorize error based on message content
   */
  categorizeError(message) {
    const msg = message.toLowerCase();

    if (msg.includes('timeout') || msg.includes('timed out')) return 'Timeout';
    if (msg.includes('rate limit') || msg.includes('too many requests')) return 'RateLimit';
    if (msg.includes('quota') || msg.includes('exceeded')) return 'QuotaExceeded';
    if (msg.includes('auth') || msg.includes('login') || msg.includes('credential')) return 'Authentication';
    if (msg.includes('permission') || msg.includes('access denied')) return 'Permission';
    if (msg.includes('network') || msg.includes('connection') || msg.includes('econnrefused')) return 'Network';
    if (msg.includes('duplicate')) return 'Duplicate';
    if (msg.includes('not found') || msg.includes('missing')) return 'NotFound';
    if (msg.includes('settings') && msg.includes('mismatch')) return 'SettingsMismatch';
    if (msg.includes('validation')) return 'Validation';
    if (msg.includes('orphaned')) return 'OrphanedReference';
    if (msg.includes('syntax') || msg.includes('parse')) return 'Syntax';
    if (msg.includes('memory') || msg.includes('heap')) return 'OutOfMemory';

    return 'Unknown';
  }

  /**
   * Determine if error is recoverable
   */
  isRecoverableError(message) {
    const type = this.categorizeError(message);
    const recoverableTypes = [
      'Timeout',
      'RateLimit',
      'Network',
      'SettingsMismatch',
      'OrphanedReference',
      'NotFound',
    ];

    return recoverableTypes.includes(type);
  }

  /**
   * Extract context around an error line
   */
  extractErrorContext(lines, errorIndex, contextLines = 2) {
    const start = Math.max(0, errorIndex - contextLines);
    const end = Math.min(lines.length, errorIndex + contextLines + 1);

    return lines.slice(start, end).map((line, idx) => ({
      line: start + idx + 1,
      content: line,
      isError: start + idx === errorIndex,
    }));
  }

  /**
   * Generate human-readable summary from structured result
   */
  generateSummary(result) {
    const lines = [];

    if (result.metadata.operation === 'export') {
      lines.push(`✓ Exported ${result.summary.exportedPacks}/${result.summary.totalPacks} DataPacks`);
      lines.push(`  └─ ${result.summary.exportedRecords} total records`);
    } else if (result.metadata.operation === 'deploy') {
      lines.push(`✓ Deployed ${result.summary.deployedPacks}/${result.summary.totalPacks} DataPacks`);
      lines.push(`  └─ ${result.summary.deployedRecords} total records`);
    }

    if (Object.keys(result.packsByType || {}).length > 0) {
      lines.push('\nDataPacks by Type:');
      Object.entries(result.packsByType).forEach(([type, data]) => {
        lines.push(`  • ${type}: ${data.count} packs (${data.records} records)`);
      });
    }

    if (result.errors.length > 0) {
      lines.push(`\n✗ ${result.errors.length} error(s):`);
      result.errors.slice(0, 5).forEach(err => {
        lines.push(`  • [${err.type}] ${err.message.substring(0, 80)}`);
      });
      if (result.errors.length > 5) {
        lines.push(`  ... and ${result.errors.length - 5} more`);
      }
    }

    if (result.warnings.length > 0) {
      lines.push(`\n⚠ ${result.warnings.length} warning(s)`);
    }

    if (result.performance && result.performance.slowestPack) {
      lines.push(`\n⏱ Performance:`);
      lines.push(`  • Average: ${Math.round(result.performance.averagePackTime)}ms per pack`);
      lines.push(`  • Slowest: ${result.performance.slowestPack.pack} (${Math.round(result.performance.slowestPack.timeMs)}ms)`);
    }

    lines.push(`\n✓ Completed in ${(result.executionTimeMs / 1000).toFixed(2)}s`);

    return lines.join('\n');
  }
}

module.exports = new CLIResultParser();
