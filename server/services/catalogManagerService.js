const axios = require('axios');
const salesforceService = require('./salesforceService');
const logger = require('../utils/logger');
const { ValidationRuleEngine } = require('./validationRuleEngine');
const { duplicatePricingElementRule } = require('../validators/pricingValidators');
const { duplicateCatalogProductRelationshipRule } = require('../validators/catalogValidators');
const { ValidationError } = require('../middleware/errorHandler');

// Pre-configured engines (singletons) for each guarded operation
const _pricingElementEngine = new ValidationRuleEngine()
  .registerRule(duplicatePricingElementRule);

const _catalogProductEngine = new ValidationRuleEngine()
  .registerRule(duplicateCatalogProductRelationshipRule);

/**
 * Escape a value for safe inclusion in a SOQL WHERE clause.
 * Prevents SOQL injection by escaping single quotes.
 */
function escapeSoql(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Build a paginated SOQL suffix
 */
function paginate(filters) {
  const limit = Math.min(parseInt(filters.limit, 10) || 50, 200);
  const page  = parseInt(filters.page, 10) || 0;
  return ` ORDER BY Name LIMIT ${limit} OFFSET ${page * limit}`;
}

/**
 * In-process cache of describe results (field name sets) keyed by sObject name.
 * Avoids repeated /describe API calls within the same server process.
 */
const _describeCache = {};

/**
 * Return the Set of field names that exist on an sObject in the connected org.
 * Falls back to an empty Set on error so callers can still build minimal queries.
 */
async function getFieldSet(objectName) {
  if (_describeCache[objectName]) return _describeCache[objectName];
  const fields = await salesforceService.getObjectFields(objectName);
  const set = new Set(fields.map(f => f.name));
  _describeCache[objectName] = set;
  return set;
}

/**
 * Build a SELECT field list: always includes Id + Name, then adds each
 * field from `desired` only when it actually exists in the org's field set.
 */
function buildFieldList(fieldSet, desired) {
  return ['Id', 'Name', ...desired.filter(f => fieldSet.has(f))];
}

/**
 * Make an authenticated PATCH (update) call to Salesforce REST API.
 * Unlike the shared updateRecord helper, this version accepts the objectType
 * explicitly, supporting custom GT_ objects whose IDs have unknown prefixes.
 */
async function sfPatch(username, objectType, id, data) {
  await salesforceService.authenticateWithSfdx(username);
  await axios.patch(
    `${salesforceService.baseUrl}/sobjects/${objectType}/${id}`,
    data,
    { headers: { Authorization: `Bearer ${salesforceService.accessToken}` } }
  );
  return { id, success: true };
}

/**
 * Make an authenticated DELETE call to Salesforce REST API.
 */
async function sfDelete(username, objectType, id) {
  await salesforceService.authenticateWithSfdx(username);
  await axios.delete(
    `${salesforceService.baseUrl}/sobjects/${objectType}/${id}`,
    { headers: { Authorization: `Bearer ${salesforceService.accessToken}` } }
  );
  return { id, success: true };
}

/**
 * Make an authenticated POST (create) call to Salesforce REST API.
 */
async function sfPost(username, objectType, data) {
  await salesforceService.authenticateWithSfdx(username);
  const response = await axios.post(
    `${salesforceService.baseUrl}/sobjects/${objectType}/`,
    data,
    { headers: { Authorization: `Bearer ${salesforceService.accessToken}` } }
  );
  return { id: response.data.id, success: response.data.success };
}

/**
 * Upsert records in bulk using Salesforce Composite Collections API.
 * Used by rollback restore operation.
 * @param {string} username
 * @param {string} objectType  e.g. 'vlocity_cmt__PriceList__c'
 * @param {string} externalIdField  e.g. 'vlocity_cmt__GlobalKey__c'
 * @param {Array}  records  Array of Salesforce record objects
 * @returns {{ results: Array, errors: Array }}
 */
async function sfUpsertBulk(username, objectType, externalIdField, records) {
  await salesforceService.authenticateWithSfdx(username);
  const CHUNK = 200;
  const results = [];
  const errors  = [];

  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    try {
      const response = await axios.patch(
        `${salesforceService.baseUrl}/composite/sobjects/${objectType}/${externalIdField}`,
        { allOrNone: false, records: chunk },
        { headers: { Authorization: `Bearer ${salesforceService.accessToken}` } }
      );
      (response.data || []).forEach((r) => {
        if (r.success) results.push(r);
        else errors.push(r);
      });
    } catch (err) {
      errors.push({ message: err.response?.data?.[0]?.message || err.message });
    }
  }
  return { results, errors };
}

// ─────────────────────────────────────────────
// Products (Product2)
// ─────────────────────────────────────────────
async function getProducts(username, filters = {}) {
  await salesforceService.authenticateWithSfdx(username);
  let soql = `SELECT Id, Name, ProductCode, Family, IsActive, Description FROM Product2`;
  const cond = [];
  if (filters.search) cond.push(`(Name LIKE '%${escapeSoql(filters.search)}%' OR ProductCode LIKE '%${escapeSoql(filters.search)}%')`);
  if (filters.isActive !== undefined) cond.push(`IsActive = ${filters.isActive}`);
  if (filters.family) cond.push(`Family = '${escapeSoql(filters.family)}'`);
  if (cond.length) soql += ` WHERE ${cond.join(' AND ')}`;
  soql += paginate(filters);
  const result = await salesforceService.query(soql);
  return { records: result.records || [], totalSize: result.totalSize || 0 };
}

