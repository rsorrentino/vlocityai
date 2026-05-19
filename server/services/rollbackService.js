const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Job } = require('../models');
const catalogManagerService = require('./catalogManagerService');
const logger = require('../utils/logger');

const SNAPSHOTS_DIR = path.resolve('./snapshots');

/**
 * Rollback Service
 *
 * Manages pre-deploy snapshots and restoration.
 * Snapshots are stored as:
 *   - JSON data files in ./snapshots/{snapshotId}.json
 *   - Metadata in the jobs table (type = 'snapshot')
 */

/**
 * Create a snapshot of the catalog data in a Salesforce org.
 *
 * @param {string} username         Org to snapshot
 * @param {string} label            Human-readable label
 * @param {boolean} isAutomatic     true = triggered by a deploy job
 * @param {string} [relatedJobId]   ID of the deploy job that triggered this snapshot
 * @returns {{ snapshotId, recordCounts }}
 */
async function createSnapshot(username, label, isAutomatic = false, relatedJobId = null) {
  const snapshotId = uuidv4();

  try {
    await fs.ensureDir(SNAPSHOTS_DIR);

    logger.info('Creating catalog snapshot', { snapshotId, username, label, isAutomatic });

    // Query all catalog objects from Salesforce
    const data = await catalogManagerService.exportForSnapshot(username);

    const recordCounts = {
      priceLists: data.priceLists.length,
      promotions: data.promotions.length,
      rateCodes:  data.rateCodes.length,
      rateTables: data.rateTables.length,
      products:   data.products.length,
    };

    // Save data to file
    const filePath = path.join(SNAPSHOTS_DIR, `${snapshotId}.json`);
    await fs.writeJSON(filePath, { ...data, recordCounts }, { spaces: 2 });

    // Store metadata in jobs table (type = 'snapshot')
    await Job.create({
      id:        snapshotId,
      type:      'snapshot',
      name:      label || `Snapshot — ${username} — ${new Date().toLocaleString()}`,
      status:    'completed',
      username,
      progress:  100,
      startedAt: new Date(),
      completedAt: new Date(),
      configuration: {
        isAutomatic,
        relatedJobId: relatedJobId || null,
        filePath,
        recordCounts,
      },
      result: { success: true, recordCounts },
      logs: [{
        timestamp: new Date(),
        message: `Snapshot created: ${JSON.stringify(recordCounts)}`,
        level: 'info',
      }],
    });

    logger.info('Snapshot created successfully', { snapshotId, recordCounts });
    return { snapshotId, recordCounts };

  } catch (error) {
    logger.logError(error, { operation: 'createSnapshot', snapshotId, username });
    throw new Error(`Snapshot failed: ${error.message}`);
  }
}

/**
 * List snapshots for an org (most recent first).
 */
async function listSnapshots(username) {
  const { Op } = require('sequelize');
  const rows = await Job.findAll({
    where: { type: 'snapshot', username },
    order: [['createdAt', 'DESC']],
    limit: 50,
  });
  return rows;
}

/**
 * Get a single snapshot by ID.
 */
async function getSnapshot(snapshotId) {
  const job = await Job.findOne({ where: { id: snapshotId, type: 'snapshot' } });
  if (!job) throw new Error(`Snapshot not found: ${snapshotId}`);

  const filePath = job.configuration?.filePath;
  if (!filePath || !(await fs.pathExists(filePath))) {
    throw new Error(`Snapshot data file missing: ${filePath}`);
  }

  const data = await fs.readJSON(filePath);
  return { metadata: job, data };
}

/**
 * Restore a snapshot to a target org using Salesforce Composite Upsert API.
 *
 * Records are upserted using:
 *   - vlocity_cmt__GlobalKey__c for Vlocity objects
 *   - ProductCode for Product2
 *
 * @param {string} snapshotId
 * @param {string} targetUsername
 * @returns {{ restoreJobId, results }}
 */
