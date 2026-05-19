const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');
const salesforceApiService = require('./salesforceApiService');

/**
 * Vlocity Promotions Service
 * Handles promotions management and promotional operations
 */
class VlocityPromotionsService {
  constructor() {
    this.promotionsCache = new Map();
    this.promotionsDir = process.env.PROMOTIONS_DIR || './promotions';
    this.ensurePromotionsDir();
  }

  /**
   * Ensure promotions directory exists (removed - not used)
   */
  ensurePromotionsDir() {
    // Directory creation removed - not used
  }

  /**
   * Get promotion from Salesforce
   */
  async getPromotionFromSalesforce(promotionId, username, isSandbox = false) {
    try {
      // Query promotion data
      const soql = `
        SELECT Id, Name, Description, StartDate, EndDate, Status, 
               DiscountPercentage, DiscountAmount, CurrencyIsoCode,
               Country__c, Region__c, ProductFamily__c, Category__c,
               MinQuantity__c, MaxQuantity__c, IsActive__c
        FROM Promotion__c 
        WHERE Id = '${promotionId}' AND IsActive__c = true
      `;
      
      const result = await salesforceApiService.query(soql, username, isSandbox);
      
      if (result.records && result.records.length > 0) {
        const promotion = result.records[0];
        
        logger.log('info', 'Promotion retrieved from Salesforce', {
          promotionId,
          promotionName: promotion.Name,
          status: promotion.Status,
          username,
          service: 'vlocityPromotionsService'
        });
        
        return this.formatPromotion(promotion);
      }
      
      throw new Error(`Promotion not found: ${promotionId}`);
    } catch (error) {
      logger.logError(error, {
        operation: 'getPromotionFromSalesforce',
        promotionId,
        username,
        service: 'vlocityPromotionsService'
      });
      throw error;
    }
  }

  /**
   * Format promotion data
   */
  formatPromotion(promotionData) {
    return {
      id: promotionData.Id,
      name: promotionData.Name,
      description: promotionData.Description,
      startDate: promotionData.StartDate,
      endDate: promotionData.EndDate,
      status: promotionData.Status,
      discountPercentage: promotionData.DiscountPercentage,
      discountAmount: promotionData.DiscountAmount,
      currency: promotionData.CurrencyIsoCode,
      country: promotionData.Country__c,
      region: promotionData.Region__c,
      productFamily: promotionData.ProductFamily__c,
      category: promotionData.Category__c,
      minQuantity: promotionData.MinQuantity__c,
      maxQuantity: promotionData.MaxQuantity__c,
      isActive: promotionData.IsActive__c
    };
  }

  /**
   * Get all promotions from Salesforce
   */
  async getAllPromotionsFromSalesforce(username, isSandbox = false, filters = {}) {
    try {
      let soql = `
        SELECT Id, Name, Description, StartDate, EndDate, Status, 
               DiscountPercentage, DiscountAmount, CurrencyIsoCode,
               Country__c, Region__c, ProductFamily__c, Category__c,
               MinQuantity__c, MaxQuantity__c, IsActive__c
        FROM Promotion__c 
        WHERE IsActive__c = true
      `;
      
      // Add filters
      const conditions = [];
      if (filters.country) {
        conditions.push(`Country__c = '${filters.country}'`);
      }
      if (filters.region) {
        conditions.push(`Region__c = '${filters.region}'`);
      }
      if (filters.currency) {
        conditions.push(`CurrencyIsoCode = '${filters.currency}'`);
      }
      if (filters.status) {
        conditions.push(`Status = '${filters.status}'`);
      }
      if (filters.productFamily) {
        conditions.push(`ProductFamily__c = '${filters.productFamily}'`);
      }
      if (filters.category) {
        conditions.push(`Category__c = '${filters.category}'`);
      }
      
      if (conditions.length > 0) {
        soql += ` AND ${conditions.join(' AND ')}`;
      }
      
      soql += ' ORDER BY StartDate DESC';
      
      const result = await salesforceApiService.query(soql, username, isSandbox);
      
      const promotions = result.records?.map(promotion => ({
        id: promotion.Id,
        name: promotion.Name,
        description: promotion.Description,
        startDate: promotion.StartDate,
        endDate: promotion.EndDate,
        status: promotion.Status,
        discountPercentage: promotion.DiscountPercentage,
        discountAmount: promotion.DiscountAmount,
        currency: promotion.CurrencyIsoCode,
        country: promotion.Country__c,
        region: promotion.Region__c,
        productFamily: promotion.ProductFamily__c,
        category: promotion.Category__c,
        minQuantity: promotion.MinQuantity__c,
        maxQuantity: promotion.MaxQuantity__c,
        isActive: promotion.IsActive__c
      })) || [];
      
      logger.log('info', 'All promotions retrieved from Salesforce', {
        count: promotions.length,
        filters,
        username,
        service: 'vlocityPromotionsService'
      });
      
      return promotions;
    } catch (error) {
      logger.logError(error, {
        operation: 'getAllPromotionsFromSalesforce',
        filters,
        username,
        service: 'vlocityPromotionsService'
      });
      throw error;
    }
  }

