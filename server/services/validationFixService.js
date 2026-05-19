const { randomUUID } = require('crypto');
const salesforceService = require('./salesforceService');
const logger = require('../utils/logger');

// ─── Fix Registry ─────────────────────────────────────────────────────────────
// Maps the raw check name (as stored in validation result's `check` field)
// to fix configuration.

const FIX_REGISTRY = {
  // ══ Type A — assign_global_keys (non-destructive update) ═══════════════════
  Product2MissingGlobalKey: {
    fixType: 'assign_global_keys',
    label: 'Assign Global Keys to Products',
    objectType: 'Product2',
    field: 'vlocity_cmt__GlobalKey__c',
    query: "SELECT Id FROM Product2 WHERE vlocity_cmt__GlobalKey__c = null AND IsActive = true",
  },
  PriceListMissingGlobalKey: {
    fixType: 'assign_global_keys',
    label: 'Assign Global Keys to Price Lists',
    objectType: 'vlocity_cmt__PriceList__c',
    field: 'vlocity_cmt__GlobalKey__c',
    query: "SELECT Id FROM vlocity_cmt__PriceList__c WHERE vlocity_cmt__GlobalKey__c = null AND vlocity_cmt__IsActive__c = true",
  },
  PriceListEntryMissingGlobalKey: {
    fixType: 'assign_global_keys',
    label: 'Assign Global Keys to Price List Entries',
    objectType: 'vlocity_cmt__PriceListEntry__c',
    field: 'vlocity_cmt__GlobalKey__c',
    query: "SELECT Id FROM vlocity_cmt__PriceListEntry__c WHERE vlocity_cmt__GlobalKey__c = null",
  },
  PricingElementMissingGlobalKey: {
    fixType: 'assign_global_keys',
    label: 'Assign Global Keys to Pricing Elements',
    objectType: 'vlocity_cmt__PricingElement__c',
    field: 'vlocity_cmt__GlobalKey__c',
    query: "SELECT Id FROM vlocity_cmt__PricingElement__c WHERE vlocity_cmt__GlobalKey__c = null",
  },
  AttributeMissingGlobalKey: {
    fixType: 'assign_global_keys',
    label: 'Assign Global Keys to Attributes',
    objectType: 'vlocity_cmt__Attribute__c',
    field: 'vlocity_cmt__GlobalKey__c',
    query: "SELECT Id FROM vlocity_cmt__Attribute__c WHERE vlocity_cmt__GlobalKey__c = null",
  },
  AttributeCategoryMissingGlobalKey: {
    fixType: 'assign_global_keys',
    label: 'Assign Global Keys to Attribute Categories',
    objectType: 'vlocity_cmt__AttributeCategory__c',
    field: 'vlocity_cmt__GlobalKey__c',
    query: "SELECT Id FROM vlocity_cmt__AttributeCategory__c WHERE vlocity_cmt__GlobalKey__c = null",
  },
  PicklistMissingGlobalKey: {
    fixType: 'assign_global_keys',
    label: 'Assign Global Keys to Picklists',
    objectType: 'vlocity_cmt__Picklist__c',
    field: 'vlocity_cmt__GlobalKey__c',
    query: "SELECT Id FROM vlocity_cmt__Picklist__c WHERE vlocity_cmt__GlobalKey__c = null",
  },
  ProductChildItemMissingGlobalKey: {
    fixType: 'assign_global_keys',
    label: 'Assign Global Keys to Product Child Items',
    objectType: 'vlocity_cmt__ProductChildItem__c',
    field: 'vlocity_cmt__GlobalKey__c',
    query: "SELECT Id FROM vlocity_cmt__ProductChildItem__c WHERE vlocity_cmt__GlobalKey__c = null",
  },
  AttributeAssignmentMissingGlobalKey: {
    fixType: 'assign_global_keys',
    label: 'Assign Global Keys to Attribute Assignments',
    objectType: 'vlocity_cmt__AttributeAssignment__c',
    field: 'vlocity_cmt__GlobalKey__c',
    query: "SELECT Id FROM vlocity_cmt__AttributeAssignment__c WHERE vlocity_cmt__GlobalKey__c = null",
  },
  RuleMissingGlobalKey: {
    fixType: 'assign_global_keys',
    label: 'Assign Global Keys to Rules',
    objectType: 'vlocity_cmt__Rule__c',
    field: 'vlocity_cmt__GlobalKey__c',
    query: "SELECT Id FROM vlocity_cmt__Rule__c WHERE vlocity_cmt__GlobalKey__c = null",
  },
  CalculationMatrixMissingGlobalKey: {
    fixType: 'assign_global_keys',
    label: 'Assign Global Keys to Calculation Matrices',
    objectType: 'vlocity_cmt__CalculationMatrix__c',
    field: 'vlocity_cmt__GlobalKey__c',
    query: "SELECT Id FROM vlocity_cmt__CalculationMatrix__c WHERE vlocity_cmt__GlobalKey__c = null",
  },
  ObjectLayoutMissingGlobalKey: {
    fixType: 'assign_global_keys',
    label: 'Assign Global Keys to Object Layouts',
    objectType: 'vlocity_cmt__ObjectLayout__c',
    field: 'vlocity_cmt__GlobalKey__c',
    query: "SELECT Id FROM vlocity_cmt__ObjectLayout__c WHERE vlocity_cmt__GlobalKey__c = null",
  },
  UISectionMissingGlobalKey: {
    fixType: 'assign_global_keys',
    label: 'Assign Global Keys to UI Sections',
    objectType: 'vlocity_cmt__UISection__c',
    field: 'vlocity_cmt__GlobalKey__c',
    query: "SELECT Id FROM vlocity_cmt__UISection__c WHERE vlocity_cmt__GlobalKey__c = null",
  },
  UIFacetMissingGlobalKey: {
    fixType: 'assign_global_keys',
    label: 'Assign Global Keys to UI Facets',
    objectType: 'vlocity_cmt__UIFacet__c',
    field: 'vlocity_cmt__GlobalKey__c',
    query: "SELECT Id FROM vlocity_cmt__UIFacet__c WHERE vlocity_cmt__GlobalKey__c = null",
  },
  ObjectClassMissingGlobalKey: {
    fixType: 'assign_global_keys',
    label: 'Assign Global Keys to Object Classes',
    objectType: 'vlocity_cmt__ObjectClass__c',
    field: 'vlocity_cmt__GlobalKey__c',
    query: "SELECT Id FROM vlocity_cmt__ObjectClass__c WHERE vlocity_cmt__GlobalKey__c = null",
  },

  // ══ Type B — delete_orphaned (destructive, but deterministic) ══════════════
  OrphanedProductChildItems: {
    fixType: 'delete_orphaned',
    label: 'Delete orphaned Product Child Items',
    objectType: 'vlocity_cmt__ProductChildItem__c',
    query: "SELECT Id FROM vlocity_cmt__ProductChildItem__c WHERE vlocity_cmt__ParentProductId__c = null OR vlocity_cmt__ChildProductId__c = null",
  },
  OrphanedCatalogProductRelationships: {
    fixType: 'delete_orphaned',
    label: 'Delete orphaned Catalog-Product Relationships',
    objectType: 'vlocity_cmt__CatalogProductRelationship__c',
    query: "SELECT Id FROM vlocity_cmt__CatalogProductRelationship__c WHERE vlocity_cmt__CatalogId__c = null OR vlocity_cmt__Product2Id__c = null",
  },
  OrphanedAttributeAssignments: {
    fixType: 'delete_orphaned',
    label: 'Delete orphaned Attribute Assignments',
    objectType: 'vlocity_cmt__AttributeAssignment__c',
    query: "SELECT Id FROM vlocity_cmt__AttributeAssignment__c WHERE vlocity_cmt__ObjectId__c = null OR vlocity_cmt__AttributeId__c = null",
  },
  OrphanedPicklistValues: {
    fixType: 'delete_orphaned',
    label: 'Delete orphaned Picklist Values',
    objectType: 'vlocity_cmt__PicklistValue__c',
    query: "SELECT Id FROM vlocity_cmt__PicklistValue__c WHERE vlocity_cmt__PicklistId__c = null",
  },
  PriceListEntriesWithoutProduct: {
    fixType: 'delete_orphaned',
    label: 'Delete Price List Entries without a Product',
    objectType: 'vlocity_cmt__PriceListEntry__c',
    query: "SELECT Id FROM vlocity_cmt__PriceListEntry__c WHERE vlocity_cmt__ProductId__c = null",
  },
  PriceListEntriesWithoutPriceList: {
    fixType: 'delete_orphaned',
    label: 'Delete Price List Entries without a Price List',
    objectType: 'vlocity_cmt__PriceListEntry__c',
    query: "SELECT Id FROM vlocity_cmt__PriceListEntry__c WHERE vlocity_cmt__PriceListId__c = null",
  },
  ObjectLayoutWithoutObjectClass: {
    fixType: 'delete_orphaned',
    label: 'Delete Object Layouts without an Object Class',
    objectType: 'vlocity_cmt__ObjectLayout__c',
    query: "SELECT Id FROM vlocity_cmt__ObjectLayout__c WHERE vlocity_cmt__ObjectClassId__c = null",
  },
  UISectionWithoutObjectLayout: {
    fixType: 'delete_orphaned',
    label: 'Delete UI Sections without an Object Layout',
    objectType: 'vlocity_cmt__UISection__c',
    query: "SELECT Id FROM vlocity_cmt__UISection__c WHERE vlocity_cmt__ObjectLayoutId__c = null",
  },
  UIFacetWithoutUISection: {
    fixType: 'delete_orphaned',
    label: 'Delete UI Facets without a UI Section',
    objectType: 'vlocity_cmt__UIFacet__c',
    query: "SELECT Id FROM vlocity_cmt__UIFacet__c WHERE vlocity_cmt__UISectionId__c = null",
  },

  // ══ Type C — delete_duplicates (interactive review, user selects keeper) ═══
  DuplicateProductChildItems: {
    fixType: 'delete_duplicates',
    label: 'Duplicate Product Child Items',
    objectType: 'vlocity_cmt__ProductChildItem__c',
    groupFields: ['vlocity_cmt__ParentProductId__c', 'vlocity_cmt__ChildProductId__c'],
    displayFields: ['Name', 'CreatedDate', 'LastModifiedDate'],
    query: "SELECT Id, Name, vlocity_cmt__ParentProductId__c, vlocity_cmt__ChildProductId__c, CreatedDate, LastModifiedDate FROM vlocity_cmt__ProductChildItem__c WHERE vlocity_cmt__ParentProductId__c != null AND vlocity_cmt__ChildProductId__c != null ORDER BY CreatedDate ASC",
  },
  DuplicateCatalogProductRelationships: {
    fixType: 'delete_duplicates',
    label: 'Duplicate Catalog-Product Relationships',
    objectType: 'vlocity_cmt__CatalogProductRelationship__c',
    groupFields: ['vlocity_cmt__CatalogId__c', 'vlocity_cmt__Product2Id__c'],
    displayFields: ['Name', 'CreatedDate', 'LastModifiedDate'],
    query: "SELECT Id, Name, vlocity_cmt__CatalogId__c, vlocity_cmt__Product2Id__c, CreatedDate, LastModifiedDate FROM vlocity_cmt__CatalogProductRelationship__c WHERE vlocity_cmt__CatalogId__c != null AND vlocity_cmt__Product2Id__c != null ORDER BY CreatedDate ASC",
  },
  DuplicateAttributeAssignments: {
    fixType: 'delete_duplicates',
    label: 'Duplicate Attribute Assignments',
    objectType: 'vlocity_cmt__AttributeAssignment__c',
    groupFields: ['vlocity_cmt__ObjectId__c', 'vlocity_cmt__AttributeId__c'],
    displayFields: ['Name', 'CreatedDate', 'LastModifiedDate'],
    query: "SELECT Id, Name, vlocity_cmt__ObjectId__c, vlocity_cmt__AttributeId__c, CreatedDate, LastModifiedDate FROM vlocity_cmt__AttributeAssignment__c WHERE vlocity_cmt__ObjectId__c != null AND vlocity_cmt__AttributeId__c != null ORDER BY CreatedDate ASC",
  },
  DuplicatePriceListEntries: {
    fixType: 'delete_duplicates',
    label: 'Duplicate Price List Entries',
    objectType: 'vlocity_cmt__PriceListEntry__c',
    groupFields: ['vlocity_cmt__PriceListId__c', 'vlocity_cmt__ProductId__c'],
    displayFields: ['Name', 'CreatedDate', 'LastModifiedDate'],
    query: "SELECT Id, Name, vlocity_cmt__PriceListId__c, vlocity_cmt__ProductId__c, CreatedDate, LastModifiedDate FROM vlocity_cmt__PriceListEntry__c WHERE vlocity_cmt__PriceListId__c != null AND vlocity_cmt__ProductId__c != null ORDER BY CreatedDate ASC",
  },
  DuplicateObjectLayoutsPerObjectClass: {
    fixType: 'delete_duplicates',
    label: 'Duplicate Object Layouts per Object Class',
    objectType: 'vlocity_cmt__ObjectLayout__c',
    groupFields: ['vlocity_cmt__ObjectClassId__c'],
    displayFields: ['Name', 'CreatedDate', 'vlocity_cmt__IsActive__c'],
    query: "SELECT Id, Name, vlocity_cmt__ObjectClassId__c, CreatedDate, vlocity_cmt__IsActive__c FROM vlocity_cmt__ObjectLayout__c WHERE vlocity_cmt__ObjectClassId__c != null AND vlocity_cmt__IsActive__c = true ORDER BY CreatedDate ASC",
  },
  DuplicateUISection: {
    fixType: 'delete_duplicates',
    label: 'Duplicate UI Sections',
    objectType: 'vlocity_cmt__UISection__c',
    groupFields: ['Name'],
    displayFields: ['Name', 'CreatedDate', 'LastModifiedDate'],
    query: "SELECT Id, Name, CreatedDate, LastModifiedDate FROM vlocity_cmt__UISection__c ORDER BY Name ASC, CreatedDate ASC",
  },
  DuplicatePricingElements: {
    fixType: 'delete_duplicates',
    label: 'Duplicate Pricing Elements',
    objectType: 'vlocity_cmt__PricingElement__c',
    groupFields: ['Name'],
    displayFields: ['Name', 'CreatedDate', 'vlocity_cmt__Amount__c', 'vlocity_cmt__PriceListId__c'],
    query: "SELECT Id, Name, CreatedDate, vlocity_cmt__Amount__c, vlocity_cmt__PriceListId__c FROM vlocity_cmt__PricingElement__c WHERE vlocity_cmt__IsActive__c = true ORDER BY Name ASC, CreatedDate ASC",
  },
  DuplicatePicklists: {
    fixType: 'delete_duplicates',
    label: 'Duplicate Picklists',
    objectType: 'vlocity_cmt__Picklist__c',
    groupFields: ['Name'],
    displayFields: ['Name', 'CreatedDate', 'vlocity_cmt__IsActive__c'],
    query: "SELECT Id, Name, CreatedDate, vlocity_cmt__IsActive__c FROM vlocity_cmt__Picklist__c ORDER BY Name ASC, CreatedDate ASC",
  },
  DuplicatePriceLists: {
    fixType: 'delete_duplicates',
    label: 'Duplicate Price Lists',
    objectType: 'vlocity_cmt__PriceList__c',
    groupFields: ['vlocity_cmt__Code__c'],
    displayFields: ['Name', 'vlocity_cmt__Code__c', 'CreatedDate', 'vlocity_cmt__IsActive__c'],
    query: "SELECT Id, Name, vlocity_cmt__Code__c, CreatedDate, vlocity_cmt__IsActive__c FROM vlocity_cmt__PriceList__c WHERE vlocity_cmt__Code__c != null AND vlocity_cmt__IsActive__c = true ORDER BY vlocity_cmt__Code__c ASC, CreatedDate ASC",
  },
  DuplicatePricingVariables: {
    fixType: 'delete_duplicates',
    label: 'Duplicate Pricing Variables',
    objectType: 'vlocity_cmt__PricingVariable__c',
    groupFields: ['vlocity_cmt__Code__c'],
    displayFields: ['Name', 'vlocity_cmt__Code__c', 'CreatedDate', 'vlocity_cmt__IsActive__c'],
    query: "SELECT Id, Name, vlocity_cmt__Code__c, CreatedDate, vlocity_cmt__IsActive__c FROM vlocity_cmt__PricingVariable__c WHERE vlocity_cmt__Code__c != null AND vlocity_cmt__IsActive__c = true ORDER BY vlocity_cmt__Code__c ASC, CreatedDate ASC",
  },
  DuplicateAttributes: {
    fixType: 'delete_duplicates',
    label: 'Duplicate Attributes',
    objectType: 'vlocity_cmt__Attribute__c',
    groupFields: ['Name'],
    displayFields: ['Name', 'CreatedDate', 'LastModifiedDate'],
    query: "SELECT Id, Name, CreatedDate, LastModifiedDate FROM vlocity_cmt__Attribute__c ORDER BY Name ASC, CreatedDate ASC",
  },
  DuplicateAttributeCategories: {
    fixType: 'delete_duplicates',
    label: 'Duplicate Attribute Categories',
    objectType: 'vlocity_cmt__AttributeCategory__c',
    groupFields: ['Name'],
    displayFields: ['Name', 'CreatedDate', 'LastModifiedDate'],
    query: "SELECT Id, Name, CreatedDate, LastModifiedDate FROM vlocity_cmt__AttributeCategory__c ORDER BY Name ASC, CreatedDate ASC",
  },
};

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the label for a check, or null if not fixable.
 */