async function createProduct(username, data) {
  return sfPost(username, 'Product2', data);
}
async function updateProduct(username, id, data) {
  return sfPatch(username, 'Product2', id, data);
}
async function deleteProduct(username, id) {
  return sfDelete(username, 'Product2', id);
}

async function getProductById(username, id) {
  await salesforceService.authenticateWithSfdx(username);
  const soql = `SELECT Id, Name, ProductCode, Family, IsActive, Description FROM Product2 WHERE Id = '${escapeSoql(id)}' LIMIT 1`;
  const result = await salesforceService.query(soql);
  return result.records?.[0] || null;
}

// ─────────────────────────────────────────────
// Price Lists (vlocity_cmt__PriceList__c)
// ─────────────────────────────────────────────
async function getPriceLists(username, filters = {}) {
  await salesforceService.authenticateWithSfdx(username);
  let soql = `SELECT Id, Name, vlocity_cmt__Code__c, vlocity_cmt__Description__c,
    vlocity_cmt__CurrencyCode__c, vlocity_cmt__IsActive__c,
    vlocity_cmt__EffectiveFromDate__c, vlocity_cmt__EffectiveUntilDate__c,
    vlocity_cmt__GlobalKey__c, GT_PriceListType__c, GT_CountryCode__c,
    GT_IsPrimary__c, GT_OrganizationCode__c
  FROM vlocity_cmt__PriceList__c`;
  const cond = [];
  if (filters.search) cond.push(`(Name LIKE '%${escapeSoql(filters.search)}%' OR vlocity_cmt__Code__c LIKE '%${escapeSoql(filters.search)}%')`);
  if (filters.isActive !== undefined) cond.push(`vlocity_cmt__IsActive__c = ${filters.isActive}`);
  if (filters.country) cond.push(`GT_CountryCode__c = '${escapeSoql(filters.country)}'`);
  if (filters.priceListType) cond.push(`GT_PriceListType__c = '${escapeSoql(filters.priceListType)}'`);
  if (cond.length) soql += ` WHERE ${cond.join(' AND ')}`;
  soql += paginate(filters);
  const result = await salesforceService.query(soql);
  return { records: result.records || [], totalSize: result.totalSize || 0 };
}

async function createPriceList(username, data) {
  return sfPost(username, 'vlocity_cmt__PriceList__c', data);
}
async function updatePriceList(username, id, data) {
  return sfPatch(username, 'vlocity_cmt__PriceList__c', id, data);
}
async function deletePriceList(username, id) {
  return sfDelete(username, 'vlocity_cmt__PriceList__c', id);
}

async function getPriceListById(username, id) {
  await salesforceService.authenticateWithSfdx(username);
  const soql = `SELECT Id, Name, vlocity_cmt__Code__c, vlocity_cmt__Description__c,
    vlocity_cmt__CurrencyCode__c, vlocity_cmt__IsActive__c,
    vlocity_cmt__EffectiveFromDate__c, vlocity_cmt__EffectiveUntilDate__c,
    vlocity_cmt__GlobalKey__c, GT_PriceListType__c, GT_CountryCode__c,
    GT_IsPrimary__c, GT_OrganizationCode__c
  FROM vlocity_cmt__PriceList__c WHERE Id = '${escapeSoql(id)}' LIMIT 1`;
  const result = await salesforceService.query(soql);
  return result.records?.[0] || null;
}

// ─────────────────────────────────────────────
// Price List Entries (vlocity_cmt__PriceListEntry__c)
// ─────────────────────────────────────────────
async function getPriceListEntries(username, priceListId, filters = {}) {
  await salesforceService.authenticateWithSfdx(username);
  const fs = await getFieldSet('vlocity_cmt__PriceListEntry__c');
  const fields = buildFieldList(fs, [
    'vlocity_cmt__PriceListId__c', 'vlocity_cmt__ProductId__c',
    'vlocity_cmt__IsActive__c', 'vlocity_cmt__GlobalKey__c', 'vlocity_cmt__Sequence__c',
    'vlocity_cmt__UnitPrice__c', 'vlocity_cmt__ListPrice__c', 'vlocity_cmt__CurrencyCode__c',
    'vlocity_cmt__EffectiveFromDate__c', 'vlocity_cmt__EffectiveUntilDate__c',
  ]);
  const rel = fs.has('vlocity_cmt__ProductId__c')
    ? ', vlocity_cmt__ProductId__r.Name, vlocity_cmt__ProductId__r.ProductCode' : '';
  const soql = `SELECT ${fields.join(', ')}${rel}
  FROM vlocity_cmt__PriceListEntry__c
  WHERE vlocity_cmt__PriceListId__c = '${escapeSoql(priceListId)}' ORDER BY Name LIMIT 200`;
  const result = await salesforceService.query(soql);
  return { records: result.records || [], totalSize: result.totalSize || 0 };
}

