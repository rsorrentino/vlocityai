/**
 * ValidationRuleEngine
 *
 * Centralized, enterprise-grade validation orchestrator.
 * Validators are registered as rules with: id, category, severity, and a
 * validate(username, context) function that returns { errors, warnings }.
 *
 * Usage:
 *   const engine = new ValidationRuleEngine();
 *   engine.registerRule(myRule);
 *   const result = await engine.run(username, context, ['rule-1', 'rule-2']);
 */

const logger = require('../utils/logger');

// Severity constants
const SEVERITY = {
  ERROR: 'error',
  WARNING: 'warning',
};

class ValidationRuleEngine {
  constructor() {
    /** @type {Map<string, Object>} */
    this._rules = new Map();
  }

  /**
   * Register a validation rule.
   * @param {{ id: string, category: string, severity: 'error'|'warning', validate: Function }} rule
   */
  registerRule(rule) {
    if (!rule.id || typeof rule.validate !== 'function') {
      throw new Error(`Rule must have an id and a validate function`);
    }
    this._rules.set(rule.id, rule);
    return this;
  }

  /**
   * Register multiple rules at once.
   * @param {Array} rules
   */
  registerRules(rules) {
    rules.forEach(r => this.registerRule(r));
    return this;
  }

  /**
   * Run a subset (or all) rules against the provided context.
   *
   * @param {string} username - Salesforce org username/alias
   * @param {Object} context  - Arbitrary data passed to each rule's validate()
   * @param {string[]} [ruleIds] - Optional list of rule IDs to execute; runs all if omitted
   * @returns {Promise<{ valid: boolean, errors: Object[], warnings: Object[], results: Object[] }>}
   */
  async run(username, context, ruleIds) {
    const toRun = ruleIds
      ? ruleIds.map(id => this._rules.get(id)).filter(Boolean)
      : [...this._rules.values()];

    const errors   = [];
    const warnings = [];
    const results  = [];

    await Promise.allSettled(
      toRun.map(async rule => {
        try {
          const outcome = await rule.validate(username, context);
          const ruleErrors   = (outcome.errors   || []).map(e => ({ ...e, ruleId: rule.id, category: rule.category, severity: SEVERITY.ERROR }));
          const ruleWarnings = (outcome.warnings || []).map(w => ({ ...w, ruleId: rule.id, category: rule.category, severity: SEVERITY.WARNING }));

          errors.push(...ruleErrors);
          warnings.push(...ruleWarnings);
          results.push({
            ruleId:   rule.id,
            category: rule.category,
            passed:   ruleErrors.length === 0,
            errors:   ruleErrors,
            warnings: ruleWarnings,
          });
        } catch (err) {
          // Rule execution failures are non-fatal — logged as warnings
          const msg = `Validation rule "${rule.id}" failed to execute: ${err.message}`;
          logger.warn(msg, { ruleId: rule.id, error: err.message });
          warnings.push({ ruleId: rule.id, category: rule.category, severity: SEVERITY.WARNING, message: msg });
          results.push({ ruleId: rule.id, category: rule.category, passed: false, executionError: err.message });
        }
      })
    );

    const valid = errors.length === 0;
    logger.info('ValidationRuleEngine run complete', {
      rulesRun: toRun.length,
      errors: errors.length,
      warnings: warnings.length,
      valid,
    });

    return { valid, errors, warnings, results };
  }

  /** List all registered rule IDs */
  listRules() {
    return [...this._rules.keys()];
  }
}

module.exports = { ValidationRuleEngine, SEVERITY };
