/**
 * Repair Product Validators
 *
 * Rule 5 – Repair Product Picklist (vlocity_cmt__Reason__c) missing
 * Rule 6 – Repair Product Required Fields (supplier, repairType, productClassification)
 * Rule 7 – Missing Supplier Attribute on Repair Product
 */

const salesforceService = require('../services/salesforceService');
const logger = require('../utils/logger');

function esc(v) {
  if (typeof v !== 'string') return v;
  return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Field map for Repair product required fields.
 * key   = logical name used in context / error messages
 * value = actual Salesforce API field name
 */
const REPAIR_REQUIRED_FIELDS = {
  supplier:               'vlocity_cmt__SupplierCode__c',
  repairType:             'vlocity_cmt__RepairType__c',
  productClassification:  'vlocity_cmt__ProductClassification__c',
};

/** Name of the supplier attribute expected on Repair products */
const SUPPLIER_ATTRIBUTE_NAME = 'supplier';

// ─── Rule 5: Repair Product Picklist ─────────────────────────────────────────

/**
 * context: { productId?, data? }
 *
 * Validates that vlocity_cmt__Reason__c is populated.
 * Can work against:
 *   - incoming data object (pre-insert check)
 *   - an existing Salesforce record queried by productId
 */
const repairProductPicklistRule = {
  id: 'repair.missing-reason-picklist',
  category: 'RepairProduct',
  async validate(username, context) {
    const { productId, data } = context;

    // ── 5a. Pre-insert check against the data payload ──
    if (data && typeof data === 'object') {
      if (!data.vlocity_cmt__Reason__c) {
        return {
          errors: [{
            message: `Repair product is missing the required picklist field "vlocity_cmt__Reason__c" (Reason). Please provide a valid Reason value before saving.`,
            details: { field: 'vlocity_cmt__Reason__c' },
          }],
          warnings: [],
        };
      }
      return { errors: [], warnings: [] };
    }

    // ── 5b. Post-save check against an existing record ──
    if (!productId) return { errors: [], warnings: [] };

    await salesforceService.authenticateWithSfdx(username);
    const soql = `SELECT Id, Name, vlocity_cmt__Reason__c
                  FROM Product2
                  WHERE Id = '${esc(productId)}' LIMIT 1`;

    try {
      const result = await salesforceService.query(soql);
      const product = result.records?.[0];
      if (product && !product.vlocity_cmt__Reason__c) {
        return {
          errors: [{
            message: `Repair product "${product.Name}" (Id: ${product.Id}) is missing the required picklist "vlocity_cmt__Reason__c". Update the product before proceeding.`,
            details: { productId: product.Id, productName: product.Name, field: 'vlocity_cmt__Reason__c' },
          }],
          warnings: [],
        };
      }
    } catch (err) {
      logger.warn('Rule repair.missing-reason-picklist: query failed', { error: err.message });
    }

    return { errors: [], warnings: [] };
  },
};

// ─── Rule 6: Repair Product Required Fields ───────────────────────────────────

/**
 * context: { productId?, data? }
 *
 * Validates that the three mandatory Repair fields are populated.
 */
const repairProductFieldsRule = {
  id: 'repair.missing-required-fields',
  category: 'RepairProduct',
  async validate(username, context) {
    const { productId, data } = context;
    const missing = [];

    // ── 6a. Pre-insert check ──
    if (data && typeof data === 'object') {
      for (const [logicalName, apiField] of Object.entries(REPAIR_REQUIRED_FIELDS)) {
        if (!data[apiField]) missing.push({ logicalName, apiField });
      }
      if (missing.length > 0) {
        return {
          errors: [{
            message: `Repair product is missing required field(s): ${missing.map(m => `"${m.logicalName}" (${m.apiField})`).join(', ')}.`,
            details: { missingFields: missing },
          }],
          warnings: [],
        };
      }
      return { errors: [], warnings: [] };
    }

    // ── 6b. Post-save check ──
    if (!productId) return { errors: [], warnings: [] };

    await salesforceService.authenticateWithSfdx(username);
    const fieldList = ['Id', 'Name', ...Object.values(REPAIR_REQUIRED_FIELDS)].join(', ');
    const soql = `SELECT ${fieldList} FROM Product2 WHERE Id = '${esc(productId)}' LIMIT 1`;

    try {
      const result = await salesforceService.query(soql);
      const product = result.records?.[0];
      if (!product) return { errors: [], warnings: [] };

      for (const [logicalName, apiField] of Object.entries(REPAIR_REQUIRED_FIELDS)) {
        if (!product[apiField]) missing.push({ logicalName, apiField });
      }

      if (missing.length > 0) {
        return {
          errors: [{
            message: `Repair product "${product.Name}" (Id: ${product.Id}) is missing required field(s): ${missing.map(m => `"${m.logicalName}" (${m.apiField})`).join(', ')}.`,
            details: { productId: product.Id, productName: product.Name, missingFields: missing },
          }],
          warnings: [],
        };
      }
    } catch (err) {
      logger.warn('Rule repair.missing-required-fields: query failed', { error: err.message });
    }

    return { errors: [], warnings: [] };
  },
};

// ─── Rule 7: Missing Supplier Attribute on Repair Product ────────────────────

/**
 * context: { productId }
 *
 * Queries vlocity_cmt__AttributeAssignment__c to verify that a "supplier"
 * attribute is assigned to the product.
 */
const repairSupplierAttributeRule = {
  id: 'repair.missing-supplier-attribute',
  category: 'RepairProduct',
  async validate(username, context) {
    const { productId } = context;
    if (!productId) return { errors: [], warnings: [] };

    await salesforceService.authenticateWithSfdx(username);

    const soql = `SELECT Id, vlocity_cmt__AttributeId__r.Name
                  FROM vlocity_cmt__AttributeAssignment__c
                  WHERE vlocity_cmt__ObjectId__c = '${esc(productId)}'
                    AND vlocity_cmt__AttributeId__r.Name = '${esc(SUPPLIER_ATTRIBUTE_NAME)}'
                  LIMIT 1`;

    try {
      const result = await salesforceService.query(soql);
      if (result.totalSize === 0) {
        return {
          errors: [{
            message: `Repair product (Id: ${productId}) is missing the required "supplier" attribute assignment. Assign the supplier attribute before deploying.`,
            details: { productId, missingAttribute: SUPPLIER_ATTRIBUTE_NAME },
          }],
          warnings: [],
        };
      }
    } catch (err) {
      logger.warn('Rule repair.missing-supplier-attribute: query failed', { error: err.message });
    }

    return { errors: [], warnings: [] };
  },
};

module.exports = {
  repairProductPicklistRule,
  repairProductFieldsRule,
  repairSupplierAttributeRule,
  REPAIR_REQUIRED_FIELDS,
};
