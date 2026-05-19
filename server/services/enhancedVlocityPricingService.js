const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');
const salesforceService = require('./salesforceService');

/**
 * Enhanced Vlocity Pricing Service
 * Handles Vlocity-specific pricing objects and Amplifon custom pricing logic
 */
class EnhancedVlocityPricingService {
  constructor() {
    this.priceListCache = new Map();
    this.pricingDir = process.env.PRICING_DIR || './pricing';
    this.ensurePricingDir();
  }

  /**
   * Ensure pricing directory exists
   */
  ensurePricingDir() {
    fs.ensureDirSync(this.pricingDir);
  }

  /**
   * Get Vlocity Price List from Salesforce
   */
  async getVlocityPriceListFromSalesforce(priceListId, username, isSandbox = false) {
    try {
      // Authenticate with SFDX
      await salesforceService.authenticateWithSfdx(username);
      
      const soql = `
        SELECT Id, Name, vlocity_cmt__Code__c, vlocity_cmt__Description__c, 
               vlocity_cmt__CurrencyCode__c, vlocity_cmt__IsActive__c,
               vlocity_cmt__EffectiveFromDate__c, vlocity_cmt__EffectiveUntilDate__c,
               vlocity_cmt__GlobalKey__c, vlocity_cmt__Sequence__c,
               GT_PriceListType__c, GT_OrganizationCode__c, GT_CountryCode__c,
               GT_IsPrimary__c, vlocity_cmt__ParentPriceListId__c,
               vlocity_cmt__Pricebook2Id__c, vlocity_cmt__LoyaltyCode__c,
               (SELECT Id, Name, vlocity_cmt__ProductId__c, vlocity_cmt__Product2Id__c,
                       vlocity_cmt__UnitPrice__c, vlocity_cmt__ListPrice__c,
                       vlocity_cmt__EffectiveFromDate__c, vlocity_cmt__EffectiveUntilDate__c,
                       vlocity_cmt__IsActive__c, vlocity_cmt__GlobalKey__c,
                       vlocity_cmt__Sequence__c, vlocity_cmt__CurrencyCode__c,
                       Product2.Name, Product2.ProductCode, Product2.Description
                FROM vlocity_cmt__PriceListEntries__r 
                WHERE vlocity_cmt__IsActive__c = true)
        FROM vlocity_cmt__PriceList__c 
        WHERE Id = '${priceListId}' AND vlocity_cmt__IsActive__c = true
      `;
      
      const result = await salesforceService.query(soql);
      
      if (result.records && result.records.length > 0) {
        const priceList = result.records[0];
        
        logger.log('info', 'Vlocity Price list retrieved from Salesforce', {
          priceListId,
          priceListName: priceList.Name,
          priceListCode: priceList.vlocity_cmt__Code__c,
          entryCount: priceList.vlocity_cmt__PriceListEntries__r?.records?.length || 0,
          username,
          service: 'enhancedVlocityPricingService'
        });
        
        return this.formatVlocityPriceList(priceList);
      }
      
      throw new Error(`Vlocity Price list not found: ${priceListId}`);
    } catch (error) {
      logger.logError(error, {
        operation: 'getVlocityPriceListFromSalesforce',
        priceListId,
        username,
        service: 'enhancedVlocityPricingService'
      });
      throw error;
    }
  }

