const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');

// Expected standalone DataPack types for coverage check
const EXPECTED_STANDALONE_TYPES = [
  'AttributeCategory', 'Catalog', 'CalculationMatrix', 'CalculationProcedure',
  'ContextDimension', 'ContextScope', 'DataRaptor', 'EntityFilter', 'IntegrationProcedure',
  'ItemImplementation', 'ManualQueue', 'ObjectClass', 'ObjectLayout', 'OmniScript',
  'OrchestrationItemDefinition', 'OrchestrationPlanDefinition', 'Pricebook2', 'PriceList',
  'PricingPlan', 'PricingVariable', 'Product2', 'Promotion', 'Rule', 'StoryObjectConfiguration',
  'TimePolicy', 'UIFacet', 'UISection', 'VlocityAction', 'VlocityCard', 'VlocityFunction',
  'VlocityPicklist', 'VlocityStateModel', 'VlocityUILayout', 'VlocityUITemplate',
  'QueryBuilder', 'CpqConfigurationSetup', 'InterfaceImplementation',
  'ObjectContextRule', 'VlocityAttachment', 'String'
];

class ExportHealthService {
  /**
   * Analyze the export directory and produce a health report.
   * @param {string} exportPath - Path to the export directory
   * @param {Object} [buildAnalysis] - Optional pre-computed build analysis from buildLogParser
   * @returns {Promise<Object>} Health report
   */
  async analyzeExportDirectory(exportPath, buildAnalysis = null) {
    const resolvedPath = path.resolve(exportPath);

    if (!await fs.pathExists(resolvedPath)) {
      return this._emptyReport(resolvedPath, 'Export directory not found');
    }

    const stat = await fs.stat(resolvedPath);
    if (!stat.isDirectory()) {
      return this._emptyReport(resolvedPath, 'Path is not a directory');
    }

    logger.info('Scanning export directory', { path: resolvedPath });

    // Scan subdirectories (each = a DataPack type)
    const coverage = await this._scanCoverage(resolvedPath);
    const crossRefIssues = await this._scanCrossReferences(resolvedPath, coverage);

    const exportedTypes = coverage.filter(c => c.count > 0).map(c => c.type);
    const missingTypes = EXPECTED_STANDALONE_TYPES.filter(t => !exportedTypes.includes(t));

    // Compute health score
    const coveredPct = exportedTypes.length / Math.max(EXPECTED_STANDALONE_TYPES.length, 1);
    const crossRefPct = crossRefIssues.length === 0 ? 1
      : 1 - Math.min(1, crossRefIssues.length / 500);

    let successRate = 100;
    if (buildAnalysis?.summary) {
      successRate = buildAnalysis.summary.successRate || 0;
    }

    const healthScore = Math.round(
      (successRate / 100) * 0.5 * 100 +
      coveredPct * 0.3 * 100 +
      crossRefPct * 0.2 * 100
    );

    let deployability;
    if (healthScore >= 80 && crossRefIssues.length < 10) {
      deployability = 'deployable';
    } else if (healthScore >= 50) {
      deployability = 'caution';
    } else {
      deployability = 'not_ready';
    }

    return {
      exportPath: resolvedPath,
      scannedAt: new Date().toISOString(),
      healthScore,
      deployability,
      summary: {
        exportedTypes: exportedTypes.length,
        expectedTypes: EXPECTED_STANDALONE_TYPES.length,
        missingTypes: missingTypes.length,
        crossRefIssues: crossRefIssues.length,
        totalRecords: coverage.reduce((s, c) => s + c.count, 0)
      },
      coverage,
      missingTypes,
      crossRefIssues: crossRefIssues.slice(0, 500) // cap for response size
    };
  }

  /**
   * Scan subdirectories and count DataPack files per type.
   */
  async _scanCoverage(exportPath) {
    const coverage = [];
    try {
      const entries = await fs.readdir(exportPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const typePath = path.join(exportPath, entry.name);
        let count = 0;
        try {
          const files = await fs.readdir(typePath, { withFileTypes: true });
          // Count record-level subdirectories (each record = a folder)
          for (const f of files) {
            if (f.isDirectory()) count++;
          }
        } catch (_) { /* skip unreadable dirs */ }

        const isExpected = EXPECTED_STANDALONE_TYPES.includes(entry.name);
        coverage.push({
          type: entry.name,
          count,
          isExpectedType: isExpected,
          status: count > 0 ? 'present' : 'empty'
        });
      }

      // Add expected types that have no folder at all
      const foundTypes = new Set(coverage.map(c => c.type));
      for (const t of EXPECTED_STANDALONE_TYPES) {
        if (!foundTypes.has(t)) {
          coverage.push({ type: t, count: 0, isExpectedType: true, status: 'missing' });
        }
      }
    } catch (err) {
      logger.warn('Error scanning export directory', { exportPath, error: err.message });
    }

    return coverage.sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.type.localeCompare(b.type);
    });
  }

  /**
   * Scan DataPack JSON files for broken cross-references.
   * Checks that referenced GlobalKey folders exist in the export.
   * Samples up to 200 files per type to keep scan time reasonable.
   */
  async _scanCrossReferences(exportPath, coverage) {
    const issues = [];
    const presentTypes = new Set(coverage.filter(c => c.count > 0).map(c => c.type));

    // Pattern: "%vlocity_namespace%__GlobalKey__c": "SomeType/SomeName"
    const globalKeyPattern = /"vlocity_cmt__GlobalKey__c"\s*:\s*"([^"]+\/[^"]+)"/g;

    for (const { type, count } of coverage) {
      if (count === 0) continue;
      const typePath = path.join(exportPath, type);
      let scanned = 0;

      try {
        const records = await fs.readdir(typePath, { withFileTypes: true });
        for (const record of records) {
          if (!record.isDirectory() || scanned >= 200) break;
          scanned++;

          const recordPath = path.join(typePath, record.name);
          // Find *_DataPack.json in this record folder
          try {
            const files = await fs.readdir(recordPath);
            const dataPackFile = files.find(f => f.endsWith('_DataPack.json'));
            if (!dataPackFile) continue;

            const content = await fs.readFile(path.join(recordPath, dataPackFile), 'utf8');
            let match;
            globalKeyPattern.lastIndex = 0;
            while ((match = globalKeyPattern.exec(content)) !== null) {
              const ref = match[1]; // e.g. "VlocityCard/My Card"
              const slashIdx = ref.indexOf('/');
              if (slashIdx === -1) continue;
              const refType = ref.slice(0, slashIdx);
              const refName = ref.slice(slashIdx + 1);

              if (!presentTypes.has(refType)) {
                issues.push({
                  source: `${type}/${record.name}`,
                  referencedType: refType,
                  referencedName: refName,
                  severity: 'missing_type'
                });
              }
            }
          } catch (_) { /* skip unreadable files */ }
        }
      } catch (err) {
        logger.warn('Error scanning type directory', { typePath, error: err.message });
      }
    }

    return issues;
  }

  _emptyReport(exportPath, reason) {
    return {
      exportPath,
      scannedAt: new Date().toISOString(),
      healthScore: 0,
      deployability: 'not_ready',
      error: reason,
      summary: { exportedTypes: 0, expectedTypes: EXPECTED_STANDALONE_TYPES.length, missingTypes: EXPECTED_STANDALONE_TYPES.length, crossRefIssues: 0, totalRecords: 0 },
      coverage: [],
      missingTypes: [...EXPECTED_STANDALONE_TYPES],
      crossRefIssues: []
    };
  }
}

module.exports = new ExportHealthService();
