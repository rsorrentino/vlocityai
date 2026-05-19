const logger = require('../utils/logger');

// Definitive list of valid standalone DataPack types
const STANDALONE_DATAPACK_TYPES = new Set([
  'AttributeCategory', 'Catalog', 'CalculationMatrix', 'CalculationMatrixVersion',
  'CalculationProcedure', 'CalculationProcedureVersion', 'ContextDimension', 'ContextScope',
  'ContractType', 'DataRaptor', 'DocumentClause', 'DocumentTemplate', 'DocumentTemplateSection',
  'EntityFilter', 'IntegrationProcedure', 'ItemImplementation', 'ManualQueue',
  'ObjectClass', 'ObjectLayout', 'ObjectContextRule', 'OmniScript',
  'OrchestrationItemDefinition', 'OrchestrationPlanDefinition',
  'Pricebook2', 'PriceList', 'PricingPlan', 'PricingVariable',
  'Product2', 'Promotion', 'QueryBuilder', 'Rule', 'StoryObjectConfiguration',
  'TimePolicy', 'UIFacet', 'UISection',
  'VlocityAction', 'VlocityAttachment', 'VlocityCard', 'VlocityFunction',
  'VlocityPicklist', 'VlocityStateModel', 'VlocityUILayout', 'VlocityUITemplate',
  'CpqConfigurationSetup', 'InterfaceImplementation', 'String',
  // SObject is valid as a generic query type in recovery jobs
  'SObject'
]);

// Sub-objects that are NOT standalone — exported automatically by their parent
const SUB_OBJECT_PARENT_MAP = {
  CatalogProductRelationship: 'Catalog',
  PriceListEntry: 'Product2',
  PricingElement: 'PriceList',
  ProductChildItem: 'Product2',
  AttributeAssignment: 'Product2'
};

// Known dependency relationships between standalone types
const KNOWN_DEPENDENCIES = {
  VlocityUILayout: ['VlocityCard'],
  VlocityCard: ['VlocityAction', 'VlocityUITemplate'],
  IntegrationProcedure: ['DataRaptor', 'VlocityUITemplate'],
  OmniScript: ['DataRaptor'],
  Catalog: ['Product2']
};

class PreflightService {
  /**
   * Run all preflight checks on a job configuration object.
   * @param {Object} jobConfig - Parsed job YAML / JSON object
   * @param {Object} [options]
   * @param {boolean} [options.checkOrgReachability=false] - Whether to test org connectivity
   * @returns {Promise<{passed: boolean, warnings: Object[], errors: Object[]}>}
   */
  async runPreflightChecks(jobConfig, options = {}) {
    const errors = [];
    const warnings = [];
    const passed = { org: null };

    const queries = jobConfig.queries || [];
    const typesInScope = new Set(
      queries
        .map(q => q.VlocityDataPackType)
        .filter(Boolean)
    );

    // Check 1 — Invalid standalone types (sub-objects used as top-level types)
    for (const query of queries) {
      const type = query.VlocityDataPackType;
      if (!type) continue;
      if (SUB_OBJECT_PARENT_MAP[type]) {
        errors.push({
          check: 'invalid_standalone_type',
          severity: 'error',
          type,
          message: `"${type}" is not a standalone DataPack type — it is exported automatically as a sub-object of ${SUB_OBJECT_PARENT_MAP[type]}. Remove this query to prevent "No DataPack Configuration Set" errors (~thousands per run).`
        });
      } else if (!STANDALONE_DATAPACK_TYPES.has(type)) {
        warnings.push({
          check: 'unknown_type',
          severity: 'warning',
          type,
          message: `"${type}" is not a recognized DataPack type. It may still work if it is a custom type, but verify it is supported.`
        });
      }
    }

    // Check 2 — Missing dependency coverage
    for (const [type, deps] of Object.entries(KNOWN_DEPENDENCIES)) {
      if (!typesInScope.has(type)) continue;
      for (const dep of deps) {
        if (!typesInScope.has(dep)) {
          warnings.push({
            check: 'missing_dependency_coverage',
            severity: 'warning',
            type,
            dependency: dep,
            message: `"${type}" is in scope but "${dep}" is not. Expect missing-reference errors for ${type} records that reference ${dep}.`
          });
        }
      }
    }

    // Check 3 — Apex heap risk
    const parallelism = jobConfig.defaultMaxParallel || 10;
    const heapRiskTypes = ['Product2', 'Catalog', 'Pricebook2'];
    const hasHeapRiskType = heapRiskTypes.some(t => typesInScope.has(t));
    if (hasHeapRiskType && parallelism > 10) {
      warnings.push({
        check: 'apex_heap_risk',
        severity: 'warning',
        message: `Exporting Product2/Catalog with defaultMaxParallel=${parallelism} risks Apex heap size limit errors. Consider reducing to 5–8.`
      });
    }

    // Check 4 — Org reachability (optional)
    if (options.checkOrgReachability && jobConfig.username) {
      try {
        const orgService = require('./orgService');
        const reachable = await orgService.testConnection(jobConfig.username);
        passed.org = reachable
          ? { check: 'org_reachability', severity: 'passed', message: `Org ${jobConfig.username} is reachable` }
          : null;
        if (!reachable) {
          errors.push({
            check: 'org_reachability',
            severity: 'error',
            message: `Cannot reach org "${jobConfig.username}". Verify authentication with: sf org list auth`
          });
        }
      } catch (err) {
        warnings.push({
          check: 'org_reachability',
          severity: 'warning',
          message: `Could not verify org reachability: ${err.message}`
        });
      }
    } else if (jobConfig.username) {
      passed.org = { check: 'org_reachability', severity: 'passed', message: `Org: ${jobConfig.username} (not tested)` };
    }

    const passing = errors.length === 0;
    logger.info('Preflight checks complete', {
      jobName: jobConfig.name,
      errors: errors.length,
      warnings: warnings.length,
      passed: passing
    });

    return { passed: passing, errors, warnings, passedChecks: passed };
  }
}

module.exports = new PreflightService();