  /**
   * Create promotion in Salesforce
   */
  async createPromotionInSalesforce(promotionData, username, isSandbox = false) {
    try {
      const recordData = {
        Name: promotionData.name,
        Description: promotionData.description,
        StartDate: promotionData.startDate,
        EndDate: promotionData.endDate,
        Status: promotionData.status || 'Draft',
        DiscountPercentage: promotionData.discountPercentage,
        DiscountAmount: promotionData.discountAmount,
        CurrencyIsoCode: promotionData.currency,
        Country__c: promotionData.country,
        Region__c: promotionData.region,
        ProductFamily__c: promotionData.productFamily,
        Category__c: promotionData.category,
        MinQuantity__c: promotionData.minQuantity,
        MaxQuantity__c: promotionData.maxQuantity,
        IsActive__c: promotionData.isActive !== false
      };
      
      const result = await salesforceApiService.createRecord('Promotion__c', recordData, username, isSandbox);
      
      logger.log('info', 'Promotion created in Salesforce', {
        promotionId: result.id,
        promotionName: promotionData.name,
        username,
        service: 'vlocityPromotionsService'
      });
      
      return result;
    } catch (error) {
      logger.logError(error, {
        operation: 'createPromotionInSalesforce',
        promotionData,
        username,
        service: 'vlocityPromotionsService'
      });
      throw error;
    }
  }

  /**
   * Update promotion in Salesforce
   */
  async updatePromotionInSalesforce(promotionId, promotionData, username, isSandbox = false) {
    try {
      const recordData = {};
      
      if (promotionData.name) recordData.Name = promotionData.name;
      if (promotionData.description) recordData.Description = promotionData.description;
      if (promotionData.startDate) recordData.StartDate = promotionData.startDate;
      if (promotionData.endDate) recordData.EndDate = promotionData.endDate;
      if (promotionData.status) recordData.Status = promotionData.status;
      if (promotionData.discountPercentage !== undefined) recordData.DiscountPercentage = promotionData.discountPercentage;
      if (promotionData.discountAmount !== undefined) recordData.DiscountAmount = promotionData.discountAmount;
      if (promotionData.currency) recordData.CurrencyIsoCode = promotionData.currency;
      if (promotionData.country) recordData.Country__c = promotionData.country;
      if (promotionData.region) recordData.Region__c = promotionData.region;
      if (promotionData.productFamily) recordData.ProductFamily__c = promotionData.productFamily;
      if (promotionData.category) recordData.Category__c = promotionData.category;
      if (promotionData.minQuantity !== undefined) recordData.MinQuantity__c = promotionData.minQuantity;
      if (promotionData.maxQuantity !== undefined) recordData.MaxQuantity__c = promotionData.maxQuantity;
      if (promotionData.isActive !== undefined) recordData.IsActive__c = promotionData.isActive;
      
      const result = await salesforceApiService.updateRecord('Promotion__c', promotionId, recordData, username, isSandbox);
      
      logger.log('info', 'Promotion updated in Salesforce', {
        promotionId,
        username,
        service: 'vlocityPromotionsService'
      });
      
      return result;
    } catch (error) {
      logger.logError(error, {
        operation: 'updatePromotionInSalesforce',
        promotionId,
        promotionData,
        username,
        service: 'vlocityPromotionsService'
      });
      throw error;
    }
  }

