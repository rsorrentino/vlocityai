const axios = require('axios');
const path = require('path');
const fs = require('fs-extra');
const yaml = require('yaml');
const sfdxAuthService = require('./sfdxAuthService');
const logger = require('../utils/logger');

/**
 * Per-org object definitions.
 *
 * Fields:
 *   label          — human-readable name shown in the UI
 *   soql           — SOQL to fetch all records needed for comparison
 *   globalKeyField — field used as cross-org unique key (null for composite-key objects)
 *   compositeKeyFn — function(record) → string, used when globalKeyField is null
 *   nameFn         — function(record) → string for display when no Name field exists
 *   vlocityType    — VlocityDataPackType for the export job YAML
 *   syncBy         — 'globalKey' (default) | 'id'
 *                    'id' = use source record Ids in the export SOQL (for objects without
 *                    their own cross-org GlobalKey; Vlocity resolves references on deploy)
 *   displayFields  — extra scalar fields surfaced in the diff UI
 */
const OBJECT_DEFINITIONS = {

  // ── Products & Pricing ────────────────────────────────────────────────────

  Product2: {
    label: 'Products',
    group: 'Products & Pricing',
    soql: `SELECT Id, Name, ProductCode, vlocity_cmt__GlobalKey__c
           FROM Product2
           WHERE vlocity_cmt__GlobalKey__c != null`,
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    vlocityType: 'Product2',
    displayFields: ['ProductCode'],
  },

  'vlocity_cmt__PriceList__c': {
    label: 'Price Lists',
    group: 'Products & Pricing',
    soql: `SELECT Id, Name, vlocity_cmt__Code__c, vlocity_cmt__GlobalKey__c
           FROM vlocity_cmt__PriceList__c
           WHERE vlocity_cmt__GlobalKey__c != null`,
    optionalFields: ['GT_CountryCode__c', 'GT_OrganizationCode__c'],
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    // PriceList exports together with its child PriceListEntries
    vlocityType: 'PriceList',
    displayFields: ['vlocity_cmt__Code__c', 'GT_CountryCode__c'],
  },

  'vlocity_cmt__PriceListEntry__c': {
    label: 'Price List Entries',
    group: 'Products & Pricing',
    soql: `SELECT Id, Name, vlocity_cmt__GlobalKey__c, vlocity_cmt__ProductId__c
           FROM vlocity_cmt__PriceListEntry__c
           WHERE vlocity_cmt__GlobalKey__c != null`,
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    vlocityType: 'SObject',
    displayFields: ['vlocity_cmt__ProductId__c'],
  },

  'vlocity_cmt__PricingElement__c': {
    label: 'Pricing Elements',
    group: 'Products & Pricing',
    soql: `SELECT Id, Name, vlocity_cmt__GlobalKey__c
           FROM vlocity_cmt__PricingElement__c
           WHERE vlocity_cmt__GlobalKey__c != null`,
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    vlocityType: 'PricingElement',
    displayFields: [],
  },

  // ── Catalogs ──────────────────────────────────────────────────────────────

  'vlocity_cmt__Catalog__c': {
    label: 'Catalogs',
    group: 'Product Relations',
    soql: `SELECT Id, Name, vlocity_cmt__GlobalKey__c
           FROM vlocity_cmt__Catalog__c
           WHERE vlocity_cmt__GlobalKey__c != null`,
    optionalFields: ['vlocity_cmt__Code__c'],
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    vlocityType: 'SObject',
    displayFields: ['vlocity_cmt__Code__c'],
  },

  // ── Product Relationships ─────────────────────────────────────────────────

  'vlocity_cmt__ProductChildItem__c': {
    label: 'Product Relationships',
    group: 'Product Relations',
    soql: `SELECT Id, Name, vlocity_cmt__GlobalKey__c,
                  vlocity_cmt__ParentProductId__c, vlocity_cmt__ChildProductId__c
           FROM vlocity_cmt__ProductChildItem__c
           WHERE vlocity_cmt__GlobalKey__c != null`,
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    // Exported as SObject — child of Product2 DataPack
    vlocityType: 'SObject',
    displayFields: [],
  },

  'vlocity_cmt__CatalogProductRelationship__c': {
    label: 'Catalog-Product Relationships',
    group: 'Product Relations',
    // Relationship traversal fields used to build the composite match key.
    // This object has no own vlocity_cmt__GlobalKey__c.
    soql: `SELECT Id,
                  vlocity_cmt__CatalogId__r.vlocity_cmt__GlobalKey__c,
                  vlocity_cmt__CatalogId__r.Name,
                  vlocity_cmt__Product2Id__r.vlocity_cmt__GlobalKey__c,
                  vlocity_cmt__Product2Id__r.Name
           FROM vlocity_cmt__CatalogProductRelationship__c`,
    globalKeyField: null, // no own GlobalKey — composite match below
    compositeKeyFn: (r) => {
      const catGK  = r.vlocity_cmt__CatalogId__r?.vlocity_cmt__GlobalKey__c  || 'null';
      const prodGK = r.vlocity_cmt__Product2Id__r?.vlocity_cmt__GlobalKey__c || 'null';
      return `${catGK}::${prodGK}`;
    },
    nameFn: (r) => {
      const cat  = r.vlocity_cmt__CatalogId__r?.Name  || '?';
      const prod = r.vlocity_cmt__Product2Id__r?.Name || '?';
      return `${cat} → ${prod}`;
    },
    vlocityType: 'SObject',
    // Export uses source record Ids since there is no cross-org GlobalKey on the join record.
    // Vlocity resolves catalog/product references via their own GlobalKeys on deploy.
    syncBy: 'id',
    displayFields: [],
  },

  'vlocity_cmt__AttributeAssignment__c': {
    label: 'Attribute Assignments',
    group: 'Product Relations',
    soql: `SELECT Id, Name, vlocity_cmt__GlobalKey__c
           FROM vlocity_cmt__AttributeAssignment__c
           WHERE vlocity_cmt__GlobalKey__c != null`,
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    vlocityType: 'SObject',
    displayFields: [],
  },

  // ── Attributes ────────────────────────────────────────────────────────────

  'vlocity_cmt__AttributeCategory__c': {
    label: 'Attribute Categories',
    group: 'Attributes',
    soql: `SELECT Id, Name, vlocity_cmt__GlobalKey__c
           FROM vlocity_cmt__AttributeCategory__c
           WHERE vlocity_cmt__GlobalKey__c != null`,
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    vlocityType: 'AttributeCategory',
    displayFields: [],
  },

  'vlocity_cmt__Attribute__c': {
    label: 'Attributes',
    group: 'Attributes',
    soql: `SELECT Id, Name, vlocity_cmt__GlobalKey__c, vlocity_cmt__AttributeCategoryId__c
           FROM vlocity_cmt__Attribute__c
           WHERE vlocity_cmt__GlobalKey__c != null`,
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    vlocityType: 'Attribute',
    displayFields: [],
  },

  // ── Picklists ─────────────────────────────────────────────────────────────

  'vlocity_cmt__Picklist__c': {
    label: 'Picklists',
    group: 'Picklists',
    soql: `SELECT Id, Name, vlocity_cmt__GlobalKey__c
           FROM vlocity_cmt__Picklist__c
           WHERE vlocity_cmt__GlobalKey__c != null`,
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    vlocityType: 'VlocityPicklist',
    displayFields: [],
  },

  'vlocity_cmt__PicklistValue__c': {
    label: 'Picklist Values',
    group: 'Picklists',
    soql: `SELECT Id, Name, vlocity_cmt__GlobalKey__c, vlocity_cmt__PicklistId__c
           FROM vlocity_cmt__PicklistValue__c
           WHERE vlocity_cmt__GlobalKey__c != null`,
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    vlocityType: 'SObject',
    displayFields: [],
  },

  // ── Calculation Matrices ──────────────────────────────────────────────────

  'vlocity_cmt__CalculationMatrix__c': {
    label: 'Calculation Matrices',
    group: 'Calculation Matrices',
    soql: `SELECT Id, Name, vlocity_cmt__GlobalKey__c
           FROM vlocity_cmt__CalculationMatrix__c
           WHERE vlocity_cmt__GlobalKey__c != null`,
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    vlocityType: 'CalculationMatrix',
    displayFields: [],
  },

  'vlocity_cmt__CalculationMatrixVersion__c': {
    label: 'Calculation Matrix Versions',
    group: 'Calculation Matrices',
    soql: `SELECT Id, Name, vlocity_cmt__GlobalKey__c, vlocity_cmt__CalculationMatrixId__c
           FROM vlocity_cmt__CalculationMatrixVersion__c
           WHERE vlocity_cmt__GlobalKey__c != null`,
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    vlocityType: 'SObject',
    displayFields: [],
  },

  'vlocity_cmt__CalculationMatrixRow__c': {
    label: 'Calculation Matrix Rows',
    group: 'Calculation Matrices',
    soql: `SELECT Id, Name, vlocity_cmt__GlobalKey__c, vlocity_cmt__CalculationMatrixVersionId__c
           FROM vlocity_cmt__CalculationMatrixRow__c
           WHERE vlocity_cmt__GlobalKey__c != null`,
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    vlocityType: 'SObject',
    displayFields: [],
  },

  // ── Calculation Procedures ────────────────────────────────────────────────

  'vlocity_cmt__CalculationProcedure__c': {
    label: 'Calculation Procedures',
    group: 'Calculation Procedures',
    soql: `SELECT Id, Name, vlocity_cmt__GlobalKey__c
           FROM vlocity_cmt__CalculationProcedure__c
           WHERE vlocity_cmt__GlobalKey__c != null`,
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    vlocityType: 'CalculationProcedure',
    displayFields: [],
  },

  'vlocity_cmt__CalculationProcedureVersion__c': {
    label: 'Calculation Procedure Versions',
    group: 'Calculation Procedures',
    soql: `SELECT Id, Name, vlocity_cmt__GlobalKey__c, vlocity_cmt__CalculationProcedureId__c
           FROM vlocity_cmt__CalculationProcedureVersion__c
           WHERE vlocity_cmt__GlobalKey__c != null`,
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    vlocityType: 'SObject',
    displayFields: [],
  },

  'vlocity_cmt__CalculationProcedureStep__c': {
    label: 'Calculation Procedure Steps',
    group: 'Calculation Procedures',
    soql: `SELECT Id, Name, vlocity_cmt__GlobalKey__c, vlocity_cmt__CalculationProcedureVersionId__c
           FROM vlocity_cmt__CalculationProcedureStep__c
           WHERE vlocity_cmt__GlobalKey__c != null`,
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    vlocityType: 'SObject',
    displayFields: [],
  },

  // ── Rules & Filters ───────────────────────────────────────────────────────

  'vlocity_cmt__Rule__c': {
    label: 'Rules',
    group: 'Rules & Filters',
    soql: `SELECT Id, Name, vlocity_cmt__GlobalKey__c
           FROM vlocity_cmt__Rule__c
           WHERE vlocity_cmt__GlobalKey__c != null`,
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    vlocityType: 'Rule',
    displayFields: [],
  },

  'vlocity_cmt__Ruleset__c': {
    label: 'Rulesets',
    group: 'Rules & Filters',
    soql: `SELECT Id, Name, vlocity_cmt__GlobalKey__c
           FROM vlocity_cmt__Ruleset__c
           WHERE vlocity_cmt__GlobalKey__c != null`,
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    vlocityType: 'Ruleset',
    displayFields: [],
  },

  'vlocity_cmt__EntityFilter__c': {
    label: 'Entity Filters',
    group: 'Rules & Filters',
    soql: `SELECT Id, Name, vlocity_cmt__GlobalKey__c
           FROM vlocity_cmt__EntityFilter__c
           WHERE vlocity_cmt__GlobalKey__c != null`,
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    vlocityType: 'SObject',
    displayFields: [],
  },

  // ── Object Layouts ────────────────────────────────────────────────────────

  'vlocity_cmt__ObjectClass__c': {
    label: 'Object Classes',
    group: 'Object Layouts',
    soql: `SELECT Id, Name, vlocity_cmt__GlobalKey__c
           FROM vlocity_cmt__ObjectClass__c
           WHERE vlocity_cmt__GlobalKey__c != null`,
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    vlocityType: 'ObjectClass',
    displayFields: [],
  },

  'vlocity_cmt__ObjectLayout__c': {
    label: 'Object Layouts',
    group: 'Object Layouts',
    soql: `SELECT Id, Name, vlocity_cmt__GlobalKey__c
           FROM vlocity_cmt__ObjectLayout__c
           WHERE vlocity_cmt__GlobalKey__c != null`,
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    vlocityType: 'ObjectLayout',
    displayFields: [],
  },

  'vlocity_cmt__UISection__c': {
    label: 'UI Sections',
    group: 'Object Layouts',
    soql: `SELECT Id, Name, vlocity_cmt__GlobalKey__c
           FROM vlocity_cmt__UISection__c
           WHERE vlocity_cmt__GlobalKey__c != null`,
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    vlocityType: 'SObject',
    displayFields: [],
  },

  'vlocity_cmt__UIFacet__c': {
    label: 'UI Facets',
    group: 'Object Layouts',
    soql: `SELECT Id, Name, vlocity_cmt__GlobalKey__c
           FROM vlocity_cmt__UIFacet__c
           WHERE vlocity_cmt__GlobalKey__c != null`,
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    vlocityType: 'SObject',
    displayFields: [],
  },

  // ── Promotions ────────────────────────────────────────────────────────────

  'vlocity_cmt__Promotion__c': {
    label: 'Promotions',
    group: 'Promotions',
    soql: `SELECT Id, Name, vlocity_cmt__Code__c, vlocity_cmt__GlobalKey__c, GT_Type__c
           FROM vlocity_cmt__Promotion__c
           WHERE vlocity_cmt__GlobalKey__c != null`,
    globalKeyField: 'vlocity_cmt__GlobalKey__c',
    vlocityType: 'SObject',
    displayFields: ['vlocity_cmt__Code__c', 'GT_Type__c'],
  },

  // ── GT custom objects (no Vlocity CLI sync — use direct Salesforce API) ──

  'GT_ProductSKU__c': {
    label: 'GT Product SKUs',
    group: 'GT Custom Objects',
    soql: `SELECT Id, Name, GT_GlobalKey__c, GT_ProductSKU__c, GT_ProductName_Text__c,
                  GT_OrganizationCode__c, GT_LifeCycle__c
           FROM GT_ProductSKU__c
           WHERE GT_GlobalKey__c != null`,
    globalKeyField: 'GT_GlobalKey__c',
    vlocityType: null,
    syncBy: 'directApi',
    syncFields: ['Name', 'GT_GlobalKey__c', 'GT_ProductSKU__c', 'GT_ProductName_Text__c',
                 'GT_OrganizationCode__c', 'GT_LifeCycle__c', 'GT_Color__c', 'GT_ProductUse__c',
                 'GT_ShopCode__c', 'GT_SubstitutionCode__c', 'CurrencyIsoCode'],
    displayFields: ['GT_ProductSKU__c', 'GT_OrganizationCode__c'],
  },

  'GT_RateCode__c': {
    label: 'Rate Codes',
    group: 'GT Custom Objects',
    soql: `SELECT Id, Name, GT_GlobalKey__c, GT_OrgCode__c, GT_VATCode__c
           FROM GT_RateCode__c
           WHERE GT_GlobalKey__c != null`,
    globalKeyField: 'GT_GlobalKey__c',
    vlocityType: null,
    syncBy: 'directApi', // synced via Salesforce REST API — not Vlocity CLI
    syncFields: ['Name', 'GT_GlobalKey__c', 'GT_OrgCode__c', 'GT_VATCode__c',
                 'GT_VATDescription__c', 'GT_VATRate__c', 'GT_StartDate__c',
                 'GT_EndDate__c', 'CurrencyIsoCode'],
    displayFields: ['GT_VATCode__c', 'GT_OrgCode__c'],
  },

  'GT_RateTable__c': {
    label: 'Rate Tables',
    group: 'GT Custom Objects',
    soql: `SELECT Id, Name, GT_GlobalKey__c, GT_OrgCode__c, GT_ProductName_Text__c
           FROM GT_RateTable__c
           WHERE GT_GlobalKey__c != null`,
    globalKeyField: 'GT_GlobalKey__c',
    vlocityType: null,
    syncBy: 'directApi',
    // Lookup ID fields (GT_RateCode__c SF Id, Product__c SF Id) differ between orgs — excluded.
    syncFields: ['Name', 'GT_GlobalKey__c', 'GT_OrgCode__c', 'GT_ProductName_Text__c',
                 'GT_RateDescription__c', 'GT_StartDate__c', 'GT_EndDate__c',
                 'GT_VATType__c', 'GT_UniqueKey__c', 'CurrencyIsoCode'],
    displayFields: ['GT_ProductName_Text__c', 'GT_OrgCode__c'],
  },

};