function getFixConfig(checkName) {
  return FIX_REGISTRY[checkName] || null;
}

/**
 * Preview: returns the number of records that would be affected by a simple fix.
 * Only valid for Type A (assign_global_keys) and Type B (delete_orphaned) checks.
 */
async function previewFix(username, checkName) {
  const cfg = FIX_REGISTRY[checkName];
  if (!cfg) throw new Error(`No fix registered for check: ${checkName}`);
  if (cfg.fixType === 'delete_duplicates') throw new Error('Use getDuplicateGroups for duplicate checks');

  await salesforceService.authenticateWithSfdx(username);
  // Replace "SELECT Id FROM" with "SELECT COUNT() FROM" to get totalSize without fetching records
  const countQuery = cfg.query.replace(/^SELECT\s+Id\s+FROM/i, 'SELECT COUNT() FROM');
  const result = await salesforceService.query(countQuery);
  return { count: result.totalSize, label: cfg.label, fixType: cfg.fixType };
}

/**
 * Apply a simple fix (Type A or B) directly.
 * Returns { recordsAffected, message }.
 */
async function applyFix(username, checkName) {
  const cfg = FIX_REGISTRY[checkName];
  if (!cfg) throw new Error(`No fix registered for check: ${checkName}`);
  if (cfg.fixType === 'delete_duplicates') throw new Error('Use resolveSelectedDuplicates for duplicate checks');

  await salesforceService.authenticateWithSfdx(username);

  if (cfg.fixType === 'assign_global_keys') {
    return _assignGlobalKeys(cfg);
  }
  if (cfg.fixType === 'delete_orphaned') {
    return _deleteOrphaned(cfg);
  }
  throw new Error(`Unknown fixType: ${cfg.fixType}`);
}