async function createPriceListEntry(username, priceListId, data) {
  return sfPost(username, 'vlocity_cmt__PriceListEntry__c', { ...data, vlocity_cmt__PriceListId__c: priceListId });
}
async function updatePriceListEntry(username, entryId, data) {
  return sfPatch(username, 'vlocity_cmt__PriceListEntry__c', entryId, data);
}
async function deletePriceListEntry(username, entryId) {
  return sfDelete(username, 'vlocity_cmt__PriceListEntry__c', entryId);
}

// ─────────────────────────────────────────────
// Promotions (vlocity_cmt__Promotion__c)
// ─────────────────────────────────────────────
async function getPromotions(username, filters = {}) {
  await salesforceService.authenticateWithSfdx(username);
  let soql = `SELECT Id, Name, vlocity_cmt__Code__c, vlocity_cmt__Description__c,
    vlocity_cmt__IsActive__c, vlocity_cmt__GlobalKey__c,
    vlocity_cmt__PriceListId__c, GT_Type__c, Promotion_Trigger__c
  FROM vlocity_cmt__Promotion__c`;
  const cond = [];
  if (filters.search) cond.push(`(Name LIKE '%${escapeSoql(filters.search)}%' OR vlocity_cmt__Code__c LIKE '%${escapeSoql(filters.search)}%')`);
  if (filters.isActive !== undefined) cond.push(`vlocity_cmt__IsActive__c = ${filters.isActive}`);
  if (cond.length) soql += ` WHERE ${cond.join(' AND ')}`;
  soql += paginate(filters);
  const result = await salesforceService.query(soql);
  return { records: result.records || [], totalSize: result.totalSize || 0 };
}

async function createPromotion(username, data) {
  return sfPost(username, 'vlocity_cmt__Promotion__c', data);
}
async function updatePromotion(username, id, data) {
  return sfPatch(username, 'vlocity_cmt__Promotion__c', id, data);
}
async function deletePromotion(username, id) {
  return sfDelete(username, 'vlocity_cmt__Promotion__c', id);
}

async function getPromotionById(username, id) {
  await salesforceService.authenticateWithSfdx(username);
  const soql = `SELECT Id, Name, vlocity_cmt__Code__c, vlocity_cmt__Description__c,
    vlocity_cmt__IsActive__c, vlocity_cmt__GlobalKey__c,
    vlocity_cmt__PriceListId__c, GT_Type__c, Promotion_Trigger__c
  FROM vlocity_cmt__Promotion__c WHERE Id = '${escapeSoql(id)}' LIMIT 1`;
  const result = await salesforceService.query(soql);
  return result.records?.[0] || null;
}

// ─────────────────────────────────────────────
// Promotion Rules (PromotionRule__c)
// ─────────────────────────────────────────────
async function getPromotionRules(username, promotionId) {
  await salesforceService.authenticateWithSfdx(username);
  const soql = `SELECT Id, Name, Promotion__c, ConditionType__c, ConditionValue__c,
    ActionType__c, ActionValue__c, Priority__c, IsActive__c
  FROM PromotionRule__c
  WHERE Promotion__c = '${escapeSoql(promotionId)}'
  ORDER BY Priority__c LIMIT 100`;
  const result = await salesforceService.query(soql);
  return { records: result.records || [], totalSize: result.totalSize || 0 };
}

async function createPromotionRule(username, data) {
  return sfPost(username, 'PromotionRule__c', data);
}
async function updatePromotionRule(username, id, data) {
  return sfPatch(username, 'PromotionRule__c', id, data);
}
async function deletePromotionRule(username, id) {
  return sfDelete(username, 'PromotionRule__c', id);
}

// ─────────────────────────────────────────────
// Rate Codes (GT_RateCode__c)
// ─────────────────────────────────────────────
async function getRateCodes(username, filters = {}) {
  await salesforceService.authenticateWithSfdx(username);
  // Field names verified against org schema (GT_ objects don't carry vlocity_cmt__ fields)
  let soql = `SELECT Id, Name, GT_GlobalKey__c, GT_OrgCode__c,
    GT_VATCode__c, GT_VATDescription__c, GT_VATRate__c,
    GT_StartDate__c, GT_EndDate__c, CurrencyIsoCode
  FROM GT_RateCode__c`;
  const cond = [];
  if (filters.search) cond.push(`Name LIKE '%${escapeSoql(filters.search)}%'`);
  if (filters.orgCode) cond.push(`GT_OrgCode__c = '${escapeSoql(filters.orgCode)}'`);
  if (cond.length) soql += ` WHERE ${cond.join(' AND ')}`;
  soql += paginate(filters);
  const result = await salesforceService.query(soql);
  return { records: result.records || [], totalSize: result.totalSize || 0 };
}

async function createRateCode(username, data) {
  return sfPost(username, 'GT_RateCode__c', data);
}
async function updateRateCode(username, id, data) {
  return sfPatch(username, 'GT_RateCode__c', id, data);
}
async function deleteRateCode(username, id) {
  return sfDelete(username, 'GT_RateCode__c', id);
}

async function getRateCodeById(username, id) {
  await salesforceService.authenticateWithSfdx(username);
  const soql = `SELECT Id, Name, GT_GlobalKey__c, GT_OrgCode__c,
    GT_VATCode__c, GT_VATDescription__c, GT_VATRate__c,
    GT_StartDate__c, GT_EndDate__c, CurrencyIsoCode
  FROM GT_RateCode__c WHERE Id = '${escapeSoql(id)}' LIMIT 1`;
  const result = await salesforceService.query(soql);
  return result.records?.[0] || null;
}