// Maximum number of values per SOQL IN clause before splitting into batches
const SOQL_IN_BATCH_SIZE = 500;

class EnvComparisonService {
  constructor() {
    this.lastResult = null;
    // Per-run describe cache: { '<username>:<objectType>' → Set<fieldName> }
    this._describeCache = new Map();
  }

  /**
   * Return the set of field names available on an sObject in the given org.
   * Results are cached for the lifetime of this service instance.
   */
  async _getFieldSet(username, objectType) {
    const cacheKey = `${username}:${objectType}`;
    if (this._describeCache.has(cacheKey)) return this._describeCache.get(cacheKey);

    const auth = await sfdxAuthService.getAccessToken(username);
    const { accessToken, instanceUrl } = auth;
    const apiVersion = process.env.SALESFORCE_API_VERSION || 'v59.0';
    try {
      const resp = await axios.get(
        `${instanceUrl}/services/data/${apiVersion}/sobjects/${objectType}/describe`,
        { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 30000 }
      );
      const fieldSet = new Set((resp.data.fields || []).map(f => f.name));
      this._describeCache.set(cacheKey, fieldSet);
      return fieldSet;
    } catch (err) {
      logger.warn(`Describe failed for ${objectType} on ${username} — skipping optional fields`, { err: err.message });
      const empty = new Set();
      this._describeCache.set(cacheKey, empty);
      return empty;
    }
  }

