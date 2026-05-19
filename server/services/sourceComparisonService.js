'use strict';

const { getOrgConnection, queryAll, inClause } = require('./serviceCreationService');
const logger = require('../utils/logger');

/**
 * Compare normalised price rows against live PricingElement records in the org.
 *
 * @param {Array}  normalisedRows - output of normalisePriceRows()
 * @param {string} username       - SFDX username
 * @returns {ComparisonResult}
 */
async function comparePricingElementsToOrg(normalisedRows, username) {
  const conn = await getOrgConnection(username);

  if (normalisedRows.length === 0) {
    return { summary: { totalSource: 0, match: 0, mismatch: 0, missing: 0, extra: 0 }, rows: [], extras: [] };
  }

  // ── Fetch org records by GlobalKey ────────────────────────────────────────
  const globalKeys = normalisedRows.map(r => r.globalKey);
  const chunkSize = 200;
  let orgRecords = [];

  for (let i = 0; i < globalKeys.length; i += chunkSize) {
    const chunk = globalKeys.slice(i, i + chunkSize);
    const soql = `
      SELECT vlocity_cmt__GlobalKey__c,
             vlocity_cmt__Amount__c,
             vlocity_cmt__EffectiveFromDate__c,
             vlocity_cmt__IsActive__c,
             vlocity_cmt__ProductId__r.ProductCode,
             vlocity_cmt__PriceListId__r.Name,
             vlocity_cmt__PricingVariableId__r.Name
      FROM vlocity_cmt__PricingElement__c
      WHERE vlocity_cmt__GlobalKey__c IN (${inClause(chunk)})
    `;
    const batch = await queryAll(conn, soql);
    orgRecords = orgRecords.concat(batch);
  }

  const orgMap = new Map(orgRecords.map(r => [r.vlocity_cmt__GlobalKey__c, r]));

  // ── Diff each source row ──────────────────────────────────────────────────
  const rows = [];
  let matchCount = 0;
  let mismatchCount = 0;
  let missingCount = 0;

  for (const row of normalisedRows) {
    const org = orgMap.get(row.globalKey);
    if (!org) {
      missingCount++;
      rows.push({
        sku: row.sku,
        priceList: row.priceListName,
        pricingVariable: row.pricingVariableName,
        globalKey: row.globalKey,
        status: 'missing',
        diffs: [],
      });
      continue;
    }

    const diffs = [];

    // Amount comparison (numeric)
    const orgAmount = org.vlocity_cmt__Amount__c != null ? Number(org.vlocity_cmt__Amount__c) : null;
    if (orgAmount !== row.amount) {
      diffs.push({ field: 'Amount', source: String(row.amount), org: orgAmount != null ? String(orgAmount) : '' });
    }

    // Date comparison (string prefix match — org may include time component)
    const orgDate = org.vlocity_cmt__EffectiveFromDate__c
      ? String(org.vlocity_cmt__EffectiveFromDate__c).substring(0, 10)
      : null;
    const srcDate = row.effectiveStartDate
      ? String(row.effectiveStartDate).substring(0, 10)
      : null;
    if (srcDate && orgDate !== srcDate) {
      diffs.push({ field: 'EffectiveStartDate', source: srcDate, org: orgDate || '' });
    }

    if (diffs.length > 0) {
      mismatchCount++;
      rows.push({
        sku: row.sku,
        priceList: row.priceListName,
        pricingVariable: row.pricingVariableName,
        globalKey: row.globalKey,
        status: 'mismatch',
        diffs,
      });
    } else {
      matchCount++;
      rows.push({
        sku: row.sku,
        priceList: row.priceListName,
        pricingVariable: row.pricingVariableName,
        globalKey: row.globalKey,
        status: 'match',
        diffs: [],
      });
    }
  }

  // ── Extra records in org not in source ───────────────────────────────────
  const sourceKeySet = new Set(globalKeys);
  const extras = orgRecords
    .filter(r => !sourceKeySet.has(r.vlocity_cmt__GlobalKey__c))
    .map(r => ({
      globalKey: r.vlocity_cmt__GlobalKey__c,
      sku: r.vlocity_cmt__ProductId__r?.ProductCode || null,
      priceList: r.vlocity_cmt__PriceListId__r?.Name || null,
      pricingVariable: r.vlocity_cmt__PricingVariableId__r?.Name || null,
      amount: r.vlocity_cmt__Amount__c,
    }));

  const summary = {
    totalSource: normalisedRows.length,
    match: matchCount,
    mismatch: mismatchCount,
    missing: missingCount,
    extra: extras.length,
  };

  logger.info('Source comparison complete', summary);

  return { summary, rows, extras };
}