/**
 * Fetch grouped duplicate records for the review dialog (Type C).
 * Returns { groups, objectType, checkName, label }.
 * Each group: { key, keyLabel, records: [{ id, name, createdDate, ...fields }] }
 * Groups are ordered by group key; within each group, oldest record is first.
 */
async function getDuplicateGroups(username, checkName) {
  const cfg = FIX_REGISTRY[checkName];
  if (!cfg) throw new Error(`No fix registered for check: ${checkName}`);
  if (cfg.fixType !== 'delete_duplicates') throw new Error('This check is not a duplicate check');

  await salesforceService.authenticateWithSfdx(username);

  const records = await _queryAll(cfg.query);

  // Group by composite key
  const groupMap = new Map();
  for (const rec of records) {
    const key = cfg.groupFields.map(f => rec[f] || '').join('::');
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(rec);
  }

  // Keep only groups with duplicates (> 1 record)
  const groups = [];
  for (const [key, groupRecords] of groupMap) {
    if (groupRecords.length < 2) continue;
    // Records are already sorted by CreatedDate ASC (oldest first) from the query ORDER BY
    const keyLabel = cfg.groupFields.map((f, i) => {
      const label = f.replace(/^vlocity_cmt__/, '').replace(/__c$/, '').replace(/__r$/, '');
      return `${label}: ${groupRecords[0][f] || 'null'}`;
    }).join(' / ');

    groups.push({
      key,
      keyLabel,
      records: groupRecords.map(r => ({
        id: r.Id,
        name: r.Name || r.Id,
        createdDate: r.CreatedDate,
        lastModifiedDate: r.LastModifiedDate,
        fields: _extractDisplayFields(r, cfg.displayFields),
      })),
    });
  }

  return {
    groups,
    objectType: cfg.objectType,
    checkName,
    label: cfg.label,
    totalDuplicates: groups.reduce((sum, g) => sum + g.records.length - 1, 0),
  };
}