async function restoreSnapshot(snapshotId, targetUsername) {
  const { data } = await getSnapshot(snapshotId);

  const summary = { success: 0, errors: 0, details: {} };

  // Helper to strip read-only Salesforce fields before upsert
  const cleanRecord = (r, keep) => {
    const cleaned = {};
    keep.forEach(f => { if (r[f] !== undefined && r[f] !== null) cleaned[f] = r[f]; });
    return cleaned;
  };

  // Price Lists
  if (data.priceLists?.length) {
    const records = data.priceLists.map(r => cleanRecord(r, [
      'Name', 'vlocity_cmt__Code__c', 'vlocity_cmt__Description__c',
      'vlocity_cmt__CurrencyCode__c', 'vlocity_cmt__IsActive__c',
      'vlocity_cmt__EffectiveFromDate__c', 'vlocity_cmt__EffectiveUntilDate__c',
      'vlocity_cmt__GlobalKey__c', 'GT_PriceListType__c', 'GT_CountryCode__c', 'GT_IsPrimary__c',
    ]));
    const res = await catalogManagerService.sfUpsertBulk(
      targetUsername, 'vlocity_cmt__PriceList__c', 'vlocity_cmt__GlobalKey__c', records
    );
    summary.success += res.results.length;
    summary.errors  += res.errors.length;
    summary.details.priceLists = { restored: res.results.length, errors: res.errors.length };
  }

  // Promotions
  if (data.promotions?.length) {
    const records = data.promotions.map(r => cleanRecord(r, [
      'Name', 'vlocity_cmt__Code__c', 'vlocity_cmt__Description__c',
      'vlocity_cmt__IsActive__c', 'vlocity_cmt__GlobalKey__c',
      'vlocity_cmt__PriceListId__c', 'GT_Type__c', 'Promotion_Trigger__c',
    ]));
    const res = await catalogManagerService.sfUpsertBulk(
      targetUsername, 'vlocity_cmt__Promotion__c', 'vlocity_cmt__GlobalKey__c', records
    );
    summary.success += res.results.length;
    summary.errors  += res.errors.length;
    summary.details.promotions = { restored: res.results.length, errors: res.errors.length };
  }

  // Rate Codes
  if (data.rateCodes?.length) {
    const records = data.rateCodes.map(r => cleanRecord(r, [
      'Name', 'GT_GlobalKey__c', 'GT_OrgCode__c',
      'GT_VATCode__c', 'GT_VATDescription__c', 'GT_VATRate__c',
      'GT_StartDate__c', 'GT_EndDate__c', 'CurrencyIsoCode',
    ]));
    const res = await catalogManagerService.sfUpsertBulk(
      targetUsername, 'GT_RateCode__c', 'GT_GlobalKey__c', records
    );
    summary.success += res.results.length;
    summary.errors  += res.errors.length;
    summary.details.rateCodes = { restored: res.results.length, errors: res.errors.length };
  }

  // Rate Tables (deploy after Rate Codes — GT_RateTable__c has a lookup to GT_RateCode__c)
  if (data.rateTables?.length) {
    const records = data.rateTables.map(r => cleanRecord(r, [
      'Name', 'GT_GlobalKey__c', 'GT_OrgCode__c',
      'Product__c', 'GT_ProductName_Text__c',
      'GT_RateCode__c', 'GT_RateDescription__c',
      'GT_StartDate__c', 'GT_EndDate__c', 'GT_VATType__c',
      'GT_UniqueKey__c', 'CurrencyIsoCode',
    ]));
    const res = await catalogManagerService.sfUpsertBulk(
      targetUsername, 'GT_RateTable__c', 'GT_GlobalKey__c', records
    );
    summary.success += res.results.length;
    summary.errors  += res.errors.length;
    summary.details.rateTables = { restored: res.results.length, errors: res.errors.length };
  }

  // Products
  if (data.products?.length) {
    const records = data.products.map(r => cleanRecord(r, [
      'Name', 'ProductCode', 'Family', 'IsActive', 'Description',
    ]));
    const res = await catalogManagerService.sfUpsertBulk(
      targetUsername, 'Product2', 'ProductCode', records
    );
    summary.success += res.results.length;
    summary.errors  += res.errors.length;
    summary.details.products = { restored: res.results.length, errors: res.errors.length };
  }

  // Record the restore operation as a job
  const restoreJobId = uuidv4();
  await Job.create({
    id:          restoreJobId,
    type:        'snapshot',
    name:        `Restore from snapshot ${snapshotId.substring(0, 8)} → ${targetUsername}`,
    status:      summary.errors === 0 ? 'completed' : 'failed',
    username:    targetUsername,
    progress:    100,
    startedAt:   new Date(),
    completedAt: new Date(),
    configuration: { restoreFromSnapshotId: snapshotId, targetUsername },
    result:      { success: summary.errors === 0, summary },
    logs: [{
      timestamp: new Date(),
      message: `Restore complete: ${summary.success} records restored, ${summary.errors} errors`,
      level: summary.errors > 0 ? 'warn' : 'info',
    }],
  });

  logger.info('Snapshot restore complete', { snapshotId, targetUsername, summary });
  return { restoreJobId, summary };
}

module.exports = { createSnapshot, listSnapshots, getSnapshot, restoreSnapshot };