  /**
   * Build a SOQL string for the given definition, injecting any optionalFields
   * that actually exist in both the source and target orgs.
   */
  async _buildSOQL(sourceUsername, targetUsername, objectType, def) {
    if (!def.optionalFields || def.optionalFields.length === 0) return def.soql;

    const [srcFields, tgtFields] = await Promise.all([
      this._getFieldSet(sourceUsername, objectType),
      this._getFieldSet(targetUsername, objectType),
    ]);

    const available = def.optionalFields.filter(f => srcFields.has(f) && tgtFields.has(f));
    if (available.length === 0) return def.soql;

    // Inject available optional fields right before the FROM clause
    return def.soql.replace(/\s+FROM\s+/i, `, ${available.join(', ')} FROM `);
  }

  /**
   * Fetch ALL records for a SOQL from a given org, following pagination.
   * Uses a per-call fresh axios connection to avoid salesforceService singleton
   * auth state mutation.
   */
  async queryAll(username, soql) {
    const auth = await sfdxAuthService.getAccessToken(username);
    const { accessToken, instanceUrl } = auth;
    const apiVersion = process.env.SALESFORCE_API_VERSION || 'v59.0';
    const baseUrl = `${instanceUrl}/services/data/${apiVersion}`;
    const headers = { Authorization: `Bearer ${accessToken}` };

    let records = [];
    let url = `${baseUrl}/query`;
    let params = { q: soql };

    while (url) {
      const response = await axios.get(url, { params, headers, timeout: 120000 });
      const data = response.data;
      records = records.concat(data.records || []);

      if (!data.done && data.nextRecordsUrl) {
        url = `${instanceUrl}${data.nextRecordsUrl}`;
        params = undefined;
      } else {
        url = null;
      }
    }

    return records;
  }