/**
 * Apply the user's keeper selections for a duplicate check.
 * deleteIds: array of Salesforce record IDs to delete.
 * Returns { recordsDeleted, message }.
 */
async function resolveSelectedDuplicates(username, checkName, deleteIds) {
  const cfg = FIX_REGISTRY[checkName];
  if (!cfg) throw new Error(`No fix registered for check: ${checkName}`);
  if (!Array.isArray(deleteIds) || deleteIds.length === 0) {
    return { recordsDeleted: 0, message: 'No records selected for deletion' };
  }

  await salesforceService.authenticateWithSfdx(username);
  const deleted = await _bulkDelete(cfg.objectType, deleteIds);
  logger.info('Resolved duplicate records', { checkName, objectType: cfg.objectType, deleted });
  return { recordsDeleted: deleted, message: `Deleted ${deleted} duplicate records from ${cfg.objectType}` };
}

// ─── Internal Helpers ──────────────────────────────────────────────────────────

async function _assignGlobalKeys(cfg) {
  const records = await _queryAll(cfg.query);
  if (records.length === 0) return { recordsAffected: 0, message: 'No records needed a Global Key' };

  const updates = records.map(r => ({ id: r.Id, fields: { [cfg.field]: randomUUID() } }));
  const updated = await _bulkUpdate(cfg.objectType, updates);
  logger.info('Assigned Global Keys', { objectType: cfg.objectType, count: updated });
  return { recordsAffected: updated, message: `Assigned Global Key to ${updated} ${cfg.objectType} records` };
}