  /**
   * Format Vlocity Price List data
   */
  formatVlocityPriceList(priceListData) {
    return {
      id: priceListData.Id,
      name: priceListData.Name,
      code: priceListData.vlocity_cmt__Code__c,
      description: priceListData.vlocity_cmt__Description__c,
      currencyCode: priceListData.vlocity_cmt__CurrencyCode__c,
      isActive: priceListData.vlocity_cmt__IsActive__c,
      effectiveFromDate: priceListData.vlocity_cmt__EffectiveFromDate__c,
      effectiveUntilDate: priceListData.vlocity_cmt__EffectiveUntilDate__c,
      globalKey: priceListData.vlocity_cmt__GlobalKey__c,
      sequence: priceListData.vlocity_cmt__Sequence__c,
      priceListType: priceListData.GT_PriceListType__c,
      organizationCode: priceListData.GT_OrganizationCode__c,
      countryCode: priceListData.GT_CountryCode__c,
      isPrimary: priceListData.GT_IsPrimary__c,
      parentPriceListId: priceListData.vlocity_cmt__ParentPriceListId__c,
      pricebook2Id: priceListData.vlocity_cmt__Pricebook2Id__c,
      loyaltyCode: priceListData.vlocity_cmt__LoyaltyCode__c,
      entries: priceListData.vlocity_cmt__PriceListEntries__r?.records?.map(entry => ({
        id: entry.Id,
        name: entry.Name,
        productId: entry.vlocity_cmt__ProductId__c || entry.vlocity_cmt__Product2Id__c,
        unitPrice: entry.vlocity_cmt__UnitPrice__c,
        listPrice: entry.vlocity_cmt__ListPrice__c,
        effectiveFromDate: entry.vlocity_cmt__EffectiveFromDate__c,
        effectiveUntilDate: entry.vlocity_cmt__EffectiveUntilDate__c,
        isActive: entry.vlocity_cmt__IsActive__c,
        globalKey: entry.vlocity_cmt__GlobalKey__c,
        sequence: entry.vlocity_cmt__Sequence__c,
        currencyCode: entry.vlocity_cmt__CurrencyCode__c,
        productName: entry.Product2?.Name,
        productCode: entry.Product2?.ProductCode,
        productDescription: entry.Product2?.Description
      })) || []
    };
  }

  /**
   * Get all Vlocity Price Lists from Salesforce
   */
  async getAllVlocityPriceListsFromSalesforce(username, isSandbox = false, filters = {}) {
    try {
      // Authenticate with SFDX
      await salesforceService.authenticateWithSfdx(username);
      
      let soql = `
        SELECT Id, Name, vlocity_cmt__Code__c, vlocity_cmt__Description__c, 
               vlocity_cmt__CurrencyCode__c, vlocity_cmt__IsActive__c,
               vlocity_cmt__EffectiveFromDate__c, vlocity_cmt__EffectiveUntilDate__c,
               GT_PriceListType__c, GT_OrganizationCode__c, GT_CountryCode__c,
               GT_IsPrimary__c, vlocity_cmt__GlobalKey__c
        FROM vlocity_cmt__PriceList__c 
        WHERE vlocity_cmt__IsActive__c = true
      `;
      
      // Add filters
      const conditions = [];
      if (filters.country) {
        conditions.push(`GT_CountryCode__c = '${filters.country}'`);
      }
      if (filters.organizationCode) {
        conditions.push(`GT_OrganizationCode__c = '${filters.organizationCode}'`);
      }
      if (filters.currency) {
        conditions.push(`vlocity_cmt__CurrencyCode__c = '${filters.currency}'`);
      }
      if (filters.priceListType) {
        conditions.push(`GT_PriceListType__c = '${filters.priceListType}'`);
      }
      if (filters.isPrimary !== undefined) {
        conditions.push(`GT_IsPrimary__c = ${filters.isPrimary}`);
      }
      if (filters.code) {
        conditions.push(`vlocity_cmt__Code__c LIKE '%${filters.code}%'`);
      }
      
      if (conditions.length > 0) {
        soql += ` AND ${conditions.join(' AND ')}`;
      }
      
      soql += ' ORDER BY vlocity_cmt__Sequence__c, Name';
      
      const result = await salesforceService.query(soql);
      
      const priceLists = result.records?.map(priceList => ({
        id: priceList.Id,
        name: priceList.Name,
        code: priceList.vlocity_cmt__Code__c,
        description: priceList.vlocity_cmt__Description__c,
        currencyCode: priceList.vlocity_cmt__CurrencyCode__c,
        isActive: priceList.vlocity_cmt__IsActive__c,
        effectiveFromDate: priceList.vlocity_cmt__EffectiveFromDate__c,
        effectiveUntilDate: priceList.vlocity_cmt__EffectiveUntilDate__c,
        priceListType: priceList.GT_PriceListType__c,
        organizationCode: priceList.GT_OrganizationCode__c,
        countryCode: priceList.GT_CountryCode__c,
        isPrimary: priceList.GT_IsPrimary__c,
        globalKey: priceList.vlocity_cmt__GlobalKey__c
      })) || [];
      
      logger.log('info', 'All Vlocity price lists retrieved from Salesforce', {
        count: priceLists.length,
        filters,
        username,
        service: 'enhancedVlocityPricingService'
      });
      
      return priceLists;
    } catch (error) {
      logger.logError(error, {
        operation: 'getAllVlocityPriceListsFromSalesforce',
        filters,
        username,
        service: 'enhancedVlocityPricingService'
      });
      throw error;
    }
  }

