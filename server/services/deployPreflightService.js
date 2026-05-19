const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');
const { ValidationRuleEngine } = require('./validationRuleEngine');
const {
  missingGtObjectLayoutRule,
  invalidRecordTypeIdRule,
  pricingElementTriggerRule,
  inactiveCalculationProceduresRule,
} = require('../validators/deploymentValidators');

const _deployEngine = new ValidationRuleEngine()
  .registerRules([
    missingGtObjectLayoutRule,
    invalidRecordTypeIdRule,
    pricingElementTriggerRule,
    inactiveCalculationProceduresRule,
  ]);

// Reuse the same dependency map from preflightService
const KNOWN_DEPENDENCIES = {
  VlocityUILayout: ['VlocityCard'],
  VlocityCard: ['VlocityAction', 'VlocityUITemplate'],
  IntegrationProcedure: ['DataRaptor', 'VlocityUITemplate'],
  OmniScript: ['DataRaptor'],
  Catalog: ['Product2']
};

const HEAP_RISK_TYPES = ['Product2', 'Catalog', 'Pricebook2'];

class DeployPreflightService {
  /**
   * Run all preflight checks before starting a deploy job.
   * @param {Object} jobConfig - Deploy job configuration object
   * @param {Object} [options]
   * @param {boolean} [options.checkOrgReachability=false] - Whether to test org connectivity
   * @returns {Promise<{passed: boolean, errors: Object[], warnings: Object[], passedChecks: Object}>}
   */
  async runDeployPreflightChecks(jobConfig, options = {}) {
    const errors = [];
    const warnings = [];
    const passedChecks = {};

    const targetUsername = jobConfig.targetUsername || jobConfig.username;
    const sourceUsername = jobConfig.sourceUsername || jobConfig.username;
    const projectPath = jobConfig.projectPath;

    // Check 1 — Same-org deploy (blocking)
    if (sourceUsername && targetUsername && sourceUsername === targetUsername) {
      errors.push({
        check: 'same_org_deploy',
        severity: 'error',
        message: `Source and target org are the same (${targetUsername}). Deploying to the source org would overwrite your data. Set a different targetUsername.`
      });
    } else if (sourceUsername && targetUsername) {
      passedChecks.sameOrg = { check: 'same_org', severity: 'passed', message: `Source (${sourceUsername}) and target (${targetUsername}) orgs are different` };
    }

    // Check 2 — Export path exists (blocking)
    if (projectPath) {
      try {
        const resolvedPath = path.resolve(projectPath);
        const exists = await fs.pathExists(resolvedPath);
        if (!exists) {
          errors.push({
            check: 'export_path_missing',
            severity: 'error',
            message: `Export directory does not exist: "${projectPath}". Run an export first before deploying.`
          });
        } else {
          // Check 3 — Export directory not empty (blocking)
          const entries = await fs.readdir(resolvedPath);
          const subdirs = [];
          for (const entry of entries) {
            const stat = await fs.stat(path.join(resolvedPath, entry)).catch(() => null);
            if (stat && stat.isDirectory()) subdirs.push(entry);
          }

          if (subdirs.length === 0) {
            errors.push({
              check: 'export_directory_empty',
              severity: 'error',
              message: `Export directory "${projectPath}" is empty (no DataPack type folders found). Run a full export before deploying.`
            });
          } else {
            passedChecks.exportPath = {
              check: 'export_path',
              severity: 'passed',
              message: `Export directory contains ${subdirs.length} DataPack type folder(s)`
            };

            // Check 4 — Dependency coverage (warning)
            const typesInExport = new Set(subdirs);
            for (const [type, deps] of Object.entries(KNOWN_DEPENDENCIES)) {
              if (!typesInExport.has(type)) continue;
              for (const dep of deps) {
                if (!typesInExport.has(dep)) {
                  warnings.push({
                    check: 'missing_dependency_coverage',
                    severity: 'warning',
                    type,
                    dependency: dep,
                    message: `"${type}" is present in the export but "${dep}" is not. Expect missing-reference errors in the target org for ${type} records that reference ${dep}.`
                  });
                }
              }
            }

            if (warnings.filter(w => w.check === 'missing_dependency_coverage').length === 0) {
              passedChecks.dependencies = { check: 'dependencies', severity: 'passed', message: 'All known type dependencies are present in the export' };
            }

            // Check 5 — Apex heap risk (warning)
            const heapRiskPresent = HEAP_RISK_TYPES.some(t => typesInExport.has(t));
            const parallelism = jobConfig.defaultMaxParallel || 10;
            if (heapRiskPresent && parallelism > 10) {
              warnings.push({
                check: 'apex_heap_risk',
                severity: 'warning',
                message: `Deploying Product2/Catalog with defaultMaxParallel=${parallelism} risks Apex heap size limit errors. Consider reducing to 5–8.`
              });
            }
          }
        }
      } catch (err) {
        warnings.push({
          check: 'export_path_check',
          severity: 'warning',
          message: `Could not verify export directory: ${err.message}`
        });
      }
    }

    // Check 6 — Org reachability (optional, when requested)
    if (options.checkOrgReachability) {
      const orgService = require('./orgService');

      if (sourceUsername) {
        try {
          const reachable = await orgService.testConnection(sourceUsername);
          if (!reachable) {
            errors.push({
              check: 'source_org_reachability',
              severity: 'error',
              message: `Cannot reach source org "${sourceUsername}". Verify authentication.`
            });
          } else {
            passedChecks.sourceOrg = { check: 'source_org_reachability', severity: 'passed', message: `Source org ${sourceUsername} is reachable` };
          }
        } catch (err) {
          errors.push({
            check: 'source_org_reachability',
            severity: 'error',
            message: `Cannot reach source org "${sourceUsername}": ${err.message}`
          });
        }
      }

      if (targetUsername && targetUsername !== sourceUsername) {
        try {
          const reachable = await orgService.testConnection(targetUsername);
          if (!reachable) {
            errors.push({
              check: 'target_org_reachability',
              severity: 'error',
              message: `Cannot reach target org "${targetUsername}". Verify authentication.`
            });
          } else {
            passedChecks.targetOrg = { check: 'target_org_reachability', severity: 'passed', message: `Target org ${targetUsername} is reachable` };
          }
        } catch (err) {
          errors.push({
            check: 'target_org_reachability',
            severity: 'error',
            message: `Cannot reach target org "${targetUsername}": ${err.message}`
          });
        }
      }
    } else {
      if (sourceUsername) {
        passedChecks.sourceOrg = { check: 'source_org_reachability', severity: 'passed', message: `Source org: ${sourceUsername} (connectivity not tested)` };
      }
      if (targetUsername) {
        passedChecks.targetOrg = { check: 'target_org_reachability', severity: 'passed', message: `Target org: ${targetUsername} (connectivity not tested)` };
      }
    }

    // Checks 8–11: org-connectivity-dependent deployment validators
    // Run only when target org is reachable (avoids spurious failures when offline)
    if (options.runOrgValidations !== false && targetUsername) {
      try {
        const engineContext = {
          targetUsername,
          // Pass caller-supplied lists of record types / pricing elements when provided
          recordTypeIds:    options.recordTypeIds    || [],
          pricingElements:  options.pricingElements  || [],
        };

        // Determine which rules to run: skip GT layout / inactive procs when caller opts out
        const ruleIds = [];
        if (options.checkGtLayouts !== false)              ruleIds.push('deployment.missing-gt-object-layout');
        if (options.checkRecordTypeIds !== false)          ruleIds.push('deployment.invalid-record-type-id');
        if (options.checkPricingElementTrigger !== false)  ruleIds.push('deployment.pricing-element-trigger');
        if (options.checkCalculationProcedures !== false)  ruleIds.push('deployment.inactive-calculation-procedures');

        const engineResult = await _deployEngine.run(targetUsername, engineContext, ruleIds.length ? ruleIds : undefined);

        errors.push(...engineResult.errors);
        warnings.push(...engineResult.warnings);

        engineResult.results.forEach(r => {
          if (r.passed) {
            passedChecks[r.ruleId] = { check: r.ruleId, severity: 'passed', message: `${r.ruleId} passed` };
          }
        });
      } catch (err) {
        logger.warn('Deploy preflight: validation engine error', { error: err.message });
        warnings.push({ check: 'validation_engine', severity: 'warning', message: `Validation engine encountered an error: ${err.message}` });
      }
    }

    const passing = errors.length === 0;
    logger.info('Deploy preflight checks complete', {
      targetUsername,
      errors: errors.length,
      warnings: warnings.length,
      passed: passing
    });

    return { passed: passing, errors, warnings, passedChecks };
  }
}

module.exports = new DeployPreflightService();
