const fs = require('fs-extra');
const path = require('path');
const yaml = require('yaml');
const logger = require('../utils/logger');

const BUILD_LOG_FILENAME = 'VlocityBuildLog.yaml';
const ERROR_LOG_FILENAME = 'VlocityBuildErrors.log';
const YAML_PARSE_OPTIONS = {
  customTags: [
    {
      tag: 'tag:yaml.org,2002:js/undefined',
      resolve: () => null,
    },
  ],
};

// Remediation hints keyed by error message pattern
const REMEDIATION_MAP = [
  {
    pattern: /No Vlocity DataPack Configuration Set/i,
    category: 'No DataPack Configuration Set',
    remediation: 'These are sub-objects — remove standalone queries for these types from the job config. They are exported automatically via their parent type.'
  },
  {
    pattern: /references .+ which was not found/i,
    category: 'Missing Reference',
    remediation: 'Add the referenced DataPack types to the export scope, or accept that those references will be unresolved in the target org.'
  },
  {
    pattern: /JSON Parse Error|SyntaxError.*JSON|Unexpected token/i,
    category: 'JSON Parse Error',
    remediation: 'Fix malformed JSON in the source org metadata. Query the Salesforce object and manually correct the field value.'
  },
  {
    pattern: /Apex heap size exceeded|heap/i,
    category: 'Apex Heap Size Limit',
    remediation: 'Reduce defaultMaxParallel (try 5–8) or split the export by DataPack type category.'
  },
  {
    pattern: /DUPLICATE_DEVELOPER_NAME/i,
    category: 'Duplicate Developer Name',
    remediation: 'Record already exists in the target org with this Developer Name. This is informational — not a real failure.'
  },
  {
    pattern: /Data Not Retrieved|not retrieved/i,
    category: 'Data Not Retrieved',
    remediation: 'The record could not be retrieved. Check Salesforce permissions and re-run the export.'
  },
  // Deploy-specific patterns
  {
    pattern: /No Matching Record|no matching record/i,
    category: 'No Matching Record',
    remediation: 'The target org is missing a parent record required by this DataPack. Deploy the parent type first, or run a full dependency deploy.'
  },
  {
    pattern: /Missing Dependency|missing dependency/i,
    category: 'Missing Dependency',
    remediation: 'A referenced DataPack does not exist in the target org. Ensure all dependency types are included in the deploy scope.'
  },
  {
    pattern: /Permission.*Error|INSUFFICIENT_ACCESS|FIELD_INTEGRITY_EXCEPTION/i,
    category: 'Permission Error',
    remediation: 'The connected user lacks write access to this object. Grant the required CRUD permissions in the target org.'
  },
  {
    pattern: /Settings.*Mismatch|Setting.*mismatch/i,
    category: 'Settings Mismatch',
    remediation: 'Org-specific settings differ between source and target. Review custom settings/metadata before redeploying.'
  }
];

/**
 * Parse the VlocityBuildLog.yaml and VlocityBuildErrors.log files into a
 * structured analysis object suitable for the BuildLogAnalyzer UI component.
 *
 * All methods accept optional explicit file paths — if omitted the files are
 * read from process.cwd() (where the Vlocity CLI writes them by default).
 */
class BuildLogParser {
  constructor() {
    this.defaultBuildLogPath = path.join(process.cwd(), BUILD_LOG_FILENAME);
    this.defaultErrorLogPath = path.join(process.cwd(), ERROR_LOG_FILENAME);
  }

  /**
   * Produce a full structured analysis from the two log files.
   * @param {string} [buildLogPath] - Override path to VlocityBuildLog.yaml
   * @param {string} [errorLogPath] - Override path to VlocityBuildErrors.log
   * @returns {Promise<Object>} Structured analysis
   */
  async analyze(buildLogPath = null, errorLogPath = null) {
    const blPath = buildLogPath || this.defaultBuildLogPath;
    const elPath = errorLogPath || this.defaultErrorLogPath;

    const [buildLog, errorLines] = await Promise.all([
      this._readBuildLog(blPath),
      this._readErrorLog(elPath)
    ]);

    const summary = this._buildSummary(buildLog);
    const byType = this._buildByType(buildLog);
    const { errorCategories, missingReferences } = this._categorizeErrors(errorLines, buildLog);

    return { summary, byType, errorCategories, missingReferences };
  }