  /**
   * Derive the match key for a record according to its object definition.
   * Returns the GlobalKey string for simple objects, or a computed composite
   * string for objects without their own GlobalKey.
   */
  _getMatchKey(def, record) {
    if (def.globalKeyField) {
      return record[def.globalKeyField] || null;
    }
    if (def.compositeKeyFn) {
      const key = def.compositeKeyFn(record);
      // Treat 'null::null' (both sides unresolved) as un-matchable
      return key === 'null::null' ? null : key;
    }
    return null;
  }

  /**
   * Derive a display name for a record according to its object definition.
   */
  _getName(def, record) {
    if (def.nameFn) return def.nameFn(record);
    return record.Name || null;
  }

  /**
   * Compare two orgs for the given object types.
   *
   * @param {string}   sourceUsername - SFDX username for the source org (MasterCatalog)
   * @param {string}   targetUsername - SFDX username for the target org (UAT)
   * @param {string[]} objectTypes    - keys from OBJECT_DEFINITIONS; defaults to all
   * @returns {Promise<Object>} structured diff
   */
  async compareOrgs(sourceUsername, targetUsername, objectTypes) {
    if (!sourceUsername || !targetUsername) {
      throw new Error('sourceUsername and targetUsername are required');
    }
    if (sourceUsername === targetUsername) {
      throw new Error('Source and target orgs must be different');
    }

    const types = (objectTypes && objectTypes.length)
      ? objectTypes.filter(t => OBJECT_DEFINITIONS[t])
      : Object.keys(OBJECT_DEFINITIONS);

    if (!types.length) throw new Error('No valid object types specified');

    logger.info('Starting env comparison', { sourceUsername, targetUsername, types });

    // Clear describe cache so each run re-checks field availability
    this._describeCache.clear();

    const results = [];

    for (const objectType of types) {
      const def = OBJECT_DEFINITIONS[objectType];
      logger.info(`Querying ${def.label}...`);

      const soql = await this._buildSOQL(sourceUsername, targetUsername, objectType, def);

      let sourceRecords, targetRecords;
      try {
        [sourceRecords, targetRecords] = await Promise.all([
          this.queryAll(sourceUsername, soql),
          this.queryAll(targetUsername, soql),
        ]);
      } catch (err) {
        const status = err.response?.status;
        const isUnavailable = status === 400 || status === 404;
        logger.warn(`Skipping ${def.label} — query failed (${status || 'unknown'})`, { err: err.message });
        results.push({
          objectType,
          label: def.label,
          sourceCount: 0,
          targetCount: 0,
          missingCount: 0,
          extraCount: 0,
          missingInTarget: [],
          extraInTarget: [],
          skipped: true,
          skipReason: isUnavailable
            ? `Object type not available in one or both orgs (HTTP ${status})`
            : err.message,
        });
        continue;
      }

      // Build match key maps
      const sourceKeyMap = new Map();
      for (const r of sourceRecords) {
        const key = this._getMatchKey(def, r);
        if (key) sourceKeyMap.set(key, r);
      }

      const targetKeySet = new Set();
      for (const r of targetRecords) {
        const key = this._getMatchKey(def, r);
        if (key) targetKeySet.add(key);
      }

      const missingInTarget = [];
      for (const r of sourceRecords) {
        const key = this._getMatchKey(def, r);
        if (!key || targetKeySet.has(key)) continue;
        const extra = {};
        (def.displayFields || []).forEach(f => { extra[f] = r[f] ?? null; });
        missingInTarget.push({
          globalKey: key,       // may be composite — used as the UI row key
          name: this._getName(def, r),
          sourceId: r.Id,
          ...extra,
        });
      }

      const targetKeyMap = new Map();
      for (const r of targetRecords) {
        const key = this._getMatchKey(def, r);
        if (key) targetKeyMap.set(key, r);
      }

      const extraInTarget = [];
      for (const r of targetRecords) {
        const key = this._getMatchKey(def, r);
        if (!key || sourceKeyMap.has(key)) continue;
        extraInTarget.push({
          globalKey: key,
          name: this._getName(def, r),
          targetId: r.Id,
        });
      }

      results.push({
        objectType,
        label: def.label,
        sourceCount: sourceRecords.length,
        targetCount: targetRecords.length,
        missingCount: missingInTarget.length,
        extraCount: extraInTarget.length,
        missingInTarget,
        extraInTarget,
      });

      logger.info(`${def.label} comparison complete`, {
        sourceCount: sourceRecords.length,
        targetCount: targetRecords.length,
        missing: missingInTarget.length,
        extra: extraInTarget.length,
      });
    }

    this.lastResult = {
      results,
      timestamp: new Date().toISOString(),
      sourceUsername,
      targetUsername,
    };

    return this.lastResult;
  }