  /**
   * Get Rate Codes from Salesforce
   */
  async getRateCodesFromSalesforce(username, isSandbox = false, filters = {}) {
    try {
      // Authenticate with SFDX
      await salesforceService.authenticateWithSfdx(username);
      
      let soql = `
        SELECT Id, Name, GT_OrgCode__c, GT_VATCode__c, GT_VATDescription__c,
               GT_VATRate__c, GT_StartDate__c, GT_EndDate__c, GT_GlobalKey__c
        FROM GT_RateCode__c
        WHERE GT_StartDate__c <= TODAY AND (GT_EndDate__c = null OR GT_EndDate__c >= TODAY)
      `;
      
      // Add filters
      const conditions = [];
      if (filters.orgCode) {
        conditions.push(`GT_OrgCode__c = '${filters.orgCode}'`);
      }
      if (filters.vatCode) {
        conditions.push(`GT_VATCode__c = ${filters.vatCode}`);
      }
      if (filters.startDate) {
        conditions.push(`GT_StartDate__c >= ${filters.startDate}`);
      }
      if (filters.endDate) {
        conditions.push(`GT_EndDate__c <= ${filters.endDate}`);
      }
      
      if (conditions.length > 0) {
        soql += ` AND ${conditions.join(' AND ')}`;
      }
      
      soql += ' ORDER BY GT_OrgCode__c, GT_VATCode__c';
      
      const result = await salesforceService.query(soql);
      
      const rateCodes = result.records?.map(rateCode => ({
        id: rateCode.Id,
        name: rateCode.Name,
        orgCode: rateCode.GT_OrgCode__c,
        vatCode: rateCode.GT_VATCode__c,
        vatDescription: rateCode.GT_VATDescription__c,
        vatRate: rateCode.GT_VATRate__c,
        startDate: rateCode.GT_StartDate__c,
        endDate: rateCode.GT_EndDate__c,
        globalKey: rateCode.GT_GlobalKey__c
      })) || [];
      
      logger.log('info', 'Rate codes retrieved from Salesforce', {
        count: rateCodes.length,
        filters,
        username,
        service: 'enhancedVlocityPricingService'
      });
      
      return rateCodes;
    } catch (error) {
      logger.logError(error, {
        operation: 'getRateCodesFromSalesforce',
        filters,
        username,
        service: 'enhancedVlocityPricingService'
      });
      throw error;
    }
  }

