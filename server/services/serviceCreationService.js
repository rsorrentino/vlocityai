'use strict';

const fs = require('fs-extra');
const path = require('path');
const { parse } = require('csv-parse/sync');
const axios = require('axios');
const sfdxAuthService = require('./sfdxAuthService');
const logger = require('../utils/logger');

const mapping = require('../config/service-creation-mapping.json');
const API_VERSION = process.env.SALESFORCE_API_VERSION || 'v59.0';

// ── CSV helpers ────────────────────────────────────────────────────────────────

/**
 * Parse a CSV file and return { headers, rows }.
 * rows is an array of plain objects keyed by header name.
 */
function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });
  const headers = records.length > 0 ? Object.keys(records[0]) : [];
  return { headers, rows: records };
}

// ── Price file ─────────────────────────────────────────────────────────────────

/**
 * Validate price file rows.
 * Returns { valid, invalid, warnings } where invalid rows carry a reason string.
 */
function validatePriceRows(rows) {
  const cfg = mapping.priceFile;
  const valid = [];
  const invalid = [];
  const warnings = [];

  rows.forEach((row, idx) => {
    const lineNum = idx + 2; // +2: header is line 1, rows start at line 2
    const missing = cfg.requiredColumns.filter(col => !row[col] || String(row[col]).trim() === '');
    if (missing.length > 0) {
      invalid.push({ row, lineNum, reason: `Missing required column(s): ${missing.join(', ')}` });
      return;
    }

    const amount = parseFloat(row['Amount']);
    if (isNaN(amount)) {
      invalid.push({ row, lineNum, reason: `Amount is not a valid number: "${row['Amount']}"` });
      return;
    }

    if (row['EffectiveStartDate'] && !/^\d{4}-\d{2}-\d{2}/.test(row['EffectiveStartDate'].trim())) {
      warnings.push({ lineNum, message: `EffectiveStartDate "${row['EffectiveStartDate']}" is not ISO format (YYYY-MM-DD) — will be sent as-is` });
    }

    valid.push(row);
  });

  return { valid, invalid, warnings };
}

/**
 * Normalise validated price rows into a consistent shape for processing.
 */
function normalisePriceRows(rows) {
  return rows.map(row => {
    const sku = String(row['ItemNumberSKU']).trim();
    const priceListName = String(row['PriceList']).trim();
    const pricingVariableName = String(row['PricingVariable']).trim();
    const globalKey = `${sku}_${priceListName}_${pricingVariableName}`;
    return {
      sku,
      priceListName,
      pricingVariableName,
      amount: parseFloat(row['Amount']),
      effectiveStartDate: row['EffectiveStartDate'] ? String(row['EffectiveStartDate']).trim() : null,
      globalKey,
    };
  });
}

// ── Salesforce helpers ─────────────────────────────────────────────────────────

async function getOrgConnection(username) {
  const auth = await sfdxAuthService.getAccessToken(username);
  const { accessToken, instanceUrl } = auth;
  const baseUrl = `${instanceUrl}/services/data/${API_VERSION}`;
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  return { accessToken, instanceUrl, baseUrl, headers };
}

/**
 * Query all records for a SOQL, following pagination.
 */
async function queryAll(conn, soql) {
  let records = [];
  let url = `${conn.baseUrl}/query`;
  let params = { q: soql };

  while (url) {
    const response = await axios.get(url, { params, headers: conn.headers, timeout: 60000 });
    records = records.concat(response.data.records || []);
    if (!response.data.done && response.data.nextRecordsUrl) {
      url = `${conn.instanceUrl}${response.data.nextRecordsUrl}`;
      params = undefined;
    } else {
      url = null;
    }
  }
  return records;
}

/**
 * Upsert a single record using an external ID field.
 * Returns { status, id, errors }.
 */
