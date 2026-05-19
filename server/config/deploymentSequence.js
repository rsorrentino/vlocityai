/**
 * Strict Sequential Deployment Sequence
 *
 * Defines the exact order in which Vlocity / GT objects must be deployed
 * to avoid dependency errors.  Each entry contains:
 *
 *   step             {number}   1-based ordinal — do NOT reorder
 *   objectType       {string}   Salesforce API name / DataPack folder name
 *   vlocityDataPackType {string|null}  Vlocity Build type key (null for manual)
 *   deploymentType   {'datapack'|'manual'}
 *                       datapack → vlocity CLI  packDeploy
 *                       manual   → sf CLI  (sfCliService)
 *   nestedObjects    {string[]} Child objects that travel inside this parent's
 *                               DataPack.  They are skipped when we reach their
 *                               own step (because they are already deployed).
 *   skipIfNestedIn   {string|null}  If this object was already deployed as a
 *                                   nested child of a prior step, skip it.
 *   notes            {string}   Human-readable explanation.
 */

const DEPLOYMENT_SEQUENCE = [
  {
    step: 1,
    objectType: 'ObjectClass__c',
    vlocityDataPackType: 'ObjectClass',
    deploymentType: 'datapack',
    nestedObjects: [],
    skipIfNestedIn: null,
    notes: 'Base object class definitions — must be first.',
  },
  {
    step: 2,
    objectType: 'ObjectFieldAttribute__c',
    vlocityDataPackType: 'ObjectFieldAttribute',
    deploymentType: 'datapack',
    nestedObjects: [],
    skipIfNestedIn: null,
    notes: 'Field attribute definitions.',
  },
  {
    step: 3,
    objectType: 'UIFacet__c',
    vlocityDataPackType: 'UIFacet',
    deploymentType: 'datapack',
    nestedObjects: [],
    skipIfNestedIn: null,
    notes: 'UI facet definitions.',
  },
  {
    step: 4,
    objectType: 'UISection__c',
    vlocityDataPackType: 'UISection',
    deploymentType: 'datapack',
    nestedObjects: [],
    skipIfNestedIn: null,
    notes: 'UI section definitions.',
  },
  {
    step: 5,
    objectType: 'ObjectLayout__c',
    vlocityDataPackType: 'ObjectLayout',
    deploymentType: 'datapack',
    nestedObjects: ['ObjectFacet__c', 'ObjectSection__c', 'ObjectElement__c'],
    skipIfNestedIn: null,
    notes: 'Object layouts — brings ObjectFacet__c, ObjectSection__c, ObjectElement__c as nested children.',
  },
  {
    step: 6,
    objectType: 'Picklist__c',
    vlocityDataPackType: 'Picklist',
    deploymentType: 'datapack',
    nestedObjects: [],
    skipIfNestedIn: null,
    notes: 'Picklist definitions.',
  },
  {
    step: 7,
    objectType: 'AttributeCategory__c',
    vlocityDataPackType: 'AttributeCategory',
    deploymentType: 'datapack',
    nestedObjects: ['Attribute__c'],
    skipIfNestedIn: null,
    notes: 'Attribute categories — brings Attribute__c as nested child.',
  },
  {
    step: 8,
    objectType: 'Attribute__c',
    vlocityDataPackType: 'Attribute',
    deploymentType: 'datapack',
    nestedObjects: [],
    skipIfNestedIn: 'AttributeCategory__c',
    notes: 'Standalone attributes — skipped if already deployed inside AttributeCategory__c.',
  },
  {
    step: 9,
    objectType: 'VlocityFunction__c',
    vlocityDataPackType: 'VlocityFunction',
    deploymentType: 'datapack',
    nestedObjects: [],
    skipIfNestedIn: null,
    notes: 'Vlocity function definitions.',
  },
  {
    step: 10,
    objectType: 'ContextDimension__c',
    vlocityDataPackType: 'ContextDimension',
    deploymentType: 'datapack',
    nestedObjects: ['ContextMapping__c'],
    skipIfNestedIn: null,
    notes: 'Context dimensions — brings ContextMapping__c as nested child.',
  },
  {
    step: 11,
    objectType: 'ContextScope__c',
    vlocityDataPackType: 'ContextScope',
    deploymentType: 'datapack',
    nestedObjects: [],
    skipIfNestedIn: null,
    notes: 'Context scope definitions.',
  },
  {
    step: 12,
    objectType: 'EntityFilter__c',
    vlocityDataPackType: 'EntityFilter',
    deploymentType: 'datapack',
    nestedObjects: ['EntityFilterCondition__c'],
    skipIfNestedIn: null,
    notes: 'Entity filters — brings EntityFilterCondition__c as nested child.',
  },
  {
    step: 13,
    objectType: 'Rule__c',
    vlocityDataPackType: 'Rule',
    deploymentType: 'datapack',
    nestedObjects: ['RuleVariable__c', 'RuleAction__c', 'RuleFilter__c'],
    skipIfNestedIn: null,
    notes: 'Rules — brings RuleVariable__c, RuleAction__c, RuleFilter__c as nested children.',
  },
  {
    step: 14,
    objectType: 'vlocity_cmt__PriceList__c',
    vlocityDataPackType: 'PriceList',
    deploymentType: 'datapack',
    nestedObjects: ['vlocity_cmt__PricingElement__c', 'vlocity_cmt__PricingVariable__c'],
    skipIfNestedIn: null,
    notes: 'Price lists — brings PricingElement__c and PricingVariable__c as nested children.',
  },
  {
    step: 15,
    objectType: 'PricingPlan__c',
    vlocityDataPackType: 'PricingPlan',
    deploymentType: 'datapack',
    nestedObjects: ['PricingPlanStep__c'],
    skipIfNestedIn: null,
    notes: 'Pricing plans — brings PricingPlanStep__c as nested child.',
  },
  {
    step: 16,
    objectType: 'vlocity_cmt__PricingVariable__c',
    vlocityDataPackType: 'PricingVariable',
    deploymentType: 'datapack',
    nestedObjects: [],
    skipIfNestedIn: 'vlocity_cmt__PriceList__c',
    notes: 'Standalone pricing variables — skipped if already deployed inside PriceList__c.',
  },
  {
    step: 17,
    objectType: 'vlocity_cmt__PricingElement__c',
    vlocityDataPackType: 'PricingElement',
    deploymentType: 'datapack',
    nestedObjects: [],
    skipIfNestedIn: 'vlocity_cmt__PriceList__c',
    notes: 'Standalone pricing elements — skipped if already deployed inside PriceList__c. Pay attention to GlobalKey.',
  },
  {
    step: 18,
    objectType: 'Product2',
    vlocityDataPackType: 'Product2',
    deploymentType: 'datapack',
    nestedObjects: [
      'PricebookEntry',
      'vlocity_cmt__AttributeAssignment__c',
      'vlocity_cmt__ProductChildItem__c',
      'vlocity_cmt__OverrideDefinition__c',
      'vlocity_cmt__ProductConfigurationProcedure__c',
      'vlocity_cmt__ProductRelationship__c',
      'vlocity_cmt__ProductEligibility__c',
      'vlocity_cmt__ProductAvailability__c',
      'vlocity_cmt__RuleAssignment__c',
      'vlocity_cmt__ProductRequirement__c',
      'ObjectFieldAttribute__c',
      'vlocity_cmt__PricingElement__c',
      'vlocity_cmt__PriceListEntry__c',
    ],
    skipIfNestedIn: null,
    notes: 'Product catalog — brings all product sub-objects as nested children.',
  },
  {
    step: 19,
    objectType: 'vlocity_cmt__PriceListEntry__c',
    vlocityDataPackType: 'PriceListEntry',
    deploymentType: 'datapack',
    nestedObjects: [],
    skipIfNestedIn: 'Product2',
    notes: 'Standalone price list entries — skipped if already deployed inside Product2.',
  },
  {
    step: 20,
    objectType: 'vlocity_cmt__Promotion__c',
    vlocityDataPackType: 'Promotion',
    deploymentType: 'datapack',
    nestedObjects: ['vlocity_cmt__PromotionItem__c'],
    skipIfNestedIn: null,
    notes: 'Promotions — brings PromotionItem__c as nested child.',
  },
  {
    step: 21,
    objectType: 'vlocity_cmt__AttributeAssignment__c',
    vlocityDataPackType: 'AttributeAssignment',
    deploymentType: 'datapack',
    nestedObjects: [],
    skipIfNestedIn: 'Product2',
    notes: 'Standalone attribute assignments — skipped if already deployed inside Product2.',
  },
  {
    step: 22,
    objectType: 'GT_ProductSKU__c',
    vlocityDataPackType: null,
    deploymentType: 'manual',
    nestedObjects: [],
    skipIfNestedIn: null,
    notes: 'GT Product SKU — deployed via sf CLI (manual insert/upsert).',
  },
  {
    step: 23,
    objectType: 'GT_RateTable__c',
    vlocityDataPackType: null,
    deploymentType: 'manual',
    nestedObjects: [],
    skipIfNestedIn: null,
    notes: 'GT Rate Table — deployed via sf CLI.',
  },
  {
    step: 24,
    objectType: 'vlocity_cmt__Catalog__c',
    vlocityDataPackType: null,
    deploymentType: 'manual',
    nestedObjects: [],
    skipIfNestedIn: null,
    notes: 'Vlocity Catalog — deployed via sf CLI.',
  },
  {
    step: 25,
    objectType: 'vlocity_cmt__CatalogRelationship__c',
    vlocityDataPackType: null,
    deploymentType: 'manual',
    nestedObjects: [],
    skipIfNestedIn: null,
    notes: 'Catalog relationships — deployed via sf CLI after Catalog.',
  },
  {
    step: 26,
    objectType: 'vlocity_cmt__CatalogProductRelationship__c',
    vlocityDataPackType: null,
    deploymentType: 'manual',
    nestedObjects: [],
    skipIfNestedIn: null,
    notes: 'Catalog-product relationships — deployed via sf CLI after CatalogRelationship.',
  },
  {
    step: 27,
    objectType: 'String__c',
    vlocityDataPackType: 'String',
    deploymentType: 'datapack',
    nestedObjects: ['StringTranslation__c'],
    skipIfNestedIn: null,
    notes: 'Translations — brings StringTranslation__c as nested child.',
  },
];

/** Set of all object types that are deployed as nested children of another step. */
const NESTED_CHILD_OBJECTS = new Set(
  DEPLOYMENT_SEQUENCE.flatMap(s => s.nestedObjects)
);

/** Map from objectType → the parent step whose DataPack already includes it. */
const NESTED_IN_MAP = DEPLOYMENT_SEQUENCE.reduce((map, step) => {
  step.nestedObjects.forEach(child => {
    if (!map[child]) map[child] = step.objectType;
  });
  return map;
}, {});

module.exports = { DEPLOYMENT_SEQUENCE, NESTED_CHILD_OBJECTS, NESTED_IN_MAP };