  /**
   * Get Rate Tables from Salesforce
   */
  async getRateTablesFromSalesforce(username, isSandbox = false, filters = {}) {
    try {
      // Authenticate with SFDX
      await salesforceService.authenticateWithSfdx(username);
      
      let soql = `
        SELECT Id, Name, GT_OrgCode__c, Product__c, Product__r.Name,
               GT_ProductName_Text__c, GT_RateCode__c, GT_RateDescription__c,
               GT_StartDate__c, GT_EndDate__c, GT_VATType__c, GT_UniqueKey__c,
               GT_GlobalKey__c
        FROM GT_RateTable__c
        WHERE GT_StartDate__c <= TODAY AND (GT_EndDate__c = null OR GT_EndDate__c >= TODAY)
      `;
      
      // Add filters
      const conditions = [];
      if (filters.orgCode) {
        conditions.push(`GT_OrgCode__c = '${filters.orgCode}'`);
      }
      if (filters.productId) {
        conditions.push(`Product__c = '${filters.productId}'`);
      }
      if (filters.rateCode) {
        conditions.push(`GT_RateCode__c = '${filters.rateCode}'`);
      }
      if (filters.startDate) {
        conditions.push(`GT_StartDate__c >= ${filters.startDate}`);
      }
      if (filters.endDate) {
        conditions.push(`GT_EndDate__c <= ${filters.endDate}`);
      }
      
      if (conditions.length > 0) {
        soql += ` AND ${conditions.join(' AND ')}`;
      }
      
      soql += ' ORDER BY GT_OrgCode__c, Product__r.Name, GT_StartDate__c';
      
      const result = await salesforceService.query(soql);
      
      const rateTables = result.records?.map(rateTable => ({
        id: rateTable.Id,
        name: rateTable.Name,
        orgCode: rateTable.GT_OrgCode__c,
        productId: rateTable.Product__c,
        productName: rateTable.Product__r?.Name,
        productNameText: rateTable.GT_ProductName_Text__c,
        rateCode: rateTable.GT_RateCode__c,
        rateDescription: rateTable.GT_RateDescription__c,
        startDate: rateTable.GT_StartDate__c,
        endDate: rateTable.GT_EndDate__c,
        vatType: rateTable.GT_VATType__c,
        uniqueKey: rateTable.GT_UniqueKey__c,
        globalKey: rateTable.GT_GlobalKey__c
      })) || [];
      
      logger.log('info', 'Rate tables retrieved from Salesforce', {
        count: rateTables.length,
        filters,
        username,
        service: 'enhancedVlocityPricingService'
      });
      
      return rateTables;
    } catch (error) {
      logger.logError(error, {
        operation: 'getRateTablesFromSalesforce',
        filters,
        username,
        service: 'enhancedVlocityPricingService'
      });
      throw error;
    }
  }

  /**
   * Get Vlocity Promotions from Salesforce
   */
  async getVlocityPromotionsFromSalesforce(username, isSandbox = false, filters = {}) {
    try {
      // Authenticate with SFDX
      await salesforceService.authenticateWithSfdx(username);
      
      let soql = `
        SELECT Id, Name, vlocity_cmt__Code__c, vlocity_cmt__Description__c,
               vlocity_cmt__IsActive__c, vlocity_cmt__GlobalKey__c,
               vlocity_cmt__PriceListId__c, GT_Type__c, Promotion_Trigger__c
        FROM vlocity_cmt__Promotion__c
        WHERE vlocity_cmt__IsActive__c = true
      `;
      
      // Add filters
      const conditions = [];
      if (filters.promotionType) {
        conditions.push(`GT_Type__c = '${filters.promotionType}'`);
      }
      if (filters.priceListId) {
        conditions.push(`vlocity_cmt__PriceListId__c = '${filters.priceListId}'`);
      }
      if (filters.trigger) {
        conditions.push(`Promotion_Trigger__c = '${filters.trigger}'`);
      }
      if (filters.code) {
        conditions.push(`vlocity_cmt__Code__c LIKE '%${filters.code}%'`);
      }
      
      if (conditions.length > 0) {
        soql += ` AND ${conditions.join(' AND ')}`;
      }
      
      soql += ' ORDER BY Name';
      
      const result = await salesforceService.query(soql);
      
      const promotions = result.records?.map(promotion => ({
        id: promotion.Id,
        name: promotion.Name,
        code: promotion.vlocity_cmt__Code__c,
        description: promotion.vlocity_cmt__Description__c,
        isActive: promotion.vlocity_cmt__IsActive__c,
        globalKey: promotion.vlocity_cmt__GlobalKey__c,
        priceListId: promotion.vlocity_cmt__PriceListId__c,
        promotionType: promotion.GT_Type__c,
        trigger: promotion.Promotion_Trigger__c
      })) || [];
      
      logger.log('info', 'Vlocity promotions retrieved from Salesforce', {
        count: promotions.length,
        filters,
        username,
        service: 'enhancedVlocityPricingService'
      });
      
      return promotions;
    } catch (error) {
      logger.logError(error, {
        operation: 'getVlocityPromotionsFromSalesforce',
        filters,
        username,
        service: 'enhancedVlocityPricingService'
      });
      throw error;
    }
  }