  /**
   * Get active promotions for a product
   */
  async getActivePromotionsForProduct(productId, username, isSandbox = false) {
    try {
      const soql = `
        SELECT Id, Name, Description, StartDate, EndDate, Status, 
               DiscountPercentage, DiscountAmount, CurrencyIsoCode,
               Country__c, Region__c, ProductFamily__c, Category__c,
               MinQuantity__c, MaxQuantity__c, IsActive__c
        FROM Promotion__c 
        WHERE IsActive__c = true 
        AND Status = 'Active'
        AND StartDate <= TODAY 
        AND EndDate >= TODAY
        AND (ProductFamily__c = null OR ProductFamily__c IN (
          SELECT Product2.Family FROM Product2 WHERE Id = '${productId}' AND GT_IsTechnicalProduct__c = false
        ))
        ORDER BY DiscountPercentage DESC, DiscountAmount DESC
      `;
      
      const result = await salesforceApiService.query(soql, username, isSandbox);
      
      const promotions = result.records?.map(promotion => this.formatPromotion(promotion)) || [];
      
      logger.log('info', 'Active promotions retrieved for product', {
        productId,
        promotionCount: promotions.length,
        username,
        service: 'vlocityPromotionsService'
      });
      
      return promotions;
    } catch (error) {
      logger.logError(error, {
        operation: 'getActivePromotionsForProduct',
        productId,
        username,
        service: 'vlocityPromotionsService'
      });
      throw error;
    }
  }

  /**
   * Calculate promotion discount
   */
  calculatePromotionDiscount(promotion, productPrice, quantity = 1) {
    if (!promotion.isActive || promotion.status !== 'Active') {
      return { discount: 0, finalPrice: productPrice };
    }
    
    const now = new Date();
    const startDate = new Date(promotion.startDate);
    const endDate = new Date(promotion.endDate);
    
    // Check if promotion is currently active
    if (now < startDate || now > endDate) {
      return { discount: 0, finalPrice: productPrice };
    }
    
    // Check quantity constraints
    if (promotion.minQuantity && quantity < promotion.minQuantity) {
      return { discount: 0, finalPrice: productPrice };
    }
    
    if (promotion.maxQuantity && quantity > promotion.maxQuantity) {
      return { discount: 0, finalPrice: productPrice };
    }
    
    let discount = 0;
    
    // Calculate discount based on type
    if (promotion.discountPercentage) {
      discount = (productPrice * promotion.discountPercentage) / 100;
    } else if (promotion.discountAmount) {
      discount = promotion.discountAmount;
    }
    
    const finalPrice = Math.max(0, productPrice - discount);
    
    return {
      discount,
      finalPrice,
      discountPercentage: promotion.discountPercentage,
      discountAmount: promotion.discountAmount,
      promotionId: promotion.id,
      promotionName: promotion.name
    };
  }

