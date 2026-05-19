const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');
const salesforceApiService = require('./salesforceApiService');

/**
 * Vlocity Pricing Service
 * Handles price list management and pricing operations
 */
class VlocityPricingService {
  constructor() {
    this.priceListCache = new Map();
    this.pricingDir = process.env.PRICING_DIR || './pricing';
    this.ensurePricingDir();
  }

  /**
   * Ensure pricing directory exists (removed - not used)
   */
  ensurePricingDir() {
    // Directory creation removed - not used
  }

  /**
   * Get price list from Salesforce
   */
  async getPriceListFromSalesforce(priceListId, username, isSandbox = false) {
    try {
      // Query price list data
      const soql = `
        SELECT Id, Name, Description, EffectiveDate, ExpirationDate, 
               Status, CurrencyIsoCode, Country__c, Region__c,
               (SELECT Id, Product2Id, Product2.Name, UnitPrice, ListPrice, 
                       EffectiveDate, ExpirationDate, CurrencyIsoCode
                FROM PricebookEntries 
                WHERE IsActive = true)
        FROM Pricebook2 
        WHERE Id = '${priceListId}' AND IsActive = true
      `;
      
      const result = await salesforceApiService.query(soql, username, isSandbox);
      
      if (result.records && result.records.length > 0) {
        const priceList = result.records[0];
        
        logger.log('info', 'Price list retrieved from Salesforce', {
          priceListId,
          priceListName: priceList.Name,
          entryCount: priceList.PricebookEntries?.records?.length || 0,
          username,
          service: 'vlocityPricingService'
        });
        
        return this.formatPriceList(priceList);
      }
      
      throw new Error(`Price list not found: ${priceListId}`);
    } catch (error) {
      logger.logError(error, {
        operation: 'getPriceListFromSalesforce',
        priceListId,
        username,
        service: 'vlocityPricingService'
      });
      throw error;
    }
  }

  /**
   * Format price list data
   */
  formatPriceList(priceListData) {
    return {
      id: priceListData.Id,
      name: priceListData.Name,
      description: priceListData.Description,
      effectiveDate: priceListData.EffectiveDate,
      expirationDate: priceListData.ExpirationDate,
      status: priceListData.Status,
      currency: priceListData.CurrencyIsoCode,
      country: priceListData.Country__c,
      region: priceListData.Region__c,
      entries: priceListData.PricebookEntries?.records?.map(entry => ({
        id: entry.Id,
        productId: entry.Product2Id,
        productName: entry.Product2?.Name,
        unitPrice: entry.UnitPrice,
        listPrice: entry.ListPrice,
        effectiveDate: entry.EffectiveDate,
        expirationDate: entry.ExpirationDate,
        currency: entry.CurrencyIsoCode
      })) || []
    };
  }