  /**
   * Get comprehensive pricing data for a product
   */
  async getProductPricingData(productId, username, isSandbox = false, options = {}) {
    try {
      // Authenticate with SFDX
      await salesforceService.authenticateWithSfdx(username);
      
      const { orgCode, countryCode, currencyCode, includePromotions = true } = options;
      
      // Get all price lists for the product
      let priceListSoql = `
        SELECT Id, Name, vlocity_cmt__Code__c, vlocity_cmt__Description__c,
               vlocity_cmt__CurrencyCode__c, GT_PriceListType__c, 
               GT_OrganizationCode__c, GT_CountryCode__c, GT_IsPrimary__c,
               (SELECT Id, vlocity_cmt__UnitPrice__c, vlocity_cmt__ListPrice__c,
                       vlocity_cmt__EffectiveFromDate__c, vlocity_cmt__EffectiveUntilDate__c,
                       vlocity_cmt__IsActive__c
                FROM vlocity_cmt__PriceListEntries__r 
                WHERE vlocity_cmt__ProductId__c = '${productId}' 
                OR vlocity_cmt__Product2Id__c = '${productId}'
                AND vlocity_cmt__IsActive__c = true)
        FROM vlocity_cmt__PriceList__c 
        WHERE vlocity_cmt__IsActive__c = true
      `;
      
      const conditions = [];
      if (orgCode) conditions.push(`GT_OrganizationCode__c = '${orgCode}'`);
      if (countryCode) conditions.push(`GT_CountryCode__c = '${countryCode}'`);
      if (currencyCode) conditions.push(`vlocity_cmt__CurrencyCode__c = '${currencyCode}'`);
      
      if (conditions.length > 0) {
        priceListSoql += ` AND ${conditions.join(' AND ')}`;
      }
      
      const priceListResult = await salesforceService.query(priceListSoql);
      
      // Get rate tables for the product
      let rateTableSoql = `
        SELECT Id, GT_OrgCode__c, GT_RateCode__c, GT_RateDescription__c,
               GT_StartDate__c, GT_EndDate__c, GT_VATType__c
        FROM GT_RateTable__c
        WHERE Product__c = '${productId}'
      `;
      
      if (orgCode) {
        rateTableSoql += ` AND GT_OrgCode__c = '${orgCode}'`;
      }
      
      const rateTableResult = await salesforceService.query(rateTableSoql);
      
      // Get promotions if requested
      let promotions = [];
      if (includePromotions) {
        const promotionFilters = { priceListId: priceListResult.records?.[0]?.Id };
        promotions = await this.getVlocityPromotionsFromSalesforce(username, isSandbox, promotionFilters);
      }
      
      const pricingData = {
        productId,
        priceLists: priceListResult.records?.map(pl => ({
          id: pl.Id,
          name: pl.Name,
          code: pl.vlocity_cmt__Code__c,
          description: pl.vlocity_cmt__Description__c,
          currencyCode: pl.vlocity_cmt__CurrencyCode__c,
          priceListType: pl.GT_PriceListType__c,
          organizationCode: pl.GT_OrganizationCode__c,
          countryCode: pl.GT_CountryCode__c,
          isPrimary: pl.GT_IsPrimary__c,
          entries: pl.vlocity_cmt__PriceListEntries__r?.records?.map(entry => ({
            id: entry.Id,
            unitPrice: entry.vlocity_cmt__UnitPrice__c,
            listPrice: entry.vlocity_cmt__ListPrice__c,
            effectiveFromDate: entry.vlocity_cmt__EffectiveFromDate__c,
            effectiveUntilDate: entry.vlocity_cmt__EffectiveUntilDate__c,
            isActive: entry.vlocity_cmt__IsActive__c
          })) || []
        })) || [],
        rateTables: rateTableResult.records?.map(rt => ({
          id: rt.Id,
          orgCode: rt.GT_OrgCode__c,
          rateCode: rt.GT_RateCode__c,
          rateDescription: rt.GT_RateDescription__c,
          startDate: rt.GT_StartDate__c,
          endDate: rt.GT_EndDate__c,
          vatType: rt.GT_VATType__c
        })) || [],
        promotions: promotions
      };
      
      logger.log('info', 'Product pricing data retrieved', {
        productId,
        priceListCount: pricingData.priceLists.length,
        rateTableCount: pricingData.rateTables.length,
        promotionCount: pricingData.promotions.length,
        username,
        service: 'enhancedVlocityPricingService'
      });
      
      return pricingData;
    } catch (error) {
      logger.logError(error, {
        operation: 'getProductPricingData',
        productId,
        options,
        username,
        service: 'enhancedVlocityPricingService'
      });
      throw error;
    }
  }