  /**
   * Get promotion statistics
   */
  async getPromotionStats(username, isSandbox = false) {
    try {
      const promotions = await this.getAllPromotionsFromSalesforce(username, isSandbox);
      
      const stats = {
        totalPromotions: promotions.length,
        byCountry: {},
        byRegion: {},
        byStatus: {},
        byCategory: {},
        byProductFamily: {},
        activePromotions: 0,
        expiredPromotions: 0,
        upcomingPromotions: 0
      };
      
      const now = new Date();
      
      for (const promotion of promotions) {
        // Count by country
        const country = promotion.country || 'Unknown';
        stats.byCountry[country] = (stats.byCountry[country] || 0) + 1;
        
        // Count by region
        const region = promotion.region || 'Unknown';
        stats.byRegion[region] = (stats.byRegion[region] || 0) + 1;
        
        // Count by status
        const status = promotion.status || 'Unknown';
        stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;
        
        // Count by category
        const category = promotion.category || 'Unknown';
        stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
        
        // Count by product family
        const productFamily = promotion.productFamily || 'Unknown';
        stats.byProductFamily[productFamily] = (stats.byProductFamily[productFamily] || 0) + 1;
        
        // Count by date status
        if (promotion.startDate && promotion.endDate) {
          const startDate = new Date(promotion.startDate);
          const endDate = new Date(promotion.endDate);
          
          if (now >= startDate && now <= endDate) {
            stats.activePromotions++;
          } else if (now > endDate) {
            stats.expiredPromotions++;
          } else if (now < startDate) {
            stats.upcomingPromotions++;
          }
        }
      }
      
      return stats;
    } catch (error) {
      logger.logError(error, {
        operation: 'getPromotionStats',
        username,
        service: 'vlocityPromotionsService'
      });
      throw error;
    }
  }

  /**
   * Export promotions to file
   */
  async exportPromotions(username, isSandbox = false, filters = {}, exportFormat = 'json') {
    try {
      const promotions = await this.getAllPromotionsFromSalesforce(username, isSandbox, filters);
      
      const exportData = {
        exportDate: new Date().toISOString(),
        filters,
        promotions,
        metadata: {
          totalPromotions: promotions.length,
          exportFormat
        }
      };
      
      const fileName = `promotions-export-${Date.now()}.${exportFormat}`;
      const filePath = path.join(this.promotionsDir, fileName);
      
      if (exportFormat === 'json') {
        await fs.writeJson(filePath, exportData, { spaces: 2 });
      } else if (exportFormat === 'csv') {
        const csvContent = this.convertToCSV(exportData);
        await fs.writeFile(filePath, csvContent, 'utf8');
      }
      
      logger.log('info', 'Promotions exported', {
        fileName,
        promotionCount: promotions.length,
        exportFormat,
        username,
        service: 'vlocityPromotionsService'
      });
      
      return filePath;
    } catch (error) {
      logger.logError(error, {
        operation: 'exportPromotions',
        filters,
        exportFormat,
        username,
        service: 'vlocityPromotionsService'
      });
      throw error;
    }
  }

  /**
   * Convert promotions data to CSV
   */
  convertToCSV(exportData) {
    const headers = ['Name', 'Description', 'Start Date', 'End Date', 'Status', 'Discount %', 'Discount Amount', 'Currency', 'Country', 'Region', 'Category', 'Product Family'];
    const rows = [headers.join(',')];
    
    for (const promotion of exportData.promotions) {
      const row = [
        `"${promotion.name || ''}"`,
        `"${promotion.description || ''}"`,
        `"${promotion.startDate || ''}"`,
        `"${promotion.endDate || ''}"`,
        `"${promotion.status || ''}"`,
        promotion.discountPercentage || '',
        promotion.discountAmount || '',
        `"${promotion.currency || ''}"`,
        `"${promotion.country || ''}"`,
        `"${promotion.region || ''}"`,
        `"${promotion.category || ''}"`,
        `"${promotion.productFamily || ''}"`
      ];
      rows.push(row.join(','));
    }
    
    return rows.join('\n');
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.promotionsCache.clear();
    logger.log('info', 'Promotions cache cleared', {
      service: 'vlocityPromotionsService'
    });
  }

  /**
   * Get service statistics
   */
  getServiceStats() {
    return {
      cachedPromotions: this.promotionsCache.size,
      promotionsDir: this.promotionsDir,
      service: 'vlocityPromotionsService'
    };
  }
}

// Create singleton instance
const vlocityPromotionsService = new VlocityPromotionsService();

module.exports = vlocityPromotionsService;