// ─────────────────────────────────────────────
// Rate Tables (GT_RateTable__c)
// ─────────────────────────────────────────────
async function getRateTables(username, filters = {}) {
  await salesforceService.authenticateWithSfdx(username);
  // Field names verified against org schema (GT_ objects don't carry vlocity_cmt__ fields)
  let soql = `SELECT Id, Name, GT_GlobalKey__c, GT_OrgCode__c,
    Product__c, Product__r.Name, GT_ProductName_Text__c,
    GT_RateCode__c, GT_RateDescription__c,
    GT_StartDate__c, GT_EndDate__c, GT_VATType__c,
    GT_UniqueKey__c, CurrencyIsoCode
  FROM GT_RateTable__c`;
  const cond = [];
  if (filters.search) cond.push(`Name LIKE '%${escapeSoql(filters.search)}%'`);
  if (filters.orgCode) cond.push(`GT_OrgCode__c = '${escapeSoql(filters.orgCode)}'`);
  if (filters.rateCode) cond.push(`GT_RateCode__c = '${escapeSoql(filters.rateCode)}'`);
  if (cond.length) soql += ` WHERE ${cond.join(' AND ')}`;
  soql += paginate(filters);
  const result = await salesforceService.query(soql);
  return { records: result.records || [], totalSize: result.totalSize || 0 };
}

async function createRateTable(username, data) {
  return sfPost(username, 'GT_RateTable__c', data);
}
async function updateRateTable(username, id, data) {
  return sfPatch(username, 'GT_RateTable__c', id, data);
}
async function deleteRateTable(username, id) {
  return sfDelete(username, 'GT_RateTable__c', id);
}

async function getRateTableById(username, id) {
  await salesforceService.authenticateWithSfdx(username);
  const soql = `SELECT Id, Name, GT_GlobalKey__c, GT_OrgCode__c,
    Product__c, Product__r.Name, GT_ProductName_Text__c,
    GT_RateCode__c, GT_RateDescription__c,
    GT_StartDate__c, GT_EndDate__c, GT_VATType__c,
    GT_UniqueKey__c, CurrencyIsoCode
  FROM GT_RateTable__c WHERE Id = '${escapeSoql(id)}' LIMIT 1`;
  const result = await salesforceService.query(soql);
  return result.records?.[0] || null;
}

// ─────────────────────────────────────────────
// Pricing Elements (vlocity_cmt__PricingElement__c)
// ─────────────────────────────────────────────
async function getPricingElements(username, priceListId) {
  await salesforceService.authenticateWithSfdx(username);
  const fs = await getFieldSet('vlocity_cmt__PricingElement__c');
  const fields = buildFieldList(fs, [
    'vlocity_cmt__PriceListId__c', 'vlocity_cmt__PricingVariableId__c',
    'vlocity_cmt__Amount__c', 'vlocity_cmt__IsActive__c', 'vlocity_cmt__GlobalKey__c',
  ]);
  const rel = fs.has('vlocity_cmt__PricingVariableId__c')
    ? ', vlocity_cmt__PricingVariableId__r.Name, vlocity_cmt__PricingVariableId__r.vlocity_cmt__Code__c' : '';
  const soql = `SELECT ${fields.join(', ')}${rel}
  FROM vlocity_cmt__PricingElement__c
  WHERE vlocity_cmt__PriceListId__c = '${escapeSoql(priceListId)}' ORDER BY Name LIMIT 200`;
  const result = await salesforceService.query(soql);
  return { records: result.records || [], totalSize: result.totalSize || 0 };
}

async function createPricingElement(username, priceListId, data) {
  const validation = await _pricingElementEngine.run(username, {
    productId:          data.vlocity_cmt__ProductId__c,
    pricingPlanId:      priceListId,
    pricingVariableId:  data.vlocity_cmt__PricingVariableId__c,
    pricingElementName: data.Name,
  });
  if (!validation.valid) {
    throw new ValidationError(validation.errors.map(e => e.message).join(' | '));
  }
  return sfPost(username, 'vlocity_cmt__PricingElement__c', { ...data, vlocity_cmt__PriceListId__c: priceListId });
}
async function updatePricingElement(username, id, data) {
  return sfPatch(username, 'vlocity_cmt__PricingElement__c', id, data);
}
async function deletePricingElement(username, id) {
  return sfDelete(username, 'vlocity_cmt__PricingElement__c', id);
}