async function _deleteOrphaned(cfg) {
  const records = await _queryAll(cfg.query);
  if (records.length === 0) return { recordsAffected: 0, message: 'No orphaned records found' };

  const ids = records.map(r => r.Id);
  const deleted = await _bulkDelete(cfg.objectType, ids);
  logger.info('Deleted orphaned records', { objectType: cfg.objectType, count: deleted });
  return { recordsAffected: deleted, message: `Deleted ${deleted} orphaned ${cfg.objectType} records` };
}

/**
 * Query all records, following nextRecordsUrl for pagination.
 */
async function _queryAll(soql) {
  const axios = require('axios');
  const allRecords = [];

  let result = await salesforceService.query(soql);
  allRecords.push(...(result.records || []));

  while (!result.done && result.nextRecordsUrl) {
    const moreResult = await axios.get(
      `${salesforceService.instanceUrl}${result.nextRecordsUrl}`,
      { headers: { Authorization: `Bearer ${salesforceService.accessToken}` } }
    );
    result = moreResult.data;
    allRecords.push(...(result.records || []));
  }

  return allRecords;
}

/**
 * Bulk delete records in chunks of 25 via the Composite API.
 * Returns total count of successfully deleted records.
 */
async function _bulkDelete(objectType, ids) {
  const apiVersion = salesforceService.apiVersion;
  let deleted = 0;

  for (let i = 0; i < ids.length; i += 25) {
    const chunk = ids.slice(i, i + 25);
    const compositeRequest = chunk.map((id, idx) => ({
      method: 'DELETE',
      url: `/services/data/${apiVersion}/sobjects/${objectType}/${id}`,
      referenceId: `del${i + idx}`,
    }));

    try {
      const response = await salesforceService.composite(compositeRequest);
      const compositeResults = response.compositeResponse || [];
      deleted += compositeResults.filter(r => r.httpStatusCode >= 200 && r.httpStatusCode < 300).length;
    } catch (err) {
      logger.error('Bulk delete chunk failed', { objectType, chunkStart: i, err: err.message });
    }
  }

  return deleted;
}

