/**
 * Catalog Validators
 *
 * Rule 15 – Duplicate CatalogProductRelationship
 */

const salesforceService = require('../services/salesforceService');
const logger = require('../utils/logger');

function esc(v) {
  if (typeof v !== 'string') return v;
  return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ─── Rule 15: Duplicate CatalogProductRelationship ───────────────────────────

/**
 * context: { catalogId, productId, relationshipType? }
 *
 * Prevents the Salesforce custom-validation error:
 *   "Catalog Product Relationship definition for the product X within Catalog Y already exists."
 */
const duplicateCatalogProductRelationshipRule = {
  id: 'catalog.duplicate-catalog-product-relationship',
  category: 'Catalog',
  async validate(username, context) {
    const { catalogId, productId, relationshipType } = context;

    if (!catalogId || !productId) return { errors: [], warnings: [] };

    await salesforceService.authenticateWithSfdx(username);

    const conditions = [
      `vlocity_cmt__CatalogId__c = '${esc(catalogId)}'`,
      `vlocity_cmt__Product2Id__c = '${esc(productId)}'`,
    ];
    if (relationshipType) {
      conditions.push(`vlocity_cmt__ItemType__c = '${esc(relationshipType)}'`);
    }

    const soql = `SELECT Id, Name,
      vlocity_cmt__CatalogId__r.Name,
      vlocity_cmt__Product2Id__r.Name
    FROM vlocity_cmt__CatalogProductRelationship__c
    WHERE ${conditions.join(' AND ')} LIMIT 1`;

    try {
      const result = await salesforceService.query(soql);
      if (result.totalSize > 0) {
        const rec         = result.records[0];
        const catalogName = rec['vlocity_cmt__CatalogId__r']?.Name  || catalogId;
        const productName = rec['vlocity_cmt__Product2Id__r']?.Name || productId;
        return {
          errors: [{
            message: `Catalog Product Relationship already exists for product "${productName}" within Catalog "${catalogName}"${relationshipType ? ` (type: ${relationshipType})` : ''} (Id: ${rec.Id}). Creation blocked to prevent duplicate.`,
            details: {
              existingId:   rec.Id,
              catalogName,
              productName,
              relationshipType: relationshipType || null,
            },
          }],
          warnings: [],
        };
      }
    } catch (err) {
      logger.warn('Rule catalog.duplicate-catalog-product-relationship: query failed', { error: err.message });
    }

    return { errors: [], warnings: [] };
  },
};

module.exports = {
  duplicateCatalogProductRelationshipRule,
};