// ─────────────────────────────────────────────
// Pricing Variables (vlocity_cmt__PricingVariable__c)
// ─────────────────────────────────────────────
async function getPricingVariables(username, filters = {}) {
  await salesforceService.authenticateWithSfdx(username);
  const fs = await getFieldSet('vlocity_cmt__PricingVariable__c');
  const fields = buildFieldList(fs, [
    'vlocity_cmt__Code__c', 'vlocity_cmt__IsActive__c',
    'vlocity_cmt__Description__c', 'vlocity_cmt__GlobalKey__c',
  ]);
  let soql = `SELECT ${fields.join(', ')} FROM vlocity_cmt__PricingVariable__c`;
  const cond = [];
  if (filters.search) cond.push(`(Name LIKE '%${escapeSoql(filters.search)}%'${fs.has('vlocity_cmt__Code__c') ? ` OR vlocity_cmt__Code__c LIKE '%${escapeSoql(filters.search)}%'` : ''})`);
  if (filters.isActive !== undefined && fs.has('vlocity_cmt__IsActive__c')) cond.push(`vlocity_cmt__IsActive__c = ${filters.isActive}`);
  if (cond.length) soql += ` WHERE ${cond.join(' AND ')}`;
  soql += paginate(filters);
  const result = await salesforceService.query(soql);
  return { records: result.records || [], totalSize: result.totalSize || 0 };
}

async function createPricingVariable(username, data) {
  return sfPost(username, 'vlocity_cmt__PricingVariable__c', data);
}
async function updatePricingVariable(username, id, data) {
  return sfPatch(username, 'vlocity_cmt__PricingVariable__c', id, data);
}
async function deletePricingVariable(username, id) {
  return sfDelete(username, 'vlocity_cmt__PricingVariable__c', id);
}

// ─────────────────────────────────────────────
// Attribute Categories (vlocity_cmt__AttributeCategory__c)
// ─────────────────────────────────────────────
async function getAttributeCategories(username, filters = {}) {
  await salesforceService.authenticateWithSfdx(username);
  const fs = await getFieldSet('vlocity_cmt__AttributeCategory__c');
  const fields = buildFieldList(fs, [
    'vlocity_cmt__Code__c', 'vlocity_cmt__IsActive__c',
    'vlocity_cmt__GlobalKey__c', 'vlocity_cmt__DisplaySequence__c',
  ]);
  let soql = `SELECT ${fields.join(', ')} FROM vlocity_cmt__AttributeCategory__c`;
  const cond = [];
  if (filters.search) cond.push(`Name LIKE '%${escapeSoql(filters.search)}%'`);
  if (filters.isActive !== undefined && fs.has('vlocity_cmt__IsActive__c')) cond.push(`vlocity_cmt__IsActive__c = ${filters.isActive}`);
  if (cond.length) soql += ` WHERE ${cond.join(' AND ')}`;
  soql += paginate(filters);
  const result = await salesforceService.query(soql);
  return { records: result.records || [], totalSize: result.totalSize || 0 };
}

async function createAttributeCategory(username, data) {
  return sfPost(username, 'vlocity_cmt__AttributeCategory__c', data);
}
async function updateAttributeCategory(username, id, data) {
  return sfPatch(username, 'vlocity_cmt__AttributeCategory__c', id, data);
}
async function deleteAttributeCategory(username, id) {
  return sfDelete(username, 'vlocity_cmt__AttributeCategory__c', id);
}

// ─────────────────────────────────────────────
// Attributes (vlocity_cmt__Attribute__c)
// ─────────────────────────────────────────────
async function getAttributes(username, categoryId, filters = {}) {
  await salesforceService.authenticateWithSfdx(username);
  const fs = await getFieldSet('vlocity_cmt__Attribute__c');
  const fields = buildFieldList(fs, [
    'vlocity_cmt__Code__c', 'vlocity_cmt__IsActive__c',
    'vlocity_cmt__AttributeCategoryId__c', 'vlocity_cmt__GlobalKey__c',
    'vlocity_cmt__DisplaySequence__c', 'vlocity_cmt__AttributeDataType__c',
  ]);
  let soql = `SELECT ${fields.join(', ')} FROM vlocity_cmt__Attribute__c`;
  const cond = [];
  if (categoryId && fs.has('vlocity_cmt__AttributeCategoryId__c')) cond.push(`vlocity_cmt__AttributeCategoryId__c = '${escapeSoql(categoryId)}'`);
  if (filters.search) cond.push(`Name LIKE '%${escapeSoql(filters.search)}%'`);
  if (cond.length) soql += ` WHERE ${cond.join(' AND ')}`;
  soql += paginate(filters);
  const result = await salesforceService.query(soql);
  return { records: result.records || [], totalSize: result.totalSize || 0 };
}

async function createAttribute(username, categoryId, data) {
  return sfPost(username, 'vlocity_cmt__Attribute__c', { ...data, vlocity_cmt__AttributeCategoryId__c: categoryId });
}
async function updateAttribute(username, id, data) {
  return sfPatch(username, 'vlocity_cmt__Attribute__c', id, data);
}
async function deleteAttribute(username, id) {
  return sfDelete(username, 'vlocity_cmt__Attribute__c', id);
}

// ─────────────────────────────────────────────
// Picklists (vlocity_cmt__Picklist__c)
// ─────────────────────────────────────────────
async function getPicklists(username, filters = {}) {
  await salesforceService.authenticateWithSfdx(username);
  const fs = await getFieldSet('vlocity_cmt__Picklist__c');
  const fields = buildFieldList(fs, [
    'vlocity_cmt__IsActive__c', 'vlocity_cmt__GlobalKey__c',
  ]);
  let soql = `SELECT ${fields.join(', ')} FROM vlocity_cmt__Picklist__c`;
  const cond = [];
  if (filters.search) cond.push(`Name LIKE '%${escapeSoql(filters.search)}%'`);
  if (filters.isActive !== undefined && fs.has('vlocity_cmt__IsActive__c')) cond.push(`vlocity_cmt__IsActive__c = ${filters.isActive}`);
  if (cond.length) soql += ` WHERE ${cond.join(' AND ')}`;
  soql += paginate(filters);
  const result = await salesforceService.query(soql);
  return { records: result.records || [], totalSize: result.totalSize || 0 };
}