/**
 * Bulk update records in chunks of 25 via the Composite API.
 * updates: [{ id, fields: { fieldName: value } }]
 * Returns total count of successfully updated records.
 */
async function _bulkUpdate(objectType, updates) {
  const apiVersion = salesforceService.apiVersion;
  let updated = 0;

  for (let i = 0; i < updates.length; i += 25) {
    const chunk = updates.slice(i, i + 25);
    const compositeRequest = chunk.map((upd, idx) => ({
      method: 'PATCH',
      url: `/services/data/${apiVersion}/sobjects/${objectType}/${upd.id}`,
      referenceId: `upd${i + idx}`,
      body: upd.fields,
    }));

    try {
      const response = await salesforceService.composite(compositeRequest);
      const compositeResults = response.compositeResponse || [];
      updated += compositeResults.filter(r => r.httpStatusCode >= 200 && r.httpStatusCode < 300).length;
    } catch (err) {
      logger.error('Bulk update chunk failed', { objectType, chunkStart: i, err: err.message });
    }
  }

  return updated;
}

function _extractDisplayFields(record, displayFields) {
  const out = {};
  for (const f of displayFields) {
    if (record[f] !== undefined) out[f] = record[f];
  }
  return out;
}

module.exports = {
  getFixConfig,
  previewFix,
  applyFix,
  getDuplicateGroups,
  resolveSelectedDuplicates,
  FIX_REGISTRY,
};
