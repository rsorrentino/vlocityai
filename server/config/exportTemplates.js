/**
 * Ready-made export job templates returned by GET /api/exports/templates.
 * A new array is built on each call so callers can change it freely.
 */
function getExportTemplates() {
  return [
    {
      name: 'Full Catalog Export',
      description: 'All standalone Vlocity DataPack types in dependency order. Sub-objects (CatalogProductRelationship, PriceListEntry, ProductChildItem, PromotionItem, PricingElement) are excluded — they are exported automatically as part of their parent type. Remove any type that does not exist in your org, or add WHERE clauses to filter records.',
      config: {
        name: 'Full Catalog Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          // ── Tier 1: No dependencies ────────────────────────────────────────────
          // No query needed — the CLI uses its built-in default query for each DataPack type.
          // Add a query field only if you need a custom WHERE clause or field selection.
          { VlocityDataPackType: 'AttributeAssignmentRule' },
          { VlocityDataPackType: 'AttributeCategory' },
          { VlocityDataPackType: 'CalculationMatrix' },
          { VlocityDataPackType: 'CalculationProcedure' },
          { VlocityDataPackType: 'ContextAction' },
          { VlocityDataPackType: 'ContextDimension' },
          { VlocityDataPackType: 'ContextScope' },
          { VlocityDataPackType: 'ContractType' },
          { VlocityDataPackType: 'CpqConfigurationSetup' },
          { VlocityDataPackType: 'DataRaptor', query: 'SELECT Id FROM vlocity_cmt__DRBundle__c WHERE vlocity_cmt__Type__c != \'Migration\'' },
          { VlocityDataPackType: 'DocumentClause' },
          { VlocityDataPackType: 'DocumentTemplate' },
          { VlocityDataPackType: 'EntityFilter' },
          { VlocityDataPackType: 'IntegrationRetryPolicy' },
          { VlocityDataPackType: 'InterfaceImplementation' },
          { VlocityDataPackType: 'ItemImplementation' },
          { VlocityDataPackType: 'ManualQueue' },
          { VlocityDataPackType: 'ObjectClass' },
          { VlocityDataPackType: 'ObjectContextRule' },
          { VlocityDataPackType: 'ObjectLayout' },
          { VlocityDataPackType: 'OfferMigrationPlan' },
          { VlocityDataPackType: 'OrchestrationDependencyDefinition' },
          { VlocityDataPackType: 'OrchestrationItemDefinition' },
          { VlocityDataPackType: 'OrchestrationPlanDefinition' },
          { VlocityDataPackType: 'PriceList' },
          { VlocityDataPackType: 'PricingPlan' },
          { VlocityDataPackType: 'PricingVariable' },
          { VlocityDataPackType: 'QueryBuilder' },
          { VlocityDataPackType: 'Rule' },
          { VlocityDataPackType: 'StoryObjectConfiguration' },
          { VlocityDataPackType: 'String' },
          { VlocityDataPackType: 'System' },
          { VlocityDataPackType: 'TimePlan' },
          { VlocityDataPackType: 'TimePolicy' },
          { VlocityDataPackType: 'UIFacet' },
          { VlocityDataPackType: 'UISection' },
          { VlocityDataPackType: 'VlocityAction' },
          { VlocityDataPackType: 'VlocityAttachment' },
          { VlocityDataPackType: 'VlocityCard' },
          { VlocityDataPackType: 'VlocityFunction' },
          { VlocityDataPackType: 'VlocityPicklist' },
          { VlocityDataPackType: 'VlocitySearchWidgetSetup' },
          { VlocityDataPackType: 'VlocityStateModel' },
          { VlocityDataPackType: 'VlocityUILayout' },
          { VlocityDataPackType: 'VlocityUITemplate' },
          { VlocityDataPackType: 'VqMachine' },
          { VlocityDataPackType: 'VqResource' },
          { VlocityDataPackType: 'IntegrationProcedure' },
          { VlocityDataPackType: 'OmniScript' },
          { VlocityDataPackType: 'Catalog' },
          { VlocityDataPackType: 'Promotion' },
          { VlocityDataPackType: 'SObject' },
          { VlocityDataPackType: 'SObject', query: 'SELECT Id FROM Product2 WHERE GT_IsTechnicalProduct__c = false' }
        ]
      }
    },
    {
      name: 'Blank',
      description: 'Empty template — start from scratch. Add only the DataPack types you need with custom SOQL filters.',
      config: {
        name: 'Custom Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          { VlocityDataPackType: 'SObject', query: 'SELECT Id FROM Product2' }
        ]
      }
    },
    {
      name: 'Product Catalog Export',
      description: 'Export product catalog and related objects. Optional: Add WHERE vlocity_cmt__Code__c = \'{PRICELIST_CODE}\' to PriceList queries to filter by specific PriceList. Objects follow the standard order.',
      config: {
        name: 'Product Catalog Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            comment: 'PriceList-Agnostic: Pricebook2',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM Pricebook2'
          },
          {
            comment: 'PriceList-Agnostic: Product2',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM Product2 WHERE LastModifiedDate >= 2025-01-01T00:00:00.000+0000 AND GT_IsTechnicalProduct__c = false'
          },
          {
            comment: 'PriceList-Agnostic: GT ProductSKUs',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id, GT_GlobalKey__c, CurrencyIsoCode, GT_ProductSKU__c, GT_Color__c, GT_OrganizationCode__c, GT_ProductName_Text__c, GT_LifeCycle__c, GT_ProductUse__c, Product__c, Product__r.vlocity_cmt__GlobalKey__c FROM GT_ProductSKU__c WHERE GT_GlobalKey__c != null'
          },
          {
            comment: 'PriceList-Agnostic: GT RateTables',
            VlocityDataPackType: 'RateTable',
            query: 'SELECT Id, GT_GlobalKey__c, CurrencyIsoCode, GT_EndDate__c, GT_OrgCode__c, GT_ProductName_Text__c, GT_RateCode__c, GT_RateCode__r.GT_GlobalKey__c, Product__c, Product__r.vlocity_cmt__GlobalKey__c, GT_StartDate__c, GT_UniqueKey__c, GT_VATType__c FROM GT_RateTable__c'
          },
          {
            comment: 'PriceList-Linked: PriceList (all or filter by adding WHERE vlocity_cmt__Code__c = \'{PRICELIST_CODE}\')',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PriceList__c'
          },
          {
            comment: 'PriceList-Agnostic: PricingVariables',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PricingVariable__c'
          },
          {
            comment: 'PriceList-Linked: PricingElements (all or filter by adding WHERE vlocity_cmt__PriceListId__r.vlocity_cmt__Code__c = \'{PRICELIST_CODE}\')',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PricingElement__c WHERE LastModifiedDate >= 2025-01-01T00:00:00.000+0000'
          },
          {
            comment: 'PriceList-Linked: PriceListEntry (all or filter by adding WHERE vlocity_cmt__PriceListId__r.vlocity_cmt__Code__c = \'{PRICELIST_CODE}\')',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PriceListEntry__c'
          },
          {
            comment: 'PriceList-Agnostic: Pricebook entries',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM PricebookEntry'
          },
          {
            comment: 'PriceList-Agnostic: PricingPlans',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PricingPlan__c'
          },
          {
            comment: 'PriceList-Agnostic: Promotions',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Promotion__c'
          },
          {
            comment: 'PriceList-Agnostic: Rules',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Rule__c'
          },
          {
            comment: 'PriceList-Agnostic: CatalogProductRelationship',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id, vlocity_cmt__CatalogId__c, vlocity_cmt__Product2Id__c, vlocity_cmt__Product2Id__r.vlocity_cmt__GlobalKey__c, vlocity_cmt__CatalogId__r.vlocity_cmt__GlobalKey__c FROM vlocity_cmt__CatalogProductRelationship__c'
          },
          {
            comment: 'PriceList-Agnostic: ObjectClass',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__ObjectClass__c'
          },
          {
            comment: 'PriceList-Agnostic: Attribute',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Attribute__c'
          },
          {
            comment: 'PriceList-Agnostic: AttributeCategories',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__AttributeCategory__c WHERE LastModifiedDate >= 2025-01-01T00:00:00.000+0000'
          },
          {
            comment: 'PriceList-Agnostic: AttributeAssignment',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__AttributeAssignment__c'
          },
          {
            comment: 'PriceList-Agnostic: UIFacet',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__UIFacet__c'
          },
          {
            comment: 'PriceList-Agnostic: UISection',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__UISection__c'
          },
          {
            comment: 'PriceList-Agnostic: ObjectLayout',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__ObjectLayout__c'
          },
          {
            comment: 'PriceList-Agnostic: Picklist',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Picklist__c'
          },
          {
            comment: 'PriceList-Agnostic: CalculationMatrix',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__CalculationMatrix__c'
          }
        ]
      }
    },
    {
      name: 'Pricing Complete Export',
      description: 'Export all pricing-related objects. Optional: Add WHERE vlocity_cmt__Code__c = \'{PRICELIST_CODE}\' to PriceList queries to filter by specific PriceList. Objects follow the standard order: PriceList-Agnostic first, then PriceList-Linked.',
      config: {
        name: 'Pricing Complete Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            comment: 'PriceList-Agnostic: Pricebook2',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM Pricebook2'
          },
          {
            comment: 'PriceList-Agnostic: Product2 (shared products)',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM Product2 WHERE GT_IsTechnicalProduct__c = false'
          },
          {
            comment: 'PriceList-Agnostic: GT ProductSKUs',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id, GT_GlobalKey__c, CurrencyIsoCode, GT_ProductSKU__c, GT_Color__c, GT_OrganizationCode__c, GT_ProductName_Text__c, GT_LifeCycle__c, GT_ProductUse__c, Product__c, Product__r.vlocity_cmt__GlobalKey__c FROM GT_ProductSKU__c WHERE GT_GlobalKey__c != null'
          },
          {
            comment: 'PriceList-Agnostic: GT RateTables',
            VlocityDataPackType: 'RateTable',
            query: 'SELECT Id, GT_GlobalKey__c, CurrencyIsoCode, GT_EndDate__c, GT_OrgCode__c, GT_ProductName_Text__c, GT_RateCode__c, GT_RateCode__r.GT_GlobalKey__c, Product__c, Product__r.vlocity_cmt__GlobalKey__c, GT_StartDate__c, GT_UniqueKey__c, GT_VATType__c FROM GT_RateTable__c'
          },
          {
            comment: 'PriceList-Linked: PriceList (all or filter by adding WHERE vlocity_cmt__Code__c = \'{PRICELIST_CODE}\')',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PriceList__c'
          },
          {
            comment: 'PriceList-Agnostic: PricingVariables',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PricingVariable__c'
          },
          {
            comment: 'PriceList-Linked: PricingElements (all or filter by adding WHERE vlocity_cmt__PriceListId__r.vlocity_cmt__Code__c = \'{PRICELIST_CODE}\')',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PricingElement__c'
          },
          {
            comment: 'PriceList-Linked: PriceListEntry (all or filter by adding WHERE vlocity_cmt__PriceListId__r.vlocity_cmt__Code__c = \'{PRICELIST_CODE}\')',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PriceListEntry__c'
          },
          {
            comment: 'PriceList-Agnostic: Pricebook entries',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM PricebookEntry'
          },
          {
            comment: 'PriceList-Agnostic: PricingPlans',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PricingPlan__c'
          },
          {
            comment: 'PriceList-Agnostic: Promotions',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Promotion__c'
          },
          {
            comment: 'PriceList-Agnostic: Rules',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Rule__c'
          },
          {
            comment: 'PriceList-Agnostic: CatalogProductRelationship',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id, vlocity_cmt__CatalogId__c, vlocity_cmt__Product2Id__c, vlocity_cmt__Product2Id__r.vlocity_cmt__GlobalKey__c, vlocity_cmt__CatalogId__r.vlocity_cmt__GlobalKey__c FROM vlocity_cmt__CatalogProductRelationship__c'
          },
          {
            comment: 'PriceList-Agnostic: ObjectClass',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__ObjectClass__c'
          },
          {
            comment: 'PriceList-Agnostic: Attribute',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Attribute__c'
          },
          {
            comment: 'PriceList-Agnostic: AttributeCategories',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__AttributeCategory__c'
          },
          {
            comment: 'PriceList-Agnostic: AttributeAssignment',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__AttributeAssignment__c'
          },
          {
            comment: 'PriceList-Agnostic: UIFacet',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__UIFacet__c'
          },
          {
            comment: 'PriceList-Agnostic: UISection',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__UISection__c'
          },
          {
            comment: 'PriceList-Agnostic: ObjectLayout',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__ObjectLayout__c'
          },
          {
            comment: 'PriceList-Agnostic: Picklist',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Picklist__c'
          },
          {
            comment: 'PriceList-Agnostic: CalculationMatrix',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__CalculationMatrix__c'
          }
        ]
      }
    },
    {
      name: 'PriceList Filtered Export',
      description: 'Export pricing objects filtered by a specific PriceList. Replace {PRICELIST_CODE} with the actual PriceList code (e.g., \'PL-FM-AU-001-060\'). Objects are grouped into: (1) PriceList-Agnostic objects that are included but not filtered, and (2) PriceList-Linked objects that are filtered by the selected PriceList.',
      config: {
        name: 'PriceList Filtered Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            comment: 'PriceList-Agnostic: Pricebook2',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM Pricebook2'
          },
          {
            comment: 'PriceList-Agnostic: Product2',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM Product2 WHERE GT_IsTechnicalProduct__c = false'
          },
          {
            comment: 'PriceList-Linked: The selected PriceList itself',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PriceList__c WHERE vlocity_cmt__Code__c = \'{PRICELIST_CODE}\''
          },
          {
            comment: 'PriceList-Agnostic: PricingVariables',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PricingVariable__c'
          },
          {
            comment: 'PriceList-Linked: Pricing Elements directly linked via vlocity_cmt__PriceListId__c',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PricingElement__c WHERE vlocity_cmt__PriceListId__r.vlocity_cmt__Code__c = \'{PRICELIST_CODE}\''
          },
          {
            comment: 'PriceList-Linked: PriceList entries directly linked via vlocity_cmt__PriceListId__c',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PriceListEntry__c WHERE vlocity_cmt__PriceListId__r.vlocity_cmt__Code__c = \'{PRICELIST_CODE}\''
          },
          {
            comment: 'PriceList-Agnostic: Pricebook entries',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM PricebookEntry'
          },
          {
            comment: 'PriceList-Agnostic: PricingPlans',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PricingPlan__c'
          },
          {
            comment: 'PriceList-Agnostic: Promotions',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Promotion__c'
          },
          {
            comment: 'PriceList-Agnostic: Rules',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Rule__c'
          },
          {
            comment: 'PriceList-Agnostic: CatalogProductRelationship',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__CatalogProductRelationship__c'
          },
          {
            comment: 'PriceList-Agnostic: ObjectClass',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__ObjectClass__c'
          },
          {
            comment: 'PriceList-Agnostic: Attribute',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Attribute__c'
          },
          {
            comment: 'PriceList-Agnostic: AttributeCategories',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__AttributeCategory__c'
          },
          {
            comment: 'PriceList-Agnostic: AttributeAssignment',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__AttributeAssignment__c'
          },
          {
            comment: 'PriceList-Agnostic: UIFacet',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__UIFacet__c'
          },
          {
            comment: 'PriceList-Agnostic: UISection',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__UISection__c'
          },
          {
            comment: 'PriceList-Agnostic: ObjectLayout',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__ObjectLayout__c'
          },
          {
            comment: 'PriceList-Agnostic: Picklist',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Picklist__c'
          },
          {
            comment: 'PriceList-Agnostic: CalculationMatrix',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__CalculationMatrix__c'
          }
        ]
      }
    },
    {
      name: 'PriceList Unfiltered Export',
      description: 'Export all pricing objects without PriceList filtering. This template includes all PriceList-Agnostic objects and can be used as a base for unfiltered exports.',
      config: {
        name: 'PriceList Unfiltered Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            comment: 'PriceList-Agnostic: Pricebook2',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM Pricebook2'
          },
          {
            comment: 'PriceList-Agnostic: Product2',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM Product2 WHERE GT_IsTechnicalProduct__c = false'
          },
          {
            comment: 'PriceList-Linked: PriceList (all price lists)',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PriceList__c'
          },
          {
            comment: 'PriceList-Agnostic: PricingVariables',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PricingVariable__c'
          },
          {
            comment: 'PriceList-Linked: PricingElements (all pricing elements)',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PricingElement__c'
          },
          {
            comment: 'PriceList-Linked: PriceListEntry (all price list entries)',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PriceListEntry__c'
          },
          {
            comment: 'PriceList-Agnostic: Pricebook entries',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM PricebookEntry'
          },
          {
            comment: 'PriceList-Agnostic: PricingPlans',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__PricingPlan__c'
          },
          {
            comment: 'PriceList-Agnostic: Promotions',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Promotion__c'
          },
          {
            comment: 'PriceList-Agnostic: Rules',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Rule__c'
          },
          {
            comment: 'PriceList-Agnostic: CatalogProductRelationship',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__CatalogProductRelationship__c'
          },
          {
            comment: 'PriceList-Agnostic: ObjectClass',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__ObjectClass__c'
          },
          {
            comment: 'PriceList-Agnostic: Attribute',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Attribute__c'
          },
          {
            comment: 'PriceList-Agnostic: AttributeCategories',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__AttributeCategory__c'
          },
          {
            comment: 'PriceList-Agnostic: AttributeAssignment',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__AttributeAssignment__c'
          },
          {
            comment: 'PriceList-Agnostic: UIFacet',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__UIFacet__c'
          },
          {
            comment: 'PriceList-Agnostic: UISection',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__UISection__c'
          },
          {
            comment: 'PriceList-Agnostic: ObjectLayout',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__ObjectLayout__c'
          },
          {
            comment: 'PriceList-Agnostic: Picklist',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__Picklist__c'
          },
          {
            comment: 'PriceList-Agnostic: CalculationMatrix',
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id FROM vlocity_cmt__CalculationMatrix__c'
          }
        ]
      }
    },
    {
      name: 'GT Custom Objects Export',
      description: 'Export all GT custom objects (Products, SKUs, Rates) using Salesforce CLI',
      config: {
        name: 'GT Custom Objects Export',
        cliType: 'sf', // Use SF CLI for custom objects
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            name: "Extract RateCodes",
            object: "GT_RateCode__c",
            soql_query: "SELECT Id, GT_GlobalKey__c, GT_OrgCode__c, GT_VATCode__c, GT_VATRate__c, GT_VATDescription__c, GT_StartDate__c, GT_EndDate__c, CurrencyIsoCode FROM GT_RateCode__c",
            external_key: "GT_GlobalKey__c",
            target_object: "GT_RateCode__c"
          },
          {
            name: "Extract RateTable",
            object: "GT_RateTable__c",
            soql_query: "SELECT Id, GT_GlobalKey__c, CurrencyIsoCode, GT_EndDate__c, GT_OrgCode__c, GT_ProductName_Text__c, GT_RateCode__c, GT_RateCode__r.GT_GlobalKey__c, Product__c, Product__r.vlocity_cmt__GlobalKey__c, GT_StartDate__c, GT_UniqueKey__c, GT_VATType__c FROM GT_RateTable__c",
            external_key: "GT_GlobalKey__c",
            target_object: "GT_RateTable__c"
          },
          {
            name: "Extract ProductSKUs",
            object: "GT_ProductSKU__c",
            soql_query: "SELECT Id, GT_GlobalKey__c, CurrencyIsoCode, GT_ProductSKU__c, GT_Color__c, GT_OrganizationCode__c, GT_ProductName_Text__c, GT_LifeCycle__c, GT_ProductUse__c, Product__c, Product__r.vlocity_cmt__GlobalKey__c FROM GT_ProductSKU__c",
            external_key: "GT_GlobalKey__c",
            target_object: "GT_ProductSKU__c"
          },
          {
            name: "Extract CatalogProductRelationships",
            object: "vlocity_cmt__CatalogProductRelationship__c",
            soql_query: "SELECT Id, vlocity_cmt__CatalogId__c, vlocity_cmt__Product2Id__c, vlocity_cmt__Product2Id__r.vlocity_cmt__GlobalKey__c, vlocity_cmt__CatalogId__r.vlocity_cmt__GlobalKey__c FROM vlocity_cmt__CatalogProductRelationship__c"
          }
        ]
      }
    },
    {
      name: 'Attributes & Categories Export',
      description: 'Export all attribute categories and assignments',
      config: {
        name: 'Attributes & Categories Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            VlocityDataPackType: 'AttributeCategory',
            query: 'SELECT Id, Name, vlocity_cmt__Code__c FROM vlocity_cmt__AttributeCategory__c'
          },
          {
            VlocityDataPackType: 'AttributeAssignmentRule',
            query: 'SELECT Id, Name FROM vlocity_cmt__AttributeAssignmentRule__c'
          }
        ]
      }
    },
    {
      name: 'Calculation Matrix & Procedures Export',
      description: 'Export all calculation matrices and procedures',
      config: {
        name: 'Calculation Matrix & Procedures Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            VlocityDataPackType: 'CalculationMatrix',
            query: 'SELECT Id, Name FROM vlocity_cmt__CalculationMatrix__c'
          },
          {
            VlocityDataPackType: 'CalculationProcedure',
            query: 'SELECT Id, Name FROM vlocity_cmt__CalculationProcedure__c'
          }
        ]
      }
    },
    {
      name: 'OmniScript Export',
      description: 'Export all OmniScripts and Integration Procedures',
      config: {
        name: 'OmniScript Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            VlocityDataPackType: 'OmniScript',
            query: 'SELECT Id, vlocity_cmt__Type__c, vlocity_cmt__SubType__c, vlocity_cmt__Language__c FROM vlocity_cmt__OmniScript__c WHERE vlocity_cmt__IsActive__c = true AND vlocity_cmt__IsProcedure__c = false'
          },
          {
            VlocityDataPackType: 'IntegrationProcedure',
            query: 'SELECT Id, vlocity_cmt__Type__c, vlocity_cmt__SubType__c, vlocity_cmt__Language__c FROM vlocity_cmt__OmniScript__c WHERE vlocity_cmt__IsActive__c = true AND vlocity_cmt__IsProcedure__c = true'
          }
        ]
      }
    },
    {
      name: 'DataRaptor Export',
      description: 'Export all DataRaptor transformations',
      config: {
        name: 'DataRaptor Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            VlocityDataPackType: 'DataRaptor',
            query: 'SELECT Id, Name FROM vlocity_cmt__DRBundle__c WHERE vlocity_cmt__Type__c != \'Migration\''
          }
        ]
      }
    },
    {
      name: 'FlexCard & Templates Export',
      description: 'Export all FlexCards and UI Templates',
      config: {
        name: 'FlexCard & Templates Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            VlocityDataPackType: 'VlocityCard',
            query: 'SELECT Id, Name FROM vlocity_cmt__VlocityCard__c WHERE vlocity_cmt__Active__c = true'
          },
          {
            VlocityDataPackType: 'VlocityUITemplate',
            query: 'SELECT Id, Name FROM vlocity_cmt__VlocityUITemplate__c WHERE vlocity_cmt__Active__c = true'
          },
          {
            VlocityDataPackType: 'VlocityUILayout',
            query: 'SELECT Id, Name FROM vlocity_cmt__VlocityUILayout__c'
          }
        ]
      }
    },
    {
      name: 'Document Templates & Clauses Export',
      description: 'Export all document templates and clauses',
      config: {
        name: 'Document Templates & Clauses Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            VlocityDataPackType: 'DocumentTemplate',
            query: 'SELECT Id, Name FROM vlocity_cmt__DocumentTemplate__c'
          },
          {
            VlocityDataPackType: 'DocumentClause',
            query: 'SELECT Id, Name FROM vlocity_cmt__DocumentClause__c'
          }
        ]
      }
    },
    {
      name: 'Orchestration Export',
      description: 'Export all orchestration plans, items, and dependencies',
      config: {
        name: 'Orchestration Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            VlocityDataPackType: 'OrchestrationPlanDefinition',
            query: 'SELECT Id, Name FROM vlocity_cmt__OrchestrationPlanDefinition__c'
          },
          {
            VlocityDataPackType: 'OrchestrationItemDefinition',
            query: 'SELECT Id, Name FROM vlocity_cmt__OrchestrationItemDefinition__c'
          },
          {
            VlocityDataPackType: 'OrchestrationDependencyDefinition',
            query: 'SELECT Id, Name, vlocity_cmt__GlobalKey__c FROM vlocity_cmt__OrchestrationDependencyDefinition__c'
          }
        ]
      }
    },
    {
      name: 'Rules & Object Configuration Export',
      description: 'Export all rules, object classes, and context rules',
      config: {
        name: 'Rules & Object Configuration Export',
        cliType: 'vlocity',
        projectPath: './export',
        defaultMaxParallel: 10,
        exportPacksMaxSize: 5000,
        removeInvalidMatchingKeyFields: true,
        maxDepth: 10,
        queries: [
          {
            VlocityDataPackType: 'Rule',
            query: 'SELECT Id, Name, vlocity_cmt__GlobalKey__c FROM vlocity_cmt__Rule__c'
          },
          {
            VlocityDataPackType: 'ObjectClass',
            query: 'SELECT Id, Name, vlocity_cmt__GlobalKey__c FROM vlocity_cmt__ObjectClass__c'
          },
          {
            VlocityDataPackType: 'ObjectLayout',
            query: 'SELECT Id, Name, vlocity_cmt__GlobalKey__c FROM vlocity_cmt__ObjectLayout__c'
          },
          {
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id, Name, vlocity_cmt__GlobalKey__c FROM vlocity_cmt__ObjectSection__c'
          },
          {
            VlocityDataPackType: 'SObject',
            query: 'SELECT Id, Name, vlocity_cmt__GlobalKey__c FROM vlocity_cmt__ObjectFacet__c'
          },
          {
            VlocityDataPackType: 'ObjectContextRule',
            query: 'SELECT Id, Name FROM vlocity_cmt__ObjectRuleAssignment__c'
          }
        ]
      }
    }
  ];
}

module.exports = { getExportTemplates };