async function createPicklist(username, data) {
  return sfPost(username, 'vlocity_cmt__Picklist__c', data);
}
async function updatePicklist(username, id, data) {
  return sfPatch(username, 'vlocity_cmt__Picklist__c', id, data);
}
async function deletePicklist(username, id) {
  return sfDelete(username, 'vlocity_cmt__Picklist__c', id);
}

// ─────────────────────────────────────────────
// Picklist Values (vlocity_cmt__PicklistValue__c)
// ─────────────────────────────────────────────
async function getPicklistValues(username, picklistId) {
  await salesforceService.authenticateWithSfdx(username);
  const fs = await getFieldSet('vlocity_cmt__PicklistValue__c');
  const fields = buildFieldList(fs, [
    'vlocity_cmt__Code__c', 'vlocity_cmt__Sequence__c',
    'vlocity_cmt__IsDefaultValue__c', 'vlocity_cmt__IsActive__c',
    'vlocity_cmt__GlobalKey__c', 'vlocity_cmt__PicklistId__c',
  ]);
  const orderBy = fs.has('vlocity_cmt__Sequence__c') ? 'vlocity_cmt__Sequence__c' : 'Name';
  const soql = `SELECT ${fields.join(', ')}
  FROM vlocity_cmt__PicklistValue__c
  WHERE vlocity_cmt__PicklistId__c = '${escapeSoql(picklistId)}'
  ORDER BY ${orderBy} LIMIT 200`;
  const result = await salesforceService.query(soql);
  return { records: result.records || [], totalSize: result.totalSize || 0 };
}

async function createPicklistValue(username, picklistId, data) {
  return sfPost(username, 'vlocity_cmt__PicklistValue__c', { ...data, vlocity_cmt__PicklistId__c: picklistId });
}
async function updatePicklistValue(username, id, data) {
  return sfPatch(username, 'vlocity_cmt__PicklistValue__c', id, data);
}
async function deletePicklistValue(username, id) {
  return sfDelete(username, 'vlocity_cmt__PicklistValue__c', id);
}

// ─────────────────────────────────────────────
// Catalogs (vlocity_cmt__Catalog__c)
// ─────────────────────────────────────────────
async function getCatalogs(username, filters = {}) {
  await salesforceService.authenticateWithSfdx(username);
  const fs = await getFieldSet('vlocity_cmt__Catalog__c');
  const fields = buildFieldList(fs, [
    'vlocity_cmt__Code__c', 'vlocity_cmt__IsActive__c',
    'vlocity_cmt__GlobalKey__c', 'vlocity_cmt__Description__c',
    'vlocity_cmt__CatalogType__c',
  ]);
  let soql = `SELECT ${fields.join(', ')} FROM vlocity_cmt__Catalog__c`;
  const cond = [];
  if (filters.search) cond.push(`Name LIKE '%${escapeSoql(filters.search)}%'`);
  if (filters.isActive !== undefined && fs.has('vlocity_cmt__IsActive__c')) cond.push(`vlocity_cmt__IsActive__c = ${filters.isActive}`);
  if (cond.length) soql += ` WHERE ${cond.join(' AND ')}`;
  soql += paginate(filters);
  const result = await salesforceService.query(soql);
  return { records: result.records || [], totalSize: result.totalSize || 0 };
}
async function createCatalog(username, data) {
  return sfPost(username, 'vlocity_cmt__Catalog__c', data);
}
async function updateCatalog(username, id, data) {
  return sfPatch(username, 'vlocity_cmt__Catalog__c', id, data);
}
async function deleteCatalog(username, id) {
  return sfDelete(username, 'vlocity_cmt__Catalog__c', id);
}

