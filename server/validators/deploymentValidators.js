/**
 * Deployment Validators
 *
 * Rule  8 – Missing GT Object Layout in target environment
 * Rule  9 – Invalid RecordTypeId (INVALID_CROSS_REFERENCE_KEY)
 * Rule 10 – PricingElement Trigger pre-flight (required pricing fields)
 * Rule 11 – Inactive Calculation Procedures
 */

const salesforceService = require('../services/salesforceService');
const logger = require('../utils/logger');

function esc(v) {
  if (typeof v !== 'string') return v;
  return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * GT custom objects whose layout existence should be verified in the target org.
 * Extend this list as new GT objects are introduced.
 */
const GT_OBJECTS_TO_CHECK = [
  'GT_RateCode__c',
  'GT_RateTable__c',
];

/**
 * Required fields on vlocity_cmt__PricingElement__c that must be present
 * to avoid a PricingElementTriggerHandler exception.
 */
const PRICING_ELEMENT_REQUIRED_FIELDS = [
  'vlocity_cmt__PriceListId__c',
  'vlocity_cmt__PricingVariableId__c',
  'vlocity_cmt__Amount__c',
];

// ─── Rule 8: Missing GT Object Layout ────────────────────────────────────────

/**
 * context: { targetUsername }
 *
 * Uses the Salesforce Tooling API (via REST) to query Layout records for
 * each GT object.  Missing layout → WARNING (deploy can still proceed but
 * the UI may break for users who rely on that layout).
 */
const missingGtObjectLayoutRule = {
  id: 'deployment.missing-gt-object-layout',
  category: 'Deployment',
  async validate(username, context) {
    const targetUsername = context.targetUsername || username;
    await salesforceService.authenticateWithSfdx(targetUsername);

    const warnings = [];

    for (const objectName of GT_OBJECTS_TO_CHECK) {
      try {
        // Tooling API: query Layout for the sObject
        const soql = `SELECT Id, Name FROM Layout WHERE EntityDefinition.QualifiedApiName = '${esc(objectName)}'`;
        const toolingUrl = `${salesforceService.baseUrl.replace('/data/', '/tooling/')}/query?q=${encodeURIComponent(soql)}`;

        const { default: axios } = require('axios');
        const response = await axios.get(toolingUrl, {
          headers: { Authorization: `Bearer ${salesforceService.accessToken}` },
        });

        if (!response.data?.records?.length) {
          warnings.push({
            message: `No page layout found for GT object "${objectName}" in target org "${targetUsername}". Users may encounter layout errors after deployment.`,
            details: { objectName, targetUsername },
          });
        }
      } catch (err) {
        // Non-fatal — tooling API access may be restricted
        logger.warn(`Rule deployment.missing-gt-object-layout: could not query layout for ${objectName}`, { error: err.message });
        warnings.push({
          message: `Could not verify page layout for "${objectName}" in target org (${err.message}). Manual verification recommended.`,
          details: { objectName, targetUsername, queryError: err.message },
        });
      }
    }

    return { errors: [], warnings };
  },
};

// ─── Rule 9: Invalid RecordTypeId ────────────────────────────────────────────

/**
 * context: { recordTypeIds: [{ id, sObjectType }] }
 *
 * Verifies that each RecordTypeId referenced in a DataPack exists in the
 * target org.  Returns an ERROR for each invalid ID — these will cause
 * INVALID_CROSS_REFERENCE_KEY failures at deploy time.
 */
const invalidRecordTypeIdRule = {
  id: 'deployment.invalid-record-type-id',
  category: 'Deployment',
  async validate(username, context) {
    const { recordTypeIds, targetUsername } = context;
    if (!recordTypeIds || recordTypeIds.length === 0) return { errors: [], warnings: [] };

    const target = targetUsername || username;
    await salesforceService.authenticateWithSfdx(target);

    const errors = [];

    // Group by sObjectType for efficient querying
    const byType = {};
    for (const { id, sObjectType } of recordTypeIds) {
      if (!byType[sObjectType]) byType[sObjectType] = [];
      byType[sObjectType].push(id);
    }

    for (const [sObjectType, ids] of Object.entries(byType)) {
      try {
        const idList = ids.map(id => `'${esc(id)}'`).join(', ');
        const soql   = `SELECT Id FROM RecordType WHERE Id IN (${idList}) AND SObjectType = '${esc(sObjectType)}'`;
        const result = await salesforceService.query(soql);

        const foundIds = new Set((result.records || []).map(r => r.Id));
        for (const id of ids) {
          if (!foundIds.has(id)) {
            errors.push({
              message: `RecordTypeId "${id}" for sObject "${sObjectType}" does not exist in target org "${target}". Deployment will fail with INVALID_CROSS_REFERENCE_KEY. Map or replace this RecordType ID before deploying.`,
              details: { invalidId: id, sObjectType, targetUsername: target },
            });
          }
        }
      } catch (err) {
        logger.warn(`Rule deployment.invalid-record-type-id: query failed for ${sObjectType}`, { error: err.message });
      }
    }

    return { errors, warnings: [] };
  },
};

// ─── Rule 10: PricingElement Trigger Pre-flight ───────────────────────────────

/**
 * context: { pricingElements: [{ Name, ...fields }] }
 *
 * Checks that each PricingElement record in the deployment payload contains
 * the required fields to avoid vlocity_cmt.PricingElementTriggerHandler errors.
 */
const pricingElementTriggerRule = {
  id: 'deployment.pricing-element-trigger',
  category: 'Deployment',
  async validate(_username, context) {
    const { pricingElements } = context;
    if (!pricingElements || pricingElements.length === 0) return { errors: [], warnings: [] };

    const errors = [];

    for (const element of pricingElements) {
      const missing = PRICING_ELEMENT_REQUIRED_FIELDS.filter(f => !element[f]);
      if (missing.length > 0) {
        errors.push({
          message: `PricingElement "${element.Name || 'unknown'}" is missing required field(s) [${missing.join(', ')}]. Deployment would trigger a PricingElementTriggerHandler exception.`,
          details: { elementName: element.Name, missingFields: missing },
        });
      }
    }

    return { errors, warnings: [] };
  },
};

// ─── Rule 11: Inactive Calculation Procedures ────────────────────────────────

/**
 * context: { targetUsername? }
 *
 * Queries for CalculationProcedure records that are not Active.
 * Returns a WARNING — inactive procedures break pricing at runtime.
 */
const inactiveCalculationProceduresRule = {
  id: 'deployment.inactive-calculation-procedures',
  category: 'Deployment',
  async validate(username, context) {
    const target = context.targetUsername || username;
    await salesforceService.authenticateWithSfdx(target);

    const soql = `SELECT Id, Name, vlocity_cmt__Status__c
                  FROM vlocity_cmt__CalculationProcedure__c
                  WHERE vlocity_cmt__Status__c != 'Active'
                  ORDER BY Name
                  LIMIT 50`;

    try {
      const result = await salesforceService.query(soql);
      if (!result.records?.length) return { errors: [], warnings: [] };

      const warnings = result.records.map(proc => ({
        message: `Calculation Procedure "${proc.Name}" (Id: ${proc.Id}) is not Active (Status: "${proc.vlocity_cmt__Status__c}"). Pricing calculations relying on this procedure will fail at runtime.`,
        details: { procedureId: proc.Id, procedureName: proc.Name, status: proc.vlocity_cmt__Status__c },
      }));

      return { errors: [], warnings };
    } catch (err) {
      logger.warn('Rule deployment.inactive-calculation-procedures: query failed', { error: err.message });
      return { errors: [], warnings: [] };
    }
  },
};

module.exports = {
  missingGtObjectLayoutRule,
  invalidRecordTypeIdRule,
  pricingElementTriggerRule,
  inactiveCalculationProceduresRule,
};