  /**
   * Read and parse VlocityBuildLog.yaml — returns raw parsed object or null.
   */
  async _readBuildLog(filePath) {
    try {
      if (!await fs.pathExists(filePath)) return null;
      const content = await fs.readFile(filePath, 'utf8');
      return yaml.parse(content, YAML_PARSE_OPTIONS);
    } catch (err) {
      logger.warn('Could not parse VlocityBuildLog.yaml', { path: filePath, error: err.message });
      return null;
    }
  }

  /**
   * Read VlocityBuildErrors.log — returns array of trimmed non-empty lines.
   */
  async _readErrorLog(filePath) {
    try {
      if (!await fs.pathExists(filePath)) return [];
      const content = await fs.readFile(filePath, 'utf8');
      return content.split('\n').map(l => l.trim()).filter(Boolean);
    } catch (err) {
      logger.warn('Could not read VlocityBuildErrors.log', { path: filePath, error: err.message });
      return [];
    }
  }

  /**
   * Sum all values in a plain object (type -> number) or return 0.
   */
  _sumObj(obj) {
    if (!obj || typeof obj !== 'object') return 0;
    return Object.values(obj).reduce((s, v) => s + (parseInt(v) || 0), 0);
  }

  /**
   * Build the top-level summary block.
   */
  _buildSummary(buildLog) {
    if (!buildLog) {
      return { success: 0, error: 0, remaining: 0, ignored: 0, total: 0, successRate: 0, duration: null, org: null, version: null };
    }

    const counts = buildLog.Count || {};
    const success = this._sumObj(counts.Success);
    const error = this._sumObj(counts.Error);
    const remaining = this._sumObj(counts.Remaining);
    const ignored = this._sumObj(counts.Ignored);
    const total = success + error + remaining;
    const successRate = total > 0 ? parseFloat(((success / total) * 100).toFixed(1)) : 0;

    return {
      success,
      error,
      remaining,
      ignored,
      total,
      successRate,
      duration: buildLog.TotalTime || null,
      org: buildLog.Org || null,
      version: buildLog.Version || null,
      packageVersion: buildLog.PackageVersion || null,
      namespace: buildLog.Namespace || null,
      action: buildLog.Action || null,
      projectPath: buildLog.ProjectPath || null
    };
  }