// ─────────────────────────────────────────────
// Catalog-Product / Catalog-Catalog Relationships (vlocity_cmt__CatalogProductRelationship__c)
// ─────────────────────────────────────────────
async function getCatalogProducts(username, catalogId, itemType = null) {
  await salesforceService.authenticateWithSfdx(username);
  const fs = await getFieldSet('vlocity_cmt__CatalogProductRelationship__c');
  const fields = buildFieldList(fs, [
    'vlocity_cmt__CatalogId__c', 'vlocity_cmt__Product2Id__c',
    'vlocity_cmt__IsActive__c', 'vlocity_cmt__ItemType__c',
    'vlocity_cmt__SequenceNumber__c', 'vlocity_cmt__Sequence__c',
    'vlocity_cmt__EffectiveDate__c', 'vlocity_cmt__EndDate__c',
    'vlocity_cmt__PromotionId__c',
  ]);
  const rel = fs.has('vlocity_cmt__Product2Id__c')
    ? ', vlocity_cmt__Product2Id__r.Name, vlocity_cmt__Product2Id__r.ProductCode' : '';
  const cond = [`vlocity_cmt__CatalogId__c = '${escapeSoql(catalogId)}'`];
  if (itemType && fs.has('vlocity_cmt__ItemType__c')) {
    cond.push(`vlocity_cmt__ItemType__c = '${escapeSoql(itemType)}'`);
  }
  const soql = `SELECT ${fields.join(', ')}${rel}
  FROM vlocity_cmt__CatalogProductRelationship__c
  WHERE ${cond.join(' AND ')} ORDER BY Name LIMIT 500`;
  const result = await salesforceService.query(soql);
  return { records: result.records || [], totalSize: result.totalSize || 0 };
}
async function createCatalogProduct(username, catalogId, productId, itemType = 'Product') {
  const validation = await _catalogProductEngine.run(username, {
    catalogId,
    productId,
    relationshipType: itemType,
  });
  if (!validation.valid) {
    throw new ValidationError(validation.errors.map(e => e.message).join(' | '));
  }
  const fieldSet = await getFieldSet('vlocity_cmt__CatalogProductRelationship__c');
  const data = {
    vlocity_cmt__CatalogId__c:  catalogId,
    vlocity_cmt__Product2Id__c: productId,
  };
  if (fieldSet.has('vlocity_cmt__ItemType__c')) data.vlocity_cmt__ItemType__c = itemType;
  return sfPost(username, 'vlocity_cmt__CatalogProductRelationship__c', data);
}
async function deleteCatalogProduct(username, id) {
  return sfDelete(username, 'vlocity_cmt__CatalogProductRelationship__c', id);
}

// ─────────────────────────────────────────────
// Product Child Items (vlocity_cmt__ProductChildItem__c)
// ─────────────────────────────────────────────
async function getProductChildItems(username, parentProductId, filters = {}) {
  await salesforceService.authenticateWithSfdx(username);
  const fs = await getFieldSet('vlocity_cmt__ProductChildItem__c');
  const fields = buildFieldList(fs, [
    'vlocity_cmt__ParentProductId__c', 'vlocity_cmt__ChildProductId__c',
    'vlocity_cmt__GlobalKey__c', 'vlocity_cmt__Sequence__c',
    'vlocity_cmt__IsActive__c', 'vlocity_cmt__IsIncluded__c',
    'vlocity_cmt__MinimumQuantity__c', 'vlocity_cmt__MaximumQuantity__c',
    'vlocity_cmt__DefaultQuantity__c',
  ]);
  const rel = [
    fs.has('vlocity_cmt__ParentProductId__c') ? 'vlocity_cmt__ParentProductId__r.Name, vlocity_cmt__ParentProductId__r.ProductCode' : '',
    fs.has('vlocity_cmt__ChildProductId__c') ? 'vlocity_cmt__ChildProductId__r.Name, vlocity_cmt__ChildProductId__r.ProductCode' : '',
  ].filter(Boolean);
  const relStr = rel.length ? ', ' + rel.join(', ') : '';
  const cond = [];
  if (parentProductId) cond.push(`vlocity_cmt__ParentProductId__c = '${escapeSoql(parentProductId)}'`);
  if (filters.search) cond.push(`(vlocity_cmt__ParentProductId__r.Name LIKE '%${escapeSoql(filters.search)}%' OR vlocity_cmt__ChildProductId__r.Name LIKE '%${escapeSoql(filters.search)}%')`);
  let soql = `SELECT ${fields.join(', ')}${relStr} FROM vlocity_cmt__ProductChildItem__c`;
  if (cond.length) soql += ` WHERE ${cond.join(' AND ')}`;
  soql += ` ORDER BY Name LIMIT 200`;
  const result = await salesforceService.query(soql);
  return { records: result.records || [], totalSize: result.totalSize || 0 };
}
async function createProductChildItem(username, parentProductId, childProductId, data = {}) {
  return sfPost(username, 'vlocity_cmt__ProductChildItem__c', {
    ...data,
    vlocity_cmt__ParentProductId__c: parentProductId,
    vlocity_cmt__ChildProductId__c: childProductId,
  });
}
async function deleteProductChildItem(username, id) {
  return sfDelete(username, 'vlocity_cmt__ProductChildItem__c', id);
}

// ─────────────────────────────────────────────
// Batch Jobs (AsyncApexJob)
// ─────────────────────────────────────────────
async function getBatchJobs(username) {
  await salesforceService.authenticateWithSfdx(username);
  const soql = `SELECT Id, ApexClass.Name, Status, TotalJobItems, JobItemsProcessed,
    NumberOfErrors, CreatedDate
  FROM AsyncApexJob
  WHERE JobType = 'BatchApex'
  ORDER BY CreatedDate DESC LIMIT 20`;
  const result = await salesforceService.query(soql);
  return { records: result.records || [] };
}

async function executeBatch(username, apexClassName, country) {
  await salesforceService.authenticateWithSfdx(username);
  const safeClass = apexClassName.replace(/[^a-zA-Z0-9_]/g, '');
  const safeCountry = country ? escapeSoql(country) : null;
  const body = safeCountry
    ? `Database.executeBatch(new ${safeClass}('${safeCountry}'));`
    : `Database.executeBatch(new ${safeClass}());`;
  const response = await axios.get(
    `${salesforceService.baseUrl}/tooling/executeAnonymous?anonymousBody=${encodeURIComponent(body)}`,
    { headers: { Authorization: `Bearer ${salesforceService.accessToken}` } }
  );
  return response.data;
}