  /** Returns the cached last comparison result, or null. */
  getLastResult() {
    return this.lastResult;
  }

  /**
   * Build and persist a Vlocity export job YAML for the selected missing records.
   *
   * For objects with a GlobalKey:  SELECT Id FROM Object WHERE GlobalKey IN ('k1',...)
   * For objects with syncBy:'id':  SELECT Id FROM Object WHERE Id IN ('src_id1',...)
   *   (Vlocity resolves cross-org references via the referenced objects' own GlobalKeys
   *    during the DataPack deploy — the source Id is only used for the export query.)
   *
   * @param {string} sourceUsername
   * @param {string} targetUsername
   * @param {Array<{objectType,globalKey,sourceId,name}>} selectedRecords
   * @param {string} projectPath
   * @returns {Promise<string>} absolute path to the generated YAML file
   */
  async buildSyncJobFile(sourceUsername, targetUsername, selectedRecords, projectPath) {
    // Group selected records by objectType
    const byType = {};
    for (const rec of selectedRecords) {
      const def = OBJECT_DEFINITIONS[rec.objectType];
      if (!def) continue;
      if (!byType[rec.objectType]) byType[rec.objectType] = [];
      byType[rec.objectType].push(rec);
    }

    const queries = [];

    for (const [objectType, recs] of Object.entries(byType)) {
      const def = OBJECT_DEFINITIONS[objectType];
      // GT_ custom objects are comparison-only; they cannot be synced via Vlocity CLI
      if (def.syncBy === 'directApi') continue;
      const usesId = def.syncBy === 'id';

      if (usesId) {
        // Export by source record Id — Vlocity handles cross-org reference resolution
        const ids = recs.map(r => r.sourceId).filter(Boolean);
        for (let i = 0; i < ids.length; i += SOQL_IN_BATCH_SIZE) {
          const batch = ids.slice(i, i + SOQL_IN_BATCH_SIZE);
          const inList = batch.map(id => `'${id}'`).join(',');
          queries.push({
            VlocityDataPackType: def.vlocityType,
            query: `SELECT Id FROM ${objectType} WHERE Id IN (${inList})`,
          });
        }
      } else {
        // Export by GlobalKey — the standard cross-org identifier
        const gkField = def.globalKeyField;
        const keys = recs.map(r => r.globalKey).filter(Boolean);
        for (let i = 0; i < keys.length; i += SOQL_IN_BATCH_SIZE) {
          const batch = keys.slice(i, i + SOQL_IN_BATCH_SIZE);
          const inList = batch.map(k => `'${k.replace(/'/g, "\\'")}'`).join(',');
          queries.push({
            VlocityDataPackType: def.vlocityType,
            query: `SELECT Id FROM ${objectType} WHERE ${gkField} IN (${inList})`,
          });
        }
      }
    }

    if (!queries.length) throw new Error('No valid records selected for sync');

    const jobConfig = {
      name: 'Env Comparison Sync',
      projectPath,
      defaultMaxParallel: 10,
      continueAfterError: true,
      autoRetryErrors: true,
      maxDepth: 10,
      useAllRelationships: true,
      queries,
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jobFilePath = path.join(__dirname, '../temp', `env-sync-export-${timestamp}.yaml`);

    await fs.ensureDir(path.dirname(jobFilePath));
    await fs.writeFile(jobFilePath, yaml.stringify(jobConfig), 'utf8');

    logger.info('Sync export job file created', { jobFilePath, queryCount: queries.length });
    return jobFilePath;
  }

  /**
   * Sync GT_ custom objects via direct Salesforce REST API upsert.
   * Fetches each selected record from the source org by GlobalKey,
   * then upserts to the target org.
   *
   * @param {string} sourceUsername
   * @param {string} targetUsername
   * @param {Array<{objectType, globalKey, sourceId}>} records — only directApi records
   * @returns {Promise<{ synced: number, errors: number, details: Object }>}
   */
  async syncDirectApiRecords(sourceUsername, targetUsername, records) {
    const catalogManagerService = require('./catalogManagerService');
    const byType = {};
    for (const rec of records) {
      const def = OBJECT_DEFINITIONS[rec.objectType];
      if (!def || def.syncBy !== 'directApi' || !def.syncFields) continue;
      if (!byType[rec.objectType]) byType[rec.objectType] = [];
      byType[rec.objectType].push(rec);
    }

    let synced = 0;
    let errors = 0;
    const details = {};

    for (const [objectType, recs] of Object.entries(byType)) {
      const def = OBJECT_DEFINITIONS[objectType];
      const gkField = def.globalKeyField;
      const fields = ['Id', ...def.syncFields.filter(f => f !== 'Id')];

      // Batch fetch full records from source
      for (let i = 0; i < recs.length; i += SOQL_IN_BATCH_SIZE) {
        const batch = recs.slice(i, i + SOQL_IN_BATCH_SIZE);
        const keys = batch.map(r => r.globalKey).filter(Boolean);
        const inList = keys.map(k => `'${k.replace(/'/g, "\\'")}'`).join(',');
        const soql = `SELECT ${fields.join(', ')} FROM ${objectType} WHERE ${gkField} IN (${inList})`;

        const sourceRecords = await this.queryAll(sourceUsername, soql);

        if (!sourceRecords.length) continue;

        // Strip read-only fields before upsert
        const toUpsert = sourceRecords.map(r => {
          const cleaned = {};
          def.syncFields.forEach(f => { if (r[f] !== undefined && r[f] !== null) cleaned[f] = r[f]; });
          return cleaned;
        });

        const result = await catalogManagerService.sfUpsertBulk(
          targetUsername, objectType, gkField, toUpsert
        );
        synced += result.results.length;
        errors += result.errors.length;
        details[objectType] = {
          synced: (details[objectType]?.synced || 0) + result.results.length,
          errors: (details[objectType]?.errors || 0) + result.errors.length,
        };
      }
    }

    logger.info('Direct API sync complete', { sourceUsername, targetUsername, synced, errors, details });
    return { synced, errors, details };
  }

  /** Returns the object type list for the UI. */
  getObjectDefinitions() {
    return Object.entries(OBJECT_DEFINITIONS).map(([objectType, def]) => ({
      objectType,
      label: def.label,
      group: def.group || 'Other',
      syncBy: def.syncBy || 'globalKey',
      canSync: true,
    }));
  }
}

module.exports = new EnvComparisonService();
