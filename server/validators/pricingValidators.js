/**
 * Pricing Validators
 *
 * Rules 1 – Duplicate PricingElement
 * Rules 2 – Duplicate PriceListEntry (PricebookEntry)
 * Rules 3 – Duplicate Offer / Virtual Accessory
 * Rules 4 – Offer With Missing / Zero Price
 * Rules 12 – Hardware Accessory ("HA") With Zero Price
 * Rules 13 – SKU Format (leading-zero padding)
 * Rules 14 – Async Apex Job Failure Detection
 */

const salesforceService = require('../services/salesforceService');
const logger = require('../utils/logger');

// ─── helpers ────────────────────────────────────────────────────────────────

function esc(v) {
  if (typeof v !== 'string') return v;
  return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Expected SKU width. SKUs shorter than this (without leading zeros) trigger Rule 13. */
const SKU_LENGTH = 8;

/** Normalize a SKU by left-padding with zeros to SKU_LENGTH. */
function normalizeSku(sku) {
  if (!sku) return sku;
  return String(sku).padStart(SKU_LENGTH, '0');
}

/** Return true when a price is "missing" (null / undefined / 0). */
function isMissingPrice(price) {
  return price === null || price === undefined || Number(price) === 0;
}

// ─── Rule 1: Duplicate PricingElement ────────────────────────────────────────

/**
 * context: { productId, pricingPlanId, pricingVariableId, pricingElementName }
 */
const duplicatePricingElementRule = {
  id: 'pricing.duplicate-pricing-element',
  category: 'Pricing',
  async validate(username, context) {
    const { productId, pricingPlanId, pricingVariableId, pricingElementName } = context;

    if (!productId || !pricingPlanId) return { errors: [], warnings: [] };

    await salesforceService.authenticateWithSfdx(username);

    const conditions = [`vlocity_cmt__PriceListId__c = '${esc(pricingPlanId)}'`];
    if (productId)          conditions.push(`vlocity_cmt__ProductId__c = '${esc(productId)}'`);
    if (pricingVariableId)  conditions.push(`vlocity_cmt__PricingVariableId__c = '${esc(pricingVariableId)}'`);
    if (pricingElementName) conditions.push(`Name = '${esc(pricingElementName)}'`);

    const soql = `SELECT Id, Name FROM vlocity_cmt__PricingElement__c WHERE ${conditions.join(' AND ')} LIMIT 1`;

    try {
      const result = await salesforceService.query(soql);
      if (result.totalSize > 0) {
        return {
          errors: [{
            message: `Duplicate PricingElement detected. An element with the same Product, PricingPlan, PricingVariable and Name already exists (Id: ${result.records[0].Id}).`,
            details: { existingId: result.records[0].Id, existingName: result.records[0].Name },
          }],
          warnings: [],
        };
      }
    } catch (err) {
      logger.warn('Rule pricing.duplicate-pricing-element: query failed', { error: err.message });
    }

    return { errors: [], warnings: [] };
  },
};

// ─── Rule 2: Duplicate PriceListEntry (PricebookEntry) ───────────────────────

/**
 * context: { productId, pricebookId, currencyIsoCode }
 */
const duplicatePriceListEntryRule = {
  id: 'pricing.duplicate-pricelist-entry',
  category: 'Pricing',
  async validate(username, context) {
    const { productId, pricebookId, currencyIsoCode } = context;

    if (!productId || !pricebookId) return { errors: [], warnings: [] };

    await salesforceService.authenticateWithSfdx(username);

    const conditions = [
      `Product2Id = '${esc(productId)}'`,
      `Pricebook2Id = '${esc(pricebookId)}'`,
    ];
    if (currencyIsoCode) conditions.push(`CurrencyIsoCode = '${esc(currencyIsoCode)}'`);

    const soql = `SELECT Id, UnitPrice FROM PricebookEntry WHERE ${conditions.join(' AND ')} LIMIT 1`;

    try {
      const result = await salesforceService.query(soql);
      if (result.totalSize > 0) {
        return {
          errors: [{
            message: `Duplicate PriceListEntry detected. A PricebookEntry for Product ${productId} in Pricebook ${pricebookId}${currencyIsoCode ? ` (${currencyIsoCode})` : ''} already exists (Id: ${result.records[0].Id}).`,
            details: { existingId: result.records[0].Id, existingUnitPrice: result.records[0].UnitPrice },
          }],
          warnings: [],
        };
      }
    } catch (err) {
      logger.warn('Rule pricing.duplicate-pricelist-entry: query failed', { error: err.message });
    }

    return { errors: [], warnings: [] };
  },
};

// ─── Rule 3: Duplicate Offer / Virtual Accessory ─────────────────────────────

/**
 * context: { productName, sku, offerCode }
 * Any matching field triggers the duplicate block.
 */
const duplicateOfferRule = {
  id: 'pricing.duplicate-offer',
  category: 'Pricing',
  async validate(username, context) {
    const { productName, sku, offerCode } = context;

    if (!productName && !sku && !offerCode) return { errors: [], warnings: [] };

    await salesforceService.authenticateWithSfdx(username);

    const orClauses = [];
    if (productName) orClauses.push(`Name = '${esc(productName)}'`);
    if (sku)         orClauses.push(`ProductCode = '${esc(sku)}'`);
    if (offerCode)   orClauses.push(`vlocity_cmt__OfferCode__c = '${esc(offerCode)}'`);

    const soql = `SELECT Id, Name, ProductCode FROM Product2 WHERE ${orClauses.join(' OR ')} LIMIT 1`;

    try {
      const result = await salesforceService.query(soql);
      if (result.totalSize > 0) {
        const existing = result.records[0];
        return {
          errors: [{
            message: `Duplicate product detected. A Product2 record with the same Name / SKU / OfferCode already exists (Id: ${existing.Id}, Name: "${existing.Name}", ProductCode: "${existing.ProductCode}").`,
            details: { existingId: existing.Id, existingName: existing.Name, existingProductCode: existing.ProductCode },
          }],
          warnings: [],
        };
      }
    } catch (err) {
      logger.warn('Rule pricing.duplicate-offer: query failed', { error: err.message });
    }

    return { errors: [], warnings: [] };
  },
};

// ─── Rule 4: Offer With Missing / Zero Price ──────────────────────────────────

/**
 * context: { price, productName }
 */
const missingOfferPriceRule = {
  id: 'pricing.missing-offer-price',
  category: 'Pricing',
  async validate(_username, context) {
    const { price, productName } = context;
    if (isMissingPrice(price)) {
      return {
        errors: [],
        warnings: [{
          message: `Offer "${productName || 'unknown'}" has a missing or zero price. The offer will be created but will not be purchasable.`,
          details: { price },
        }],
      };
    }
    return { errors: [], warnings: [] };
  },
};

// ─── Rule 12: Hardware Accessory (HA) With Zero Price ────────────────────────

/**
 * context: { price, productName, productType }
 * productType should contain 'HA' or 'Hardware' to trigger this check.
 */
const haZeroPriceRule = {
  id: 'pricing.ha-zero-price',
  category: 'Pricing',
  async validate(_username, context) {
    const { price, productName, productType } = context;
    const isHA = productType && /^HA$/i.test(String(productType).trim());
    if (isHA && isMissingPrice(price)) {
      return {
        errors: [],
        warnings: [{
          message: `Hearing Aid product "${productName || 'unknown'}" has a price of 0. HA products with zero price are blocked from pricing upload.`,
          details: { productName, productType, price },
        }],
      };
    }
    return { errors: [], warnings: [] };
  },
};

// ─── Rule 13: SKU Format Validation ──────────────────────────────────────────

/**
 * context: { sku, productName }
 * Returns a WARNING and the corrected (padded) SKU.
 */
const skuFormatRule = {
  id: 'pricing.sku-format',
  category: 'Pricing',
  async validate(_username, context) {
    const { sku, productName } = context;
    if (!sku) return { errors: [], warnings: [] };

    const skuStr = String(sku);
    if (skuStr.length < SKU_LENGTH && !/^0/.test(skuStr)) {
      const corrected = normalizeSku(skuStr);
      return {
        errors: [],
        warnings: [{
          message: `SKU "${skuStr}" for product "${productName || 'unknown'}" is missing leading zeros. Expected: "${corrected}".`,
          details: { original: skuStr, corrected },
          autoCorrect: { sku: corrected },
        }],
      };
    }
    return { errors: [], warnings: [] };
  },
};

// ─── Rule 14: Async Apex Job Failure Detection ───────────────────────────────

/**
 * context: { apexJobId? } — if provided, checks a specific job; otherwise
 * returns the most recent failed pricing-related job.
 *
 * Known failure patterns:
 *   - "decimal" errors   → malformed numeric field
 *   - "null object"      → NullPointerException in Apex
 */
const APEX_FAILURE_PATTERNS = [
  { pattern: /decimal/i,        label: 'Decimal conversion error' },
  { pattern: /null object/i,    label: 'Null dereference error' },
  { pattern: /Script-thrown/i,  label: 'Script-thrown Apex exception' },
  { pattern: /PricingElement/i, label: 'PricingElement trigger exception' },
];

const asyncApexJobFailureRule = {
  id: 'pricing.async-apex-job-failure',
  category: 'Pricing',
  async validate(username, context) {
    const { apexJobId } = context;

    await salesforceService.authenticateWithSfdx(username);

    let soql;
    if (apexJobId) {
      soql = `SELECT Id, Status, NumberOfErrors, ExtendedStatus, ApexClass.Name
              FROM AsyncApexJob
              WHERE Id = '${esc(apexJobId)}' LIMIT 1`;
    } else {
      // Check the most recent failed batch jobs from today
      soql = `SELECT Id, Status, NumberOfErrors, ExtendedStatus, ApexClass.Name, CreatedDate
              FROM AsyncApexJob
              WHERE Status IN ('Failed', 'Aborted')
                AND JobType = 'BatchApex'
                AND CreatedDate = TODAY
              ORDER BY CreatedDate DESC
              LIMIT 10`;
    }

    try {
      const result = await salesforceService.query(soql);
      const failed = (result.records || []).filter(j =>
        j.Status === 'Failed' || j.Status === 'Aborted' || j.NumberOfErrors > 0
      );

      if (failed.length === 0) return { errors: [], warnings: [] };

      const errors = failed.map(job => {
        const extended = job.ExtendedStatus || '';
        const matched  = APEX_FAILURE_PATTERNS.find(p => p.pattern.test(extended));
        return {
          message: `Async Apex job failed (Id: ${job.Id}, Class: ${job.ApexClass?.Name || 'unknown'}, Status: ${job.Status}).${matched ? ` Likely cause: ${matched.label}.` : ''} ExtendedStatus: ${extended || 'none'}`,
          details: {
            jobId:          job.Id,
            apexClassName:  job.ApexClass?.Name,
            status:         job.Status,
            numberOfErrors: job.NumberOfErrors,
            extendedStatus: job.ExtendedStatus,
            failureType:    matched?.label || 'unknown',
          },
        };
      });

      return { errors, warnings: [] };
    } catch (err) {
      logger.warn('Rule pricing.async-apex-job-failure: query failed', { error: err.message });
      return { errors: [], warnings: [] };
    }
  },
};

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  duplicatePricingElementRule,
  duplicatePriceListEntryRule,
  duplicateOfferRule,
  missingOfferPriceRule,
  haZeroPriceRule,
  skuFormatRule,
  asyncApexJobFailureRule,
  normalizeSku,
};