/**
 * Generate a CSV string from a ComparisonResult (price file).
 */
function comparisonToCsv(result) {
  const lines = ['SKU,PriceList,PricingVariable,GlobalKey,Status,Field,Source Value,Org Value'];
  for (const row of result.rows) {
    if (row.diffs && row.diffs.length > 0) {
      for (const diff of row.diffs) {
        lines.push([row.sku, row.priceList, row.pricingVariable, row.globalKey, row.status, diff.field, diff.source, diff.org]
          .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
      }
    } else {
      lines.push([row.sku, row.priceList, row.pricingVariable, row.globalKey, row.status, '', '', '']
        .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    }
  }
  for (const extra of result.extras) {
    lines.push([extra.sku, extra.priceList, extra.pricingVariable, extra.globalKey, 'extra', '', '', '']
      .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
  }
  return lines.join('\n');
}

// ── Staging vs Product2 comparison ────────────────────────────────────────────

/**
 * Full field mapping derived from AMP_ServiceCreationBatchHelper.generatesProduct().
 *
 * Match key: GT_StagingArea__c.GT_ItemNumber__c  ↔  Product2.ProductCode
 *
 * Each entry: { staging, product, label }
 * - staging: field API name on GT_StagingArea__c
 * - product: field API name on Product2
 * - label:   human-readable name for the diff UI
 */
const STAGING_FIELD_MAP = [
  // Core product identity
  { staging: 'GT_ProductName__c',           product: 'Name',                         label: 'Product Name' },
  { staging: 'GT_CommercialDescription__c', product: 'GT_CommercialDescription__c',  label: 'Commercial Description' },
  { staging: 'GT_ProductNameTranslation__c',product: 'GT_ProductNameTranslation__c', label: 'Product Name (Translation)' },

  // Classification
  { staging: 'GT_AmplifonClass__c',         product: 'GT_AmplifonClass__c',          label: 'Amplifon Class' },
  { staging: 'GT_AmplifonClassDesc__c',     product: 'GT_AmplifonClassDesc__c',      label: 'Amplifon Class Desc' },
  { staging: 'GT_AmplifonSubclass__c',      product: 'GT_AmplifonSubclass__c',       label: 'Amplifon Subclass' },
  { staging: 'GT_AmplifonSubclassDesc__c',  product: 'GT_AmplifonSubclassDesc__c',   label: 'Amplifon Subclass Desc' },
  { staging: 'GT_ApeFamily__c',             product: 'GT_ApeFamily__c',              label: 'APE Family' },
  { staging: 'GT_AmplisolutionLocal__c',    product: 'GT_AmplisolutionLocal__c',     label: 'Amplisolution Local' },
  { staging: 'GT_Category__c',              product: 'GT_Category__c',               label: 'Category' },
  { staging: 'GT_ProductType__c',           product: 'GT_ProductType__c',            label: 'Product Type' },
  { staging: 'GT_ProductUse__c',            product: 'GT_ProductUse__c',             label: 'Product Use' },

  // Brand
  { staging: 'GT_BrandCode__c',             product: 'GT_BrandCode__c',              label: 'Brand Code' },
  { staging: 'GT_BrandCodeDesc__c',         product: 'GT_BrandCodeDesc__c',          label: 'Brand Code Desc' },
  { staging: 'GT_VendorName__c',            product: 'GT_VendorName__c',             label: 'Vendor Name' },

  // Physical characteristics
  { staging: 'GT_FormFactor__c',            product: 'GT_FormFactor__c',             label: 'Form Factor' },
  { staging: 'GT_Platform__c',              product: 'GT_Platform__c',               label: 'Platform' },
  { staging: 'GT_PlatformDesc__c',          product: 'GT_PlatformDesc__c',           label: 'Platform Desc' },
  { staging: 'GT_EarSide__c',              product: 'GT_EarSide__c',                label: 'Ear Side' },
  { staging: 'GT_EarsideMgtFlag__c',        product: 'GT_EarsideMgtFlag__c',         label: 'Ear Side Mgmt Flag' },
  { staging: 'GT_Connectivity__c',          product: 'GT_Connectivity__c',           label: 'Connectivity' },
  { staging: 'GT_Rechargeable__c',          product: 'GT_Rechargeable__c',           label: 'Rechargeable' },

  // Battery
  { staging: 'GT_BatteryType__c',           product: 'GT_BatteryType__c',            label: 'Battery Type' },
  { staging: 'GT_BatteryUnits__c',          product: 'GT_BatteryUnits__c',           label: 'Battery Units' },

  // Lifecycle & flags
  { staging: 'GT_Lifecycle__c',             product: 'GT_Lifecycle__c',              label: 'Lifecycle' },
  { staging: 'GT_TrialFlag__c',             product: 'GT_TrialFlag__c',              label: 'Trial Flag' },
  { staging: 'GT_NextFlag__c',              product: 'GT_NextFlag__c',               label: 'Next Flag' },
  { staging: 'GT_CustomFlag__c',            product: 'GT_CustomFlag__c',             label: 'Custom Flag' },
  { staging: 'GT_SubstitutionCode__c',      product: 'GT_SubstitutionCode__c',       label: 'Substitution Code' },
  { staging: 'GT_LotControl__c',            product: 'GT_LotControl__c',             label: 'Lot Control' },
  { staging: 'GT_WarrantyExpiryPeriod__c',  product: 'GT_WarrantyExpiryPeriod__c',   label: 'Warranty Expiry Period' },
  { staging: 'GT_SaleType__c',              product: 'GT_SaleType__c',               label: 'Sale Type' },
  { staging: 'GT_AUDRole__c',               product: 'GT_AUDRole__c',                label: 'AUD Role' },
  { staging: 'GT_TPI__c',                   product: 'GT_TPI__c',                    label: 'TPI' },

  // AU compliance codes
  { staging: 'AU_HSPCode__c',               product: 'AU_HSPCode__c',                label: 'AU HSP Code' },
  { staging: 'AU_NDISSupportCode__c',       product: 'AU_NDISSupportCode__c',        label: 'AU NDIS Support Code' },
  { staging: 'AU_NDIS_Code__c',             product: 'AU_NDIS_Code__c',              label: 'AU NDIS Code' },
  { staging: 'AU_DVACode__c',               product: 'AU_DVACode__c',                label: 'AU DVA Code' },
  { staging: 'AU_RapCode__c',               product: 'AU_RapCode__c',                label: 'AU RAP Code' },
  { staging: 'AU_WC_VIC_Code__c',           product: 'AU_WC_VIC_Code__c',            label: 'AU WC VIC Code' },
  { staging: 'AU_WC_NSW_Code__c',           product: 'AU_WC_NSW_Code__c',            label: 'AU WC NSW Code' },
  { staging: 'AU_WC_QLD_Code__c',           product: 'AU_WC_QLD_Code__c',            label: 'AU WC QLD Code' },
  { staging: 'AU_WC_SA_Code__c',            product: 'AU_WC_SA_Code__c',             label: 'AU WC SA Code' },
  { staging: 'AU_WC_Telstra_Code__c',       product: 'AU_WC_Telstra_Code__c',        label: 'AU WC Telstra Code' },
  { staging: 'AU_Medicare_Code__c',         product: 'AU_Medicare_Code__c',          label: 'AU Medicare Code' },
  { staging: 'AU_ADF_Code__c',              product: 'AU_ADF_Code__c',               label: 'AU ADF Code' },
  { staging: 'GT_DVAFlag__c',               product: 'GT_DVAFlag__c',                label: 'DVA Flag' },
  { staging: 'GT_DVAGoldCardApproval__c',   product: 'GT_DVAGoldCardApproval__c',    label: 'DVA Gold Card Approval' },
  { staging: 'GT_DVAWhiteCardApproval__c',  product: 'GT_DVAWhiteCardApproval__c',   label: 'DVA White Card Approval' },

  // Belgium-specific (renamed fields)
  { staging: 'GT_IsRiziv__c',               product: 'GT_Mutual__c',                 label: 'Is Riziv / Mutual' },
  { staging: 'GT_PriceBrand__c',            product: 'GT_PriceBand__c',              label: 'Price Brand/Band' },
  { staging: 'GT_RIZIVCode__c',             product: 'GT_RIZIVCode__c',              label: 'RIZIV Code' },
];

// All staging fields needed for the comparison SOQL
const STAGING_SELECT_FIELDS = [
  'Id', 'GT_ItemNumber__c', 'GT_RecordStatus__c', 'GT_OrganizationCode__c', 'GT_SalesVatCode__c',
  ...new Set(STAGING_FIELD_MAP.map(m => m.staging)),
].join(', ');

// All Product2 fields needed for the comparison SOQL
const PRODUCT_SELECT_FIELDS = [
  'Id', 'Name', 'ProductCode', 'IsActive', 'GT_CountryCode__c',
  ...new Set(STAGING_FIELD_MAP.map(m => m.product)),
].join(', ');

/**
 * Compare GT_StagingArea__c records against their corresponding Product2 records.
 *
 * Match strategy (two-step, per AMP_ServiceCreationSingleBatch.cls):
 *   1. GT_StagingArea__c.GT_ItemNumber__c
 *      → GT_ProductSKU__c.GT_ProductSKU__c (where GT_OrganizationCode__c matches)
 *      → GT_ProductSKU__c.Product__c
 *      → Product2.Id
 *
 * Fallback: if no SKU record exists the staging record is reported as 'missing'
 * (which may mean the batch hasn't run yet, or service creation failed for that record).
 *
 * @param {string} username     - SFDX username
 * @param {object} options      - { countryCode, status, productType }
 * @returns {StagingComparisonResult}
 */
async function compareStagingToProducts(username, options = {}) {
  const { countryCode, status, productType } = options;
  const conn = await getOrgConnection(username);

  // ── Fetch staging records ──────────────────────────────────────────────────
  const stagingFilters = [];
  if (countryCode) stagingFilters.push(`GT_OrganizationCode__c LIKE '%${countryCode.replace(/'/g, "\\'")}%'`);
  if (status) stagingFilters.push(`GT_RecordStatus__c = '${status.replace(/'/g, "\\'")}'`);
  // Only records with an item number can be matched
  stagingFilters.push('GT_ItemNumber__c != null');

  const stagingWhere = `WHERE ${stagingFilters.join(' AND ')}`;
  const stagingSoql = `SELECT ${STAGING_SELECT_FIELDS} FROM GT_StagingArea__c ${stagingWhere}`;

  let stagingRecords;
  try {
    stagingRecords = await queryAll(conn, stagingSoql);
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('gt_stagingarea') || msg.includes('is not supported') || msg.includes('invalid_type') || msg.includes('no such column')) {
      throw new Error('GT_StagingArea__c object is not available or has missing fields in this org');
    }
    throw err;
  }

  if (stagingRecords.length === 0) {
    return {
      summary: { totalStaging: 0, match: 0, mismatch: 0, missing: 0, extra: 0 },
      rows: [],
      extras: [],
      missingRelated: { skuRecords: 0, rateTables: 0 },
    };
  }

  // ── Resolve GT_ItemNumber__c → Product2 via GT_ProductSKU__c ──────────────
  // This is the exact join the Apex batch uses. ProductCode is constructed as
  // 'AMP_' + countryCode + '_' + productName, which we cannot reconstruct without
  // the AMP_OrgCodeMapping__c custom setting, so we use the SKU table as the bridge.
  const itemNumbers = [...new Set(stagingRecords.map(r => r.GT_ItemNumber__c).filter(Boolean))];
  const orgCodes = [...new Set(stagingRecords.map(r => r.GT_OrganizationCode__c).filter(Boolean))];

  let skuRecords = [];
  const chunkSize = 200;
  for (let i = 0; i < itemNumbers.length; i += chunkSize) {
    const chunk = itemNumbers.slice(i, i + chunkSize);
    const skuFilters = [`GT_ProductSKU__c IN (${inClause(chunk)})`];
    if (orgCodes.length > 0) skuFilters.push(`GT_OrganizationCode__c IN (${inClause(orgCodes)})`);
    const skuSoql = `SELECT GT_ProductSKU__c, GT_OrganizationCode__c, Product__c FROM GT_ProductSKU__c WHERE ${skuFilters.join(' AND ')} AND Product__c != null`;
    try {
      const batch = await queryAll(conn, skuSoql);
      skuRecords = skuRecords.concat(batch);
    } catch (err) {
      // GT_ProductSKU__c may not exist in all orgs — treat as no matches
      logger.warn('GT_ProductSKU__c query failed — falling back to no SKU matches', { error: err.message });
    }
  }

  // Build map: itemNumber + '::' + orgCode → Product2 Id
  const skuToProductId = new Map(
    skuRecords.map(r => [`${r.GT_ProductSKU__c}::${r.GT_OrganizationCode__c}`, r.Product__c])
  );

  // Collect unique product IDs to fetch
  const productIds = [...new Set(skuRecords.map(r => r.Product__c).filter(Boolean))];

  // ── Fetch Product2 records (with field-level retry for missing org fields) ─
  // Some orgs (e.g. AU) don't have Belgium-specific fields like GT_Mutual__c,
  // GT_PriceBand__c, GT_RIZIVCode__c. If the query returns INVALID_FIELD we
  // strip the offending field and retry until all fields are valid.
  let availableProductFields = new Set(PRODUCT_SELECT_FIELDS.split(', '));
  let productRecords = [];
  for (let i = 0; i < productIds.length; i += chunkSize) {
    const chunk = productIds.slice(i, i + chunkSize);
    const productFilters = [`Id IN (${inClause(chunk)})`];
    if (productType) productFilters.push(`vlocity_cmt__Type__c = '${productType.replace(/'/g, "\\'")}'`);

    let attempts = 0;
    while (attempts < 20) {
      attempts++;
      const fields = [...availableProductFields].join(', ');
      const productSoql = `SELECT ${fields} FROM Product2 WHERE ${productFilters.join(' AND ')}`;
      try {
        const batch = await queryAll(conn, productSoql);
        productRecords = productRecords.concat(batch);
        break;
      } catch (err) {
        const msg = err.message || '';
        // Salesforce INVALID_FIELD: "No such column 'FieldName__c' on entity 'Product2'"
        const match = msg.match(/no such column '([^']+)'/i) ||
                      msg.match(/INVALID_FIELD[^']*'([^']+)'/i);
        if (match) {
          const badField = match[1];
          if (availableProductFields.has(badField)) {
            availableProductFields.delete(badField);
            logger.warn(`Product2 field '${badField}' not found in org — skipping`, { username });
          } else {
            throw err; // field already removed, something else is wrong
          }
        } else {
          throw err;
        }
      }
    }
  }

  const productMapById = new Map(productRecords.map(r => [r.Id, r]));

  // ── Completeness: check for missing SKU records and Rate Tables ───────────
  let rateTables = [];
  if (productIds.length > 0) {
    for (let i = 0; i < productIds.length; i += chunkSize) {
      const chunk = productIds.slice(i, i + chunkSize);
      try {
        const rtBatch = await queryAll(conn,
          `SELECT Product__c FROM GT_RateTable__c WHERE Product__c IN (${inClause(chunk)}) AND Product__c != null`
        );
        rateTables = rateTables.concat(rtBatch);
      } catch (_) { /* GT_RateTable__c may not exist */ }
    }
  }
  const productIdsWithRateTable = new Set(rateTables.map(r => r.Product__c));

  const productMap = productMapById; // alias

  // ── Diff ──────────────────────────────────────────────────────────────────
  const rows = [];
  let matchCount = 0;
  let mismatchCount = 0;
  let missingCount = 0;
  let missingSku = 0;
  let missingRateTable = 0;

  for (const staging of stagingRecords) {
    const sku = staging.GT_ItemNumber__c;
    const orgCode = staging.GT_OrganizationCode__c;
    const lookupKey = `${sku}::${orgCode}`;

    const productId = skuToProductId.get(lookupKey);
    const product = productId ? productMap.get(productId) : null;

    // Track completeness issues
    if (!productId) missingSku++;
    if (productId && !productIdsWithRateTable.has(productId)) missingRateTable++;

    if (!product) {
      missingCount++;
      rows.push({
        sku,
        orgCode,
        stagingId: staging.Id,
        stagingStatus: staging.GT_RecordStatus__c,
        status: productId ? 'missing_product' : 'no_sku_record',
        statusDetail: productId
          ? 'SKU record found but Product2 could not be loaded'
          : 'No GT_ProductSKU__c record — service creation may not have run for this item',
        diffs: [],
        relatedChecks: {},
      });
      continue;
    }

    const diffs = [];
    for (const { staging: sf, product: pf, label } of STAGING_FIELD_MAP) {
      if (!availableProductFields.has(pf)) continue; // field doesn't exist in this org
      const stagingVal = staging[sf] != null ? String(staging[sf]).trim() : '';
      const productVal = product[pf] != null ? String(product[pf]).trim() : '';
      // Only flag if staging has a value and it differs from the product
      if (stagingVal !== '' && stagingVal !== productVal) {
        diffs.push({ field: label, productField: pf, source: stagingVal, org: productVal });
      }
    }

    const relatedChecks = {
      hasRateTable: productIdsWithRateTable.has(productId),
    };

    if (diffs.length > 0) {
      mismatchCount++;
      rows.push({ sku, orgCode, stagingId: staging.Id, stagingStatus: staging.GT_RecordStatus__c, productId: product.Id, productCode: product.ProductCode, productName: product.Name, salesVatCode: staging.GT_SalesVatCode__c, status: 'mismatch', diffs, relatedChecks });
    } else {
      matchCount++;
      rows.push({ sku, orgCode, stagingId: staging.Id, stagingStatus: staging.GT_RecordStatus__c, productId: product.Id, productCode: product.ProductCode, productName: product.Name, salesVatCode: staging.GT_SalesVatCode__c, status: 'match', diffs: [], relatedChecks });
    }
  }

  // ── Products in org (from the SKU set) that have no active staging record ─
  const stagingSkuOrgSet = new Set(stagingRecords.map(r => `${r.GT_ItemNumber__c}::${r.GT_OrganizationCode__c}`));
  const extras = skuRecords
    .filter(s => !stagingSkuOrgSet.has(`${s.GT_ProductSKU__c}::${s.GT_OrganizationCode__c}`))
    .map(s => {
      const p = productMap.get(s.Product__c);
      return { sku: s.GT_ProductSKU__c, orgCode: s.GT_OrganizationCode__c, productId: s.Product__c, name: p?.Name || null, type: p?.GT_ProductType__c || null };
    });

  const summary = {
    totalStaging: stagingRecords.length,
    match: matchCount,
    mismatch: mismatchCount,
    missing: missingCount,
    extra: extras.length,
    missingRelated: { skuRecords: missingSku, rateTables: missingRateTable },
  };

  logger.info('Staging vs Product2 comparison complete', summary);

  return { summary, rows, extras };
}

/**
 * Generate a CSV string from a staging comparison result.
 */
function stagingComparisonToCsv(result) {
  const lines = ['SKU,StagingId,StagingStatus,ProductId,Status,Field,Staging Value,Product Value'];
  for (const row of result.rows) {
    if (row.diffs && row.diffs.length > 0) {
      for (const diff of row.diffs) {
        lines.push([row.sku, row.stagingId, row.stagingStatus || '', row.productId || '', row.status, diff.field, diff.source, diff.org]
          .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
      }
    } else {
      lines.push([row.sku, row.stagingId, row.stagingStatus || '', row.productId || '', row.status, '', '', '']
        .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    }
  }
  for (const extra of result.extras) {
    lines.push([extra.sku, '', '', extra.productId, 'extra', '', '', '']
      .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
  }
  return lines.join('\n');
}

module.exports = {
  comparePricingElementsToOrg,
  comparisonToCsv,
  compareStagingToProducts,
  stagingComparisonToCsv,
};