async function upsertRecord(conn, sobjectType, externalIdField, externalIdValue, body) {
  const url = `${conn.baseUrl}/sobjects/${sobjectType}/${externalIdField}/${encodeURIComponent(externalIdValue)}`;
  try {
    const response = await axios.patch(url, body, { headers: conn.headers, timeout: 30000 });
    const created = response.status === 201;
    return {
      status: created ? 'created' : 'updated',
      id: response.data?.id || null,
      errors: [],
    };
  } catch (err) {
    const sfErrors = err.response?.data;
    const message = Array.isArray(sfErrors)
      ? sfErrors.map(e => `${e.errorCode}: ${e.message}`).join('; ')
      : err.message;
    return { status: 'error', id: null, errors: [message] };
  }
}

/**
 * Build an IN clause string from an array of values.
 * Handles numbers and strings safely.
 */
function inClause(values) {
  return values.map(v => `'${String(v).replace(/'/g, "\\'")}'`).join(', ');
}

// ── Main upsert: Pricing Elements ──────────────────────────────────────────────

/**
 * Upsert PriceListEntry (ensure product is on price list) and PricingElement
 * records from normalised price rows.
 *
 * @param {Array}  normalisedRows  - output of normalisePriceRows()
 * @param {string} username        - SFDX username
 * @param {object} options         - { onProgress } optional progress callback
 * @returns {UpsertResult}
 */
