/**
 * Vlocity DataPack Type Dependency Tiers
 *
 * Types in lower tiers have no dependencies on types in higher tiers.
 * When exporting/deploying multiple types, sort by tier (ascending) to
 * ensure parents are processed before children, reducing reference errors.
 *
 * Unknown types are assigned tier 99 (processed last).
 */
const DEPENDENCY_TIERS = [
  // Tier 0 — standalone primitives (no cross-type dependencies)
  ['VlocityPicklist', 'VlocityAttachment', 'AttributeCategory', 'Rule', 'Approval'],

  // Tier 1 — depends on Tier 0
  ['AttributeDefinition', 'Ruleset'],

  // Tier 2 — core product/object data
  ['Product2', 'ObjectLayout', 'CustomObject', 'VlocityFunction'],

  // Tier 3 — pricing structures (depend on Product2)
  ['PriceList'],

  // Tier 4 — price entries + product relationships (depend on PriceList / Product2)
  [
    'PriceListEntry',
    'PricingElement',
    'PricingPlan',
    'ProductChildItem',
    'CatalogProductRelationship',
    'AttributeAssignment',
    'PromotionRule',
    'Promotion',
  ],

  // Tier 5 — UI building blocks (depend on data objects)
  ['DataRaptor', 'VlocityUITemplate', 'VlocityCard', 'VlocitySearchWidget'],

  // Tier 6 — processes / integrations (depend on DataRaptor, data objects)
  ['IntegrationProcedure', 'OmniIntegrationProcedure'],

  // Tier 7 — OmniStudio components (depend on Tier 5 + 6)
  ['OmniScript', 'FlexCard', 'OmniUiCard', 'OmniDataTransform'],

  // Tier 8 — top-level compositions (depend on everything below)
  [
    'VlocityUILayout',
    'DocTemplate',
    'DocumentTemplate',
    'ContractType',
    'StoryElement',
    'VlocityActionLauncher',
  ],
];

// Flat map: typeName → tier number (case-insensitive lookup)
const TYPE_TIER_MAP = new Map();
DEPENDENCY_TIERS.forEach((tier, index) => {
  tier.forEach(type => {
    TYPE_TIER_MAP.set(type.toLowerCase(), index);
  });
});

const UNKNOWN_TIER = 99;

/**
 * Get the dependency tier for a DataPack type.
 * @param {string} vlocityDataPackType
 * @returns {number} tier (0–8 known, 99 for unknown)
 */
function getTier(vlocityDataPackType) {
  if (!vlocityDataPackType) return UNKNOWN_TIER;
  return TYPE_TIER_MAP.get(vlocityDataPackType.toLowerCase()) ?? UNKNOWN_TIER;
}

/**
 * Sort an array of query objects by their DataPack type dependency tier.
 * Queries with unknown types are placed last (tier 99).
 *
 * Works with both Vlocity CLI query format:
 *   { VlocityDataPackType: 'Product2', query: '...' }
 * and SF CLI format:
 *   { object: 'Product2', name: '...' }
 *
 * @param {Array<object>} queries
 * @returns {Array<object>} new sorted array (original is not mutated)
 */
function sortQueriesByDependency(queries) {
  if (!Array.isArray(queries) || queries.length <= 1) return queries;

  return [...queries].sort((a, b) => {
    const typeA = a.VlocityDataPackType || a.object || '';
    const typeB = b.VlocityDataPackType || b.object || '';
    return getTier(typeA) - getTier(typeB);
  });
}

/**
 * Group queries by tier for logging / diagnostics.
 * @param {Array<object>} queries
 * @returns {Map<number, Array<object>>} tier → queries[]
 */
function groupQueriesByTier(queries) {
  const groups = new Map();
  (queries || []).forEach(q => {
    const type = q.VlocityDataPackType || q.object || '';
    const tier = getTier(type);
    if (!groups.has(tier)) groups.set(tier, []);
    groups.get(tier).push(q);
  });
  return groups;
}

module.exports = { DEPENDENCY_TIERS, getTier, sortQueriesByDependency, groupQueriesByTier };