// ─────────────────────────────────────────────
// Stats (parallel COUNT queries)
// ─────────────────────────────────────────────
async function getStats(username) {
  await salesforceService.authenticateWithSfdx(username);
  const [pl, pr, rc, rt, pd] = await Promise.allSettled([
    salesforceService.query(`SELECT COUNT(Id) cnt FROM vlocity_cmt__PriceList__c WHERE vlocity_cmt__IsActive__c = true`),
    salesforceService.query(`SELECT COUNT(Id) cnt FROM vlocity_cmt__Promotion__c WHERE vlocity_cmt__IsActive__c = true`),
    salesforceService.query(`SELECT COUNT(Id) cnt FROM GT_RateCode__c`),
    salesforceService.query(`SELECT COUNT(Id) cnt FROM GT_RateTable__c`),
    salesforceService.query(`SELECT COUNT(Id) cnt FROM Product2 WHERE IsActive = true`),
  ]);
  const get = (r) => r.status === 'fulfilled' ? (r.value.records?.[0]?.cnt || r.value.records?.[0]?.expr0 || 0) : 0;
  return {
    priceLists:  get(pl),
    promotions:  get(pr),
    rateCodes:   get(rc),
    rateTables:  get(rt),
    products:    get(pd),
  };
}

// ─────────────────────────────────────────────
// Full data export for snapshot (all active records)
// ─────────────────────────────────────────────
async function exportForSnapshot(username) {
  await salesforceService.authenticateWithSfdx(username);
  const [pl, pr, rc, rt, pd] = await Promise.all([
    salesforceService.query(`SELECT Id, Name, vlocity_cmt__Code__c, vlocity_cmt__Description__c, vlocity_cmt__CurrencyCode__c, vlocity_cmt__IsActive__c, vlocity_cmt__EffectiveFromDate__c, vlocity_cmt__EffectiveUntilDate__c, vlocity_cmt__GlobalKey__c, GT_PriceListType__c, GT_CountryCode__c, GT_IsPrimary__c FROM vlocity_cmt__PriceList__c ORDER BY Name LIMIT 2000`),
    salesforceService.query(`SELECT Id, Name, vlocity_cmt__Code__c, vlocity_cmt__Description__c, vlocity_cmt__IsActive__c, vlocity_cmt__GlobalKey__c, vlocity_cmt__PriceListId__c, GT_Type__c, Promotion_Trigger__c FROM vlocity_cmt__Promotion__c ORDER BY Name LIMIT 2000`),
    salesforceService.query(`SELECT Id, Name, GT_GlobalKey__c, GT_OrgCode__c, GT_VATCode__c, GT_VATDescription__c, GT_VATRate__c, GT_StartDate__c, GT_EndDate__c, CurrencyIsoCode FROM GT_RateCode__c ORDER BY Name LIMIT 2000`),
    salesforceService.query(`SELECT Id, Name, GT_GlobalKey__c, GT_OrgCode__c, Product__c, GT_ProductName_Text__c, GT_RateCode__c, GT_RateDescription__c, GT_StartDate__c, GT_EndDate__c, GT_VATType__c, CurrencyIsoCode FROM GT_RateTable__c ORDER BY Name LIMIT 2000`),
    salesforceService.query(`SELECT Id, Name, ProductCode, Family, IsActive, Description FROM Product2 WHERE IsActive = true ORDER BY Name LIMIT 2000`),
  ]);
  return {
    priceLists:  pl.records  || [],
    promotions:  pr.records  || [],
    rateCodes:   rc.records  || [],
    rateTables:  rt.records  || [],
    products:    pd.records  || [],
    capturedAt:  new Date().toISOString(),
    username,
  };
}

module.exports = {
  escapeSoql,
  sfUpsertBulk,
  getProducts, getProductById, createProduct, updateProduct, deleteProduct,
  getPriceLists, getPriceListById, createPriceList, updatePriceList, deletePriceList,
  getPriceListEntries, createPriceListEntry, updatePriceListEntry, deletePriceListEntry,
  getPricingElements, createPricingElement, updatePricingElement, deletePricingElement,
  getPricingVariables, createPricingVariable, updatePricingVariable, deletePricingVariable,
  getAttributeCategories, createAttributeCategory, updateAttributeCategory, deleteAttributeCategory,
  getAttributes, createAttribute, updateAttribute, deleteAttribute,
  getPicklists, createPicklist, updatePicklist, deletePicklist,
  getPicklistValues, createPicklistValue, updatePicklistValue, deletePicklistValue,
  getCatalogs, createCatalog, updateCatalog, deleteCatalog,
  getCatalogProducts, createCatalogProduct, deleteCatalogProduct,
  getProductChildItems, createProductChildItem, deleteProductChildItem,
  getPromotions, getPromotionById, createPromotion, updatePromotion, deletePromotion,
  getPromotionRules, createPromotionRule, updatePromotionRule, deletePromotionRule,
  getRateCodes, getRateCodeById, createRateCode, updateRateCode, deleteRateCode,
  getRateTables, getRateTableById, createRateTable, updateRateTable, deleteRateTable,
  getBatchJobs, executeBatch,
  getStats,
  exportForSnapshot,
};