  /**
   * Get all price lists from Salesforce with pagination
   */
  async getAllPriceListsFromSalesforce(username, isSandbox = false, filters = {}, pagination = {}) {
    try {
      const { page = 1, limit = 25 } = pagination;
      const offset = (page - 1) * limit;
      
      let soql = `
        SELECT Id, Name, Description, EffectiveDate, ExpirationDate, 
               Status, CurrencyIsoCode, Country__c, Region__c
        FROM Pricebook2 
        WHERE IsActive = true
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
      
      if (conditions.length > 0) {
        soql += ` AND ${conditions.join(' AND ')}`;
      }
      
      soql += ' ORDER BY Name';
      
      // Get total count first
      const countSoql = soql.replace(/SELECT .+ FROM/, 'SELECT COUNT() FROM');
      const countResult = await salesforceApiService.query(countSoql, username, isSandbox);
      const totalCount = countResult.totalSize || 0;
      
      // Add pagination (Salesforce doesn't support OFFSET, so we'll fetch all and slice)
      // For better performance with large datasets, consider using queryMore
      const result = await salesforceApiService.query(soql, username, isSandbox);
      
      let allPriceLists = result.records?.map(priceList => ({
        id: priceList.Id,
        name: priceList.Name,
        description: priceList.Description,
        effectiveDate: priceList.EffectiveDate,
        expirationDate: priceList.ExpirationDate,
        status: priceList.Status,
        currency: priceList.CurrencyIsoCode,
        country: priceList.Country__c,
        region: priceList.Region__c
      })) || [];
      
      // Apply pagination
      const paginatedPriceLists = allPriceLists.slice(offset, offset + limit);
      
      logger.log('info', 'Price lists retrieved from Salesforce', {
        count: paginatedPriceLists.length,
        total: totalCount,
        page,
        limit,
        filters,
        username,
        service: 'vlocityPricingService'
      });
      
      return {
        priceLists: paginatedPriceLists,
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit),
        hasMore: offset + paginatedPriceLists.length < totalCount
      };
    } catch (error) {
      logger.logError(error, {
        operation: 'getAllPriceListsFromSalesforce',
        filters,
        pagination,
        username,
        service: 'vlocityPricingService'
      });
      throw error;
    }
  }

  /**
   * Create price list in Salesforce
   */
  async createPriceListInSalesforce(priceListData, username, isSandbox = false) {
    try {
      const recordData = {
        Name: priceListData.name,
        Description: priceListData.description,
        EffectiveDate: priceListData.effectiveDate,
        ExpirationDate: priceListData.expirationDate,
        Status: priceListData.status || 'Draft',
        CurrencyIsoCode: priceListData.currency,
        Country__c: priceListData.country,
        Region__c: priceListData.region,
        IsActive: true
      };
      
      const result = await salesforceApiService.createRecord('Pricebook2', recordData, username, isSandbox);
      
      logger.log('info', 'Price list created in Salesforce', {
        priceListId: result.id,
        priceListName: priceListData.name,
        username,
        service: 'vlocityPricingService'
      });
      
      return result;
    } catch (error) {
      logger.logError(error, {
        operation: 'createPriceListInSalesforce',
        priceListData,
        username,
        service: 'vlocityPricingService'
      });
      throw error;
    }
  }

  /**
   * Update price list in Salesforce
   */
  async updatePriceListInSalesforce(priceListId, priceListData, username, isSandbox = false) {
    try {
      const recordData = {};
      
      if (priceListData.name) recordData.Name = priceListData.name;
      if (priceListData.description) recordData.Description = priceListData.description;
      if (priceListData.effectiveDate) recordData.EffectiveDate = priceListData.effectiveDate;
      if (priceListData.expirationDate) recordData.ExpirationDate = priceListData.expirationDate;
      if (priceListData.status) recordData.Status = priceListData.status;
      if (priceListData.currency) recordData.CurrencyIsoCode = priceListData.currency;
      if (priceListData.country) recordData.Country__c = priceListData.country;
      if (priceListData.region) recordData.Region__c = priceListData.region;
      
      const result = await salesforceApiService.updateRecord('Pricebook2', priceListId, recordData, username, isSandbox);
      
      logger.log('info', 'Price list updated in Salesforce', {
        priceListId,
        username,
        service: 'vlocityPricingService'
      });
      
      return result;
    } catch (error) {
      logger.logError(error, {
        operation: 'updatePriceListInSalesforce',
        priceListId,
        priceListData,
        username,
        service: 'vlocityPricingService'
      });
      throw error;
    }
  }

  /**
   * Add price list entry
   */
  async addPriceListEntry(priceListId, entryData, username, isSandbox = false) {
    try {
      const recordData = {
        Pricebook2Id: priceListId,
        Product2Id: entryData.productId,
        UnitPrice: entryData.unitPrice,
        ListPrice: entryData.listPrice || entryData.unitPrice,
        EffectiveDate: entryData.effectiveDate,
        ExpirationDate: entryData.expirationDate,
        CurrencyIsoCode: entryData.currency,
        IsActive: true
      };
      
      const result = await salesforceApiService.createRecord('PricebookEntry', recordData, username, isSandbox);
      
      logger.log('info', 'Price list entry added', {
        priceListId,
        entryId: result.id,
        productId: entryData.productId,
        unitPrice: entryData.unitPrice,
        username,
        service: 'vlocityPricingService'
      });
      
      return result;
    } catch (error) {
      logger.logError(error, {
        operation: 'addPriceListEntry',
        priceListId,
        entryData,
        username,
        service: 'vlocityPricingService'
      });
      throw error;
    }
  }

  /**
   * Update price list entry
   */
  async updatePriceListEntry(entryId, entryData, username, isSandbox = false) {
    try {
      const recordData = {};
      
      if (entryData.unitPrice !== undefined) recordData.UnitPrice = entryData.unitPrice;
      if (entryData.listPrice !== undefined) recordData.ListPrice = entryData.listPrice;
      if (entryData.effectiveDate) recordData.EffectiveDate = entryData.effectiveDate;
      if (entryData.expirationDate) recordData.ExpirationDate = entryData.expirationDate;
      if (entryData.currency) recordData.CurrencyIsoCode = entryData.currency;
      if (entryData.isActive !== undefined) recordData.IsActive = entryData.isActive;
      
      const result = await salesforceApiService.updateRecord('PricebookEntry', entryId, recordData, username, isSandbox);
      
      logger.log('info', 'Price list entry updated', {
        entryId,
        username,
        service: 'vlocityPricingService'
      });
      
      return result;
    } catch (error) {
      logger.logError(error, {
        operation: 'updatePriceListEntry',
        entryId,
        entryData,
        username,
        service: 'vlocityPricingService'
      });
      throw error;
    }
  }

  /**
   * Delete price list entry
   */
  async deletePriceListEntry(entryId, username, isSandbox = false) {
    try {
      // For PricebookEntry, we typically set IsActive to false rather than deleting
      // But we'll support hard delete if needed
      const result = await salesforceApiService.deleteRecord('PricebookEntry', entryId, username, isSandbox);
      
      logger.log('info', 'Price list entry deleted', {
        entryId,
        username,
        service: 'vlocityPricingService'
      });
      
      return result;
    } catch (error) {
      logger.logError(error, {
        operation: 'deletePriceListEntry',
        entryId,
        username,
        service: 'vlocityPricingService'
      });
      throw error;
    }
  }

  /**
   * Get products for price list
   */
  async getProductsForPriceList(priceListId, username, isSandbox = false) {
    try {
      const soql = `
        SELECT Id, Product2Id, Product2.Name, Product2.ProductCode, 
               Product2.Description, UnitPrice, ListPrice, 
               EffectiveDate, ExpirationDate, CurrencyIsoCode, IsActive
        FROM PricebookEntry 
        WHERE Pricebook2Id = '${priceListId}' AND IsActive = true
        ORDER BY Product2.Name
      `;
      
      const result = await salesforceApiService.query(soql, username, isSandbox);
      
      const products = result.records?.map(entry => ({
        entryId: entry.Id,
        productId: entry.Product2Id,
        productName: entry.Product2?.Name,
        productCode: entry.Product2?.ProductCode,
        description: entry.Product2?.Description,
        unitPrice: entry.UnitPrice,
        listPrice: entry.ListPrice,
        effectiveDate: entry.EffectiveDate,
        expirationDate: entry.ExpirationDate,
        currency: entry.CurrencyIsoCode,
        isActive: entry.IsActive
      })) || [];
      
      logger.log('info', 'Products retrieved for price list', {
        priceListId,
        productCount: products.length,
        username,
        service: 'vlocityPricingService'
      });
      
      return products;
    } catch (error) {
      logger.logError(error, {
        operation: 'getProductsForPriceList',
        priceListId,
        username,
        service: 'vlocityPricingService'
      });
      throw error;
    }
  }

  /**
   * Export price list to file
   */
  async exportPriceList(priceListId, username, isSandbox = false, exportFormat = 'json') {
    try {
      const priceList = await this.getPriceListFromSalesforce(priceListId, username, isSandbox);
      const products = await this.getProductsForPriceList(priceListId, username, isSandbox);
      
      const exportData = {
        exportDate: new Date().toISOString(),
        priceList,
        products,
        metadata: {
          totalProducts: products.length,
          currency: priceList.currency,
          country: priceList.country,
          region: priceList.region
        }
      };
      
      const fileName = `price-list-${priceList.name.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}.${exportFormat}`;
      const filePath = path.join(this.pricingDir, fileName);
      
      if (exportFormat === 'json') {
        await fs.writeJson(filePath, exportData, { spaces: 2 });
      } else if (exportFormat === 'csv') {
        const csvContent = this.convertToCSV(exportData);
        await fs.writeFile(filePath, csvContent, 'utf8');
      }
      
      logger.log('info', 'Price list exported', {
        priceListId,
        fileName,
        productCount: products.length,
        exportFormat,
        username,
        service: 'vlocityPricingService'
      });
      
      return filePath;
    } catch (error) {
      logger.logError(error, {
        operation: 'exportPriceList',
        priceListId,
        exportFormat,
        username,
        service: 'vlocityPricingService'
      });
      throw error;
    }
  }

  /**
   * Convert price list data to CSV
   */
  convertToCSV(exportData) {
    const headers = ['Product Name', 'Product Code', 'Unit Price', 'List Price', 'Currency', 'Effective Date', 'Expiration Date'];
    const rows = [headers.join(',')];
    
    for (const product of exportData.products) {
      const row = [
        `"${product.productName || ''}"`,
        `"${product.productCode || ''}"`,
        product.unitPrice || '',
        product.listPrice || '',
        `"${product.currency || ''}"`,
        `"${product.effectiveDate || ''}"`,
        `"${product.expirationDate || ''}"`
      ];
      rows.push(row.join(','));
    }
    
    return rows.join('\n');
  }

  /**
   * Import price list from file
   */
  async importPriceList(filePath, username, isSandbox = false) {
    try {
      const fileExtension = path.extname(filePath).toLowerCase();
      let importData;
      
      if (fileExtension === '.json') {
        importData = await fs.readJson(filePath);
      } else if (fileExtension === '.csv') {
        importData = this.parseCSV(await fs.readFile(filePath, 'utf8'));
      } else {
        throw new Error('Unsupported file format. Only JSON and CSV are supported.');
      }
      
      // Create price list
      const priceListResult = await this.createPriceListInSalesforce(importData.priceList, username, isSandbox);
      
      // Add products
      let addedProducts = 0;
      for (const product of importData.products) {
        try {
          await this.addPriceListEntry(priceListResult.id, product, username, isSandbox);
          addedProducts++;
        } catch (error) {
          logger.log('warn', 'Failed to add product to price list', {
            productId: product.productId,
            productName: product.productName,
            error: error.message,
            service: 'vlocityPricingService'
          });
        }
      }
      
      logger.log('info', 'Price list imported', {
        filePath,
        priceListId: priceListResult.id,
        addedProducts,
        totalProducts: importData.products.length,
        username,
        service: 'vlocityPricingService'
      });
      
      return {
        priceListId: priceListResult.id,
        addedProducts,
        totalProducts: importData.products.length
      };
    } catch (error) {
      logger.logError(error, {
        operation: 'importPriceList',
        filePath,
        username,
        service: 'vlocityPricingService'
      });
      throw error;
    }
  }

  /**
   * Parse CSV data
   */
  parseCSV(csvContent) {
    const lines = csvContent.split('\n');
    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
    const products = [];
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const values = line.split(',').map(v => v.replace(/"/g, '').trim());
      const product = {};
      
      headers.forEach((header, index) => {
        const value = values[index];
        switch (header.toLowerCase()) {
          case 'product name':
            product.productName = value;
            break;
          case 'product code':
            product.productCode = value;
            break;
          case 'unit price':
            product.unitPrice = parseFloat(value) || 0;
            break;
          case 'list price':
            product.listPrice = parseFloat(value) || 0;
            break;
          case 'currency':
            product.currency = value;
            break;
          case 'effective date':
            product.effectiveDate = value;
            break;
          case 'expiration date':
            product.expirationDate = value;
            break;
        }
      });
      
      if (product.productName) {
        products.push(product);
      }
    }
    
    return {
      priceList: {
        name: 'Imported Price List',
        description: 'Imported from CSV file',
        status: 'Draft',
        currency: products[0]?.currency || 'USD'
      },
      products
    };
  }

  /**
   * Get pricing statistics
   */
  async getPricingStats(username, isSandbox = false) {
    try {
      const priceLists = await this.getAllPriceListsFromSalesforce(username, isSandbox);
      
      const stats = {
        totalPriceLists: priceLists.length,
        byCountry: {},
        byCurrency: {},
        byStatus: {},
        totalProducts: 0
      };
      
      for (const priceList of priceLists) {
        // Count by country
        const country = priceList.country || 'Unknown';
        stats.byCountry[country] = (stats.byCountry[country] || 0) + 1;
        
        // Count by currency
        const currency = priceList.currency || 'Unknown';
        stats.byCurrency[currency] = (stats.byCurrency[currency] || 0) + 1;
        
        // Count by status
        const status = priceList.status || 'Unknown';
        stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;
        
        // Get product count for each price list
        try {
          const products = await this.getProductsForPriceList(priceList.id, username, isSandbox);
          stats.totalProducts += products.length;
        } catch (error) {
          // Ignore errors for individual price lists
        }
      }
      
      return stats;
    } catch (error) {
      logger.logError(error, {
        operation: 'getPricingStats',
        username,
        service: 'vlocityPricingService'
      });
      throw error;
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.priceListCache.clear();
    logger.log('info', 'Price list cache cleared', {
      service: 'vlocityPricingService'
    });
  }

  /**
   * Get service statistics
   */
  getServiceStats() {
    return {
      cachedPriceLists: this.priceListCache.size,
      pricingDir: this.pricingDir,
      service: 'vlocityPricingService'
    };
  }
}

// Create singleton instance
const vlocityPricingService = new VlocityPricingService();

module.exports = vlocityPricingService;