async function upsertPricingElementsToOrg(normalisedRows, username, options = {}) {
  const { onProgress } = options;
  const conn = await getOrgConnection(username);

  const report = {
    total: normalisedRows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    rows: [],
  };

  if (normalisedRows.length === 0) return report;

  // ── Pre-flight batch lookups ────────────────────────────────────────────────
  const skus = [...new Set(normalisedRows.map(r => r.sku))];
  const priceListNames = [...new Set(normalisedRows.map(r => r.priceListName))];
  const pvNames = [...new Set(normalisedRows.map(r => r.pricingVariableName))];

  const [productRecords, priceListRecords, pvRecords] = await Promise.all([
    queryAll(conn, `SELECT Id, ProductCode FROM Product2 WHERE ProductCode IN (${inClause(skus)})`),
    queryAll(conn, `SELECT Id, Name FROM vlocity_cmt__PriceList__c WHERE Name IN (${inClause(priceListNames)})`),
    queryAll(conn, `SELECT Id, Name FROM vlocity_cmt__PricingVariable__c WHERE Name IN (${inClause(pvNames)})`),
  ]);

  const productMap = new Map(productRecords.map(r => [r.ProductCode, r.Id]));
  const priceListMap = new Map(priceListRecords.map(r => [r.Name, r.Id]));
  const pvMap = new Map(pvRecords.map(r => [r.Name, r.Id]));

  logger.info('Service creation: preflight lookups complete', {
    products: productMap.size,
    priceLists: priceListMap.size,
    pricingVariables: pvMap.size,
  });

  // ── Check existing PriceListEntries (avoid duplicates) ─────────────────────
  // Build list of (ProductId, PriceListId) pairs we need to ensure exist
  const plePairs = [];
  for (const row of normalisedRows) {
    const productId = productMap.get(row.sku);
    const priceListId = priceListMap.get(row.priceListName);
    if (productId && priceListId) {
      plePairs.push({ productId, priceListId, key: `${productId}::${priceListId}` });
    }
  }
  const uniquePairs = [...new Map(plePairs.map(p => [p.key, p])).values()];

  let existingPLEKeys = new Set();
  if (uniquePairs.length > 0) {
    const productIds = [...new Set(uniquePairs.map(p => p.productId))];
    const plIds = [...new Set(uniquePairs.map(p => p.priceListId))];
    const existingPLEs = await queryAll(
      conn,
      `SELECT vlocity_cmt__ProductId__c, vlocity_cmt__PriceList2Id__c FROM vlocity_cmt__PriceListEntry__c WHERE vlocity_cmt__ProductId__c IN (${inClause(productIds)}) AND vlocity_cmt__PriceList2Id__c IN (${inClause(plIds)})`
    );
    existingPLEKeys = new Set(existingPLEs.map(r => `${r.vlocity_cmt__ProductId__c}::${r.vlocity_cmt__PriceList2Id__c}`));
  }

  // ── Process each row ────────────────────────────────────────────────────────
  let processed = 0;
  for (const row of normalisedRows) {
    const rowResult = {
      sku: row.sku,
      priceList: row.priceListName,
      pricingVariable: row.pricingVariableName,
      globalKey: row.globalKey,
      status: null,
      priceListEntryStatus: null,
      errors: [],
    };

    const productId = productMap.get(row.sku);
    const priceListId = priceListMap.get(row.priceListName);
    const pvId = pvMap.get(row.pricingVariableName);

    // Validate lookups
    if (!productId) {
      rowResult.status = 'skipped';
      rowResult.errors.push(`Product with SKU "${row.sku}" not found in org`);
      report.skipped++;
      report.rows.push(rowResult);
      continue;
    }
    if (!priceListId) {
      rowResult.status = 'error';
      rowResult.errors.push(`PriceList "${row.priceListName}" not found in org`);
      report.errors++;
      report.rows.push(rowResult);
      continue;
    }
    if (!pvId) {
      rowResult.status = 'error';
      rowResult.errors.push(`PricingVariable "${row.pricingVariableName}" not found in org`);
      report.errors++;
      report.rows.push(rowResult);
      continue;
    }

    // ── Step 1: Ensure PriceListEntry exists ──────────────────────────────────
    const pleKey = `${productId}::${priceListId}`;
    if (!existingPLEKeys.has(pleKey)) {
      const pleResult = await upsertRecord(
        conn,
        'vlocity_cmt__PriceListEntry__c',
        'vlocity_cmt__GlobalKey__c',
        `${row.sku}_${row.priceListName}`,
        {
          vlocity_cmt__ProductId__c: productId,
          vlocity_cmt__PriceList2Id__c: priceListId,
          vlocity_cmt__GlobalKey__c: `${row.sku}_${row.priceListName}`,
          Name: `${row.sku} - ${row.priceListName}`,
        }
      );
      rowResult.priceListEntryStatus = pleResult.status;
      if (pleResult.status === 'error') {
        rowResult.errors.push(`PriceListEntry: ${pleResult.errors.join('; ')}`);
        // Don't block PricingElement creation on PLE errors — log and continue
      } else {
        existingPLEKeys.add(pleKey); // mark as known for subsequent rows
      }
    } else {
      rowResult.priceListEntryStatus = 'exists';
    }

    // ── Step 2: Upsert PricingElement ─────────────────────────────────────────
    const peBody = {
      vlocity_cmt__GlobalKey__c: row.globalKey,
      vlocity_cmt__ProductId__c: productId,
      vlocity_cmt__PriceListId__c: priceListId,
      vlocity_cmt__PricingVariableId__c: pvId,
      vlocity_cmt__Amount__c: row.amount,
      vlocity_cmt__IsActive__c: true,
    };
    if (row.effectiveStartDate) {
      peBody.vlocity_cmt__EffectiveFromDate__c = row.effectiveStartDate;
    }

    const peResult = await upsertRecord(
      conn,
      'vlocity_cmt__PricingElement__c',
      'vlocity_cmt__GlobalKey__c',
      row.globalKey,
      peBody
    );

    rowResult.status = peResult.status;
    if (peResult.status === 'error') {
      rowResult.errors.push(...peResult.errors);
      report.errors++;
    } else if (peResult.status === 'created') {
      report.created++;
    } else {
      report.updated++;
    }

    report.rows.push(rowResult);
    processed++;

    if (onProgress && processed % 10 === 0) {
      onProgress(Math.round((processed / normalisedRows.length) * 100));
    }
  }

  logger.info('Service creation: upsert complete', {
    total: report.total,
    created: report.created,
    updated: report.updated,
    skipped: report.skipped,
    errors: report.errors,
  });

  return report;
}

module.exports = {
  parseCSV,
  validatePriceRows,
  normalisePriceRows,
  upsertPricingElementsToOrg,
  // Exported for use by comparison service
  getOrgConnection,
  queryAll,
  inClause,
};