  /**
   * Get pricing statistics
   */
  async getEnhancedPricingStats(username, isSandbox = false) {
    try {
      // Authenticate with SFDX
      await salesforceService.authenticateWithSfdx(username);
      
      const [priceLists, rateCodes, rateTables, promotions] = await Promise.all([
        this.getAllVlocityPriceListsFromSalesforce(username, isSandbox),
        this.getRateCodesFromSalesforce(username, isSandbox),
        this.getRateTablesFromSalesforce(username, isSandbox),
        this.getVlocityPromotionsFromSalesforce(username, isSandbox)
      ]);
      
      const stats = {
        totalPriceLists: priceLists.length,
        totalRateCodes: rateCodes.length,
        totalRateTables: rateTables.length,
        totalPromotions: promotions.length,
        byPriceListType: {},
        byOrganizationCode: {},
        byCountryCode: {},
        byCurrencyCode: {},
        byPromotionType: {},
        byVATType: {}
      };
      
      // Analyze price lists
      priceLists.forEach(pl => {
        const type = pl.priceListType || 'Unknown';
        stats.byPriceListType[type] = (stats.byPriceListType[type] || 0) + 1;
        
        const orgCode = pl.organizationCode || 'Unknown';
        stats.byOrganizationCode[orgCode] = (stats.byOrganizationCode[orgCode] || 0) + 1;
        
        const country = pl.countryCode || 'Unknown';
        stats.byCountryCode[country] = (stats.byCountryCode[country] || 0) + 1;
        
        const currency = pl.currencyCode || 'Unknown';
        stats.byCurrencyCode[currency] = (stats.byCurrencyCode[currency] || 0) + 1;
      });
      
      // Analyze promotions
      promotions.forEach(promo => {
        const type = promo.promotionType || 'Unknown';
        stats.byPromotionType[type] = (stats.byPromotionType[type] || 0) + 1;
      });
      
      // Analyze rate tables
      rateTables.forEach(rt => {
        const vatType = rt.vatType || 'Unknown';
        stats.byVATType[vatType] = (stats.byVATType[vatType] || 0) + 1;
      });
      
      return stats;
    } catch (error) {
      logger.logError(error, {
        operation: 'getEnhancedPricingStats',
        username,
        service: 'enhancedVlocityPricingService'
      });
      throw error;
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.priceListCache.clear();
    logger.log('info', 'Enhanced pricing cache cleared', {
      service: 'enhancedVlocityPricingService'
    });
  }

  /**
   * Get service statistics
   */
  getServiceStats() {
    return {
      cachedPriceLists: this.priceListCache.size,
      pricingDir: this.pricingDir,
      service: 'enhancedVlocityPricingService'
    };
  }
}

// Create singleton instance
const enhancedVlocityPricingService = new EnhancedVlocityPricingService();

module.exports = enhancedVlocityPricingService;