  /**
   * Build the per-DataPack-type breakdown array.
   */
  _buildByType(buildLog) {
    if (!buildLog) return [];

    const counts = buildLog.Count || {};
    const successMap = counts.Success || {};
    const errorMap = counts.Error || {};
    const remainingMap = counts.Remaining || {};
    const ignoredMap = counts.Ignored || {};

    // Collect all type names across all status buckets
    const types = new Set([
      ...Object.keys(successMap),
      ...Object.keys(errorMap),
      ...Object.keys(remainingMap),
      ...Object.keys(ignoredMap)
    ]);

    return Array.from(types).map(type => {
      const success = parseInt(successMap[type]) || 0;
      const error = parseInt(errorMap[type]) || 0;
      const remaining = parseInt(remainingMap[type]) || 0;
      const ignored = parseInt(ignoredMap[type]) || 0;

      let status;
      if (error === 0 && remaining === 0) {
        status = 'complete';
      } else if (success === 0 && error > 0 && remaining === 0) {
        status = 'blocked';
      } else if (remaining > 0) {
        status = 'remaining';
      } else {
        status = 'partial';
      }

      return { type, success, error, remaining, ignored, status };
    }).sort((a, b) => {
      // Sort: complete first, then partial, then remaining, then blocked
      const order = { complete: 0, partial: 1, remaining: 2, blocked: 3 };
      return (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.type.localeCompare(b.type);
    });
  }

  /**
   * Parse error lines and aggregate into categories + missing references.
   */
  _categorizeErrors(errorLines, buildLog) {
    const categoryMap = new Map(); // category label -> { count, types: Set, examples: [] }
    const missingReferences = [];

    // Also pull from the structured Errors array in VlocityBuildLog.yaml
    const structuredErrors = [];
    if (buildLog?.Errors && Array.isArray(buildLog.Errors)) {
      structuredErrors.push(...buildLog.Errors.map(e => (typeof e === 'string' ? e : String(e))));
    }

    const allLines = [...structuredErrors, ...errorLines];

    for (const line of allLines) {
      // Detect missing references (cross-type dependencies)
      const refMatch = line.match(/^(.+?)\s+references\s+(.+?)\s+which\s+was\s+not\s+found/i);
      if (refMatch) {
        // source may be multiple items separated by " and "
        const sources = refMatch[1].split(' and ').map(s => s.trim());
        const referenced = refMatch[2].trim();
        const slashIdx = referenced.indexOf('/');
        const referencedType = slashIdx !== -1 ? referenced.slice(0, slashIdx) : referenced;
        const referencedName = slashIdx !== -1 ? referenced.slice(slashIdx + 1) : referenced;

        for (const source of sources) {
          missingReferences.push({ source, referencedType, referencedName });
        }
      }

      // Match against known remediation patterns
      let matched = false;
      for (const { pattern, category, remediation } of REMEDIATION_MAP) {
        if (pattern.test(line)) {
          // Extract DataPack type from line prefix (e.g. "CatalogProductRelationship --- ...")
          const typeMatch = line.match(/^([A-Za-z0-9_]+)\s*---/);
          const typeName = typeMatch ? typeMatch[1] : null;

          if (!categoryMap.has(category)) {
            categoryMap.set(category, { count: 0, types: new Set(), examples: [], remediation });
          }
          const entry = categoryMap.get(category);
          entry.count++;
          if (typeName) entry.types.add(typeName);
          if (entry.examples.length < 3) entry.examples.push(line.slice(0, 200));

          matched = true;
          break;
        }
      }

      if (!matched && line.length > 0) {
        const category = 'Other';
        if (!categoryMap.has(category)) {
          categoryMap.set(category, { count: 0, types: new Set(), examples: [], remediation: 'Review the raw log for details.' });
        }
        const entry = categoryMap.get(category);
        entry.count++;
        if (entry.examples.length < 3) entry.examples.push(line.slice(0, 200));
      }
    }

    const errorCategories = Array.from(categoryMap.entries())
      .map(([category, data]) => ({
        category,
        count: data.count,
        types: Array.from(data.types),
        examples: data.examples,
        remediation: data.remediation
      }))
      .sort((a, b) => b.count - a.count);

    return { errorCategories, missingReferences };
  }

  /**
   * Convenience: parse just the build log counts (used by exportRecoveryService).
   * Returns the same shape as the old errorLogParser.parseVlocityBuildLog().
   */
  async parseBuildLogCounts(buildLogPath = null) {
    const blPath = buildLogPath || this.defaultBuildLogPath;
    const buildLog = await this._readBuildLog(blPath);
    if (!buildLog) return null;

    const summary = this._buildSummary(buildLog);
    return {
      totalRecords: summary.total,
      successCount: summary.success,
      errorCount: summary.error,
      remainingCount: summary.remaining,
      warningCount: 0,
      hasErrors: summary.error > 0 || summary.remaining > 0,
      hasWarnings: false,
      buildLog
    };
  }

  /**
   * Copy current build artifacts (VlocityBuildLog.yaml + VlocityBuildErrors.log)
   * to a per-job storage directory so they are not overwritten by the next run.
   * @param {string} jobId - Job ID used to name the output files
   * @param {string} logsDir - Destination directory (e.g. logs/jobs)
   * @returns {Promise<{buildLogDest: string|null, errorLogDest: string|null}>}
   */
  async preserveJobArtifacts(jobId, logsDir) {
    const results = { buildLogDest: null, errorLogDest: null };
    try {
      await fs.ensureDir(logsDir);

      const buildLogSrc = this.defaultBuildLogPath;
      const errorLogSrc = this.defaultErrorLogPath;

      if (await fs.pathExists(buildLogSrc)) {
        const dest = path.join(logsDir, `${jobId}-build-log.yaml`);
        await fs.copyFile(buildLogSrc, dest);
        results.buildLogDest = dest;
        logger.info('Build log preserved', { jobId, dest });
      }

      if (await fs.pathExists(errorLogSrc)) {
        const dest = path.join(logsDir, `${jobId}-build-errors.log`);
        await fs.copyFile(errorLogSrc, dest);
        results.errorLogDest = dest;
        logger.info('Error log preserved', { jobId, dest });
      }
    } catch (err) {
      logger.warn('Could not preserve job artifacts', { jobId, error: err.message });
    }
    return results;
  }
}

module.exports = new BuildLogParser();
