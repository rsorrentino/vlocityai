const salesforceService = require('./salesforceService');
const logger = require('../utils/logger');

/**
 * Service for diagnosing product configuration issues in Vlocity CPQ
 * Checks for common causes of null pointer errors when adding products to cart
 */
class ProductDiagnosticService {
  /**
   * Comprehensive product configuration diagnostic
   * @param {string} productId - Product2 ID or Product Name
   * @param {string} username - Salesforce username
   * @returns {Promise<Object>} Diagnostic report
   */
  async diagnoseProduct(productId, username) {
    try {
      await salesforceService.authenticateWithSfdx(username);
      
      const diagnostics = {
        productId: null,
        productName: null,
        issues: [],
        warnings: [],
        configuration: {},
        recommendations: []
      };

      // Step 1: Get Product2 basic info
      const productInfo = await this.getProductInfo(productId, username);
      if (!productInfo) {
        diagnostics.issues.push({
          severity: 'error',
          category: 'Product',
          message: `Product not found: ${productId}`,
          details: 'The product ID or name does not exist in the org'
        });
        return diagnostics;
      }

      diagnostics.productId = productInfo.Id;
      diagnostics.productName = productInfo.Name;
      diagnostics.configuration.product = productInfo;

      // Step 2: Check Product2 required fields
      this.checkProductFields(productInfo, diagnostics);

      // Step 3: Check Price Lists and Price List Entries
      const priceListInfo = await this.checkPriceLists(productInfo.Id, username, diagnostics);
      diagnostics.configuration.priceLists = priceListInfo;

      // Step 4: Check PricebookEntry
      const pricebookInfo = await this.checkPricebookEntries(productInfo.Id, username, diagnostics);
      diagnostics.configuration.pricebookEntries = pricebookInfo;

      // Step 5: Check Attributes and Attribute Categories
      const attributeInfo = await this.checkAttributes(productInfo.Id, username, diagnostics);
      diagnostics.configuration.attributes = attributeInfo;

      // Step 6: Check Object Layout/Section/Facet configuration
      const layoutInfo = await this.checkObjectLayouts(productInfo, username, diagnostics);
      diagnostics.configuration.objectLayouts = layoutInfo;

      // Step 7: Check Object Context Rules
      const contextRuleInfo = await this.checkObjectContextRules(productInfo, username, diagnostics);
      diagnostics.configuration.objectContextRules = contextRuleInfo;

      // Step 8: Check GlobalKey (critical for Vlocity)
      this.checkGlobalKey(productInfo, diagnostics);

      // Step 9: Generate recommendations
      this.generateRecommendations(diagnostics);

      return diagnostics;
    } catch (error) {
      logger.logError(error, { operation: 'diagnoseProduct', productId, username });
      throw new Error(`Product diagnostic failed: ${error.message}`);
    }
  }

  /**
   * Get Product2 information
   */
  async getProductInfo(productIdOrName, username) {
    try {
      // Try as ID first (15/18 chars)
      if (productIdOrName.length === 15 || productIdOrName.length === 18) {
        const soql = `SELECT Id, Name, ProductCode, IsActive, Family, Description,
                             vlocity_cmt__GlobalKey__c, vlocity_cmt__ObjectTypeId__c,
                             vlocity_cmt__Type__c, vlocity_cmt__SubType__c,
                             CreatedDate, LastModifiedDate
                      FROM Product2
                      WHERE Id = '${productIdOrName}' AND GT_IsTechnicalProduct__c = false`;
        const result = await salesforceService.query(soql);
        if (result.records && result.records.length > 0) {
          return result.records[0];
        }
      }

      // Try as Name
      const soql = `SELECT Id, Name, ProductCode, IsActive, Family, Description,
                           vlocity_cmt__GlobalKey__c, vlocity_cmt__ObjectTypeId__c,
                           vlocity_cmt__Type__c, vlocity_cmt__SubType__c,
                           CreatedDate, LastModifiedDate
                    FROM Product2
                    WHERE (Name = '${productIdOrName.replace(/'/g, "\\'")}'
                    OR ProductCode = '${productIdOrName.replace(/'/g, "\\'")}')
                    AND GT_IsTechnicalProduct__c = false
                    LIMIT 1`;
      const result = await salesforceService.query(soql);
      return result.records && result.records.length > 0 ? result.records[0] : null;
    } catch (error) {
      logger.logError(error, { operation: 'getProductInfo', productIdOrName });
      return null;
    }
  }

  /**
   * Check Product2 required fields
   */
  checkProductFields(product, diagnostics) {
    if (!product.IsActive) {
      diagnostics.issues.push({
        severity: 'error',
        category: 'Product',
        message: 'Product is not active',
        details: 'Product must be active to be added to cart'
      });
    }

    if (!product.vlocity_cmt__GlobalKey__c) {
      diagnostics.issues.push({
        severity: 'error',
        category: 'Product',
        message: 'Missing GlobalKey',
        details: 'vlocity_cmt__GlobalKey__c is required for Vlocity products. This is a critical field that often causes null pointer errors.'
      });
    }

    if (!product.vlocity_cmt__ObjectTypeId__c) {
      diagnostics.warnings.push({
        severity: 'warning',
        category: 'Product',
        message: 'Missing ObjectTypeId',
        details: 'vlocity_cmt__ObjectTypeId__c is recommended for proper product categorization'
      });
    }
  }

  /**
   * Check Price Lists and Price List Entries
   */
  async checkPriceLists(productId, username, diagnostics) {
    try {
      const soql = `SELECT Id, Name, vlocity_cmt__Code__c, vlocity_cmt__IsActive__c,
                           vlocity_cmt__CurrencyCode__c, GT_OrganizationCode__c, GT_CountryCode__c,
                           GT_IsPrimary__c,
                           (SELECT Id, vlocity_cmt__ProductId__c, vlocity_cmt__UnitPrice__c,
                                   vlocity_cmt__ListPrice__c, vlocity_cmt__EffectiveFromDate__c,
                                   vlocity_cmt__EffectiveUntilDate__c, vlocity_cmt__IsActive__c
                            FROM vlocity_cmt__PriceListEntries__r
                            WHERE vlocity_cmt__ProductId__c = '${productId}'
                            OR vlocity_cmt__Product2Id__c = '${productId}')
                    FROM vlocity_cmt__PriceList__c
                    WHERE vlocity_cmt__IsActive__c = true`;
      
      const result = await salesforceService.query(soql);
      const priceLists = result.records || [];

      if (priceLists.length === 0) {
        diagnostics.issues.push({
          severity: 'error',
          category: 'Pricing',
          message: 'No active Price Lists found',
          details: 'Product must have at least one active Price List to be added to cart'
        });
      } else {
        let hasActiveEntries = false;
        priceLists.forEach(priceList => {
          const entries = priceList.vlocity_cmt__PriceListEntries__r?.records || [];
          if (entries.length === 0) {
            diagnostics.warnings.push({
              severity: 'warning',
              category: 'Pricing',
              message: `Price List ${priceList.Name} has no entries for this product`,
              details: `PriceList: ${priceList.Name} (${priceList.vlocity_cmt__Code__c})`
            });
          } else {
            const activeEntries = entries.filter(e => e.vlocity_cmt__IsActive__c);
            if (activeEntries.length > 0) {
              hasActiveEntries = true;
            } else {
              diagnostics.warnings.push({
                severity: 'warning',
                category: 'Pricing',
                message: `Price List ${priceList.Name} has no active entries`,
                details: `PriceList: ${priceList.Name} (${priceList.vlocity_cmt__Code__c})`
              });
            }
          }
        });

        if (!hasActiveEntries) {
          diagnostics.issues.push({
            severity: 'error',
            category: 'Pricing',
            message: 'No active Price List Entries found',
            details: 'Product must have at least one active Price List Entry with valid pricing'
          });
        }
      }

      return priceLists.map(pl => ({
        id: pl.Id,
        name: pl.Name,
        code: pl.vlocity_cmt__Code__c,
        isActive: pl.vlocity_cmt__IsActive__c,
        currencyCode: pl.vlocity_cmt__CurrencyCode__c,
        orgCode: pl.GT_OrganizationCode__c,
        countryCode: pl.GT_CountryCode__c,
        isPrimary: pl.GT_IsPrimary__c,
        entryCount: pl.vlocity_cmt__PriceListEntries__r?.records?.length || 0
      }));
    } catch (error) {
      logger.logError(error, { operation: 'checkPriceLists', productId });
      diagnostics.issues.push({
        severity: 'error',
        category: 'Pricing',
        message: 'Error checking Price Lists',
        details: error.message
      });
      return [];
    }
  }

  /**
   * Check PricebookEntry
   */
  async checkPricebookEntries(productId, username, diagnostics) {
    try {
      const soql = `SELECT Id, Pricebook2Id, Pricebook2.Name, UnitPrice, ListPrice,
                           IsActive, CurrencyIsoCode, UseStandardPrice
                    FROM PricebookEntry
                    WHERE Product2Id = '${productId}'
                    AND IsActive = true`;
      
      const result = await salesforceService.query(soql);
      const entries = result.records || [];

      if (entries.length === 0) {
        diagnostics.warnings.push({
          severity: 'warning',
          category: 'Pricing',
          message: 'No active PricebookEntry found',
          details: 'While Vlocity uses Price Lists, standard PricebookEntry is also recommended'
        });
      }

      return entries.map(e => ({
        id: e.Id,
        pricebookId: e.Pricebook2Id,
        pricebookName: e.Pricebook2?.Name,
        unitPrice: e.UnitPrice,
        listPrice: e.ListPrice,
        currency: e.CurrencyIsoCode,
        isActive: e.IsActive
      }));
    } catch (error) {
      logger.logError(error, { operation: 'checkPricebookEntries', productId });
      diagnostics.warnings.push({
        severity: 'warning',
        category: 'Pricing',
        message: 'Error checking PricebookEntry',
        details: error.message
      });
      return [];
    }
  }

  /**
   * Check Attributes and Attribute Categories
   */
  async checkAttributes(productId, username, diagnostics) {
    try {
      // Check Attribute Assignments
      const assignmentSoql = `SELECT Id, vlocity_cmt__AttributeId__c, vlocity_cmt__AttributeId__r.Name,
                                      vlocity_cmt__AttributeCategoryId__c, vlocity_cmt__AttributeCategoryId__r.Name,
                                      vlocity_cmt__IsActive__c
                               FROM vlocity_cmt__AttributeAssignment__c
                               WHERE vlocity_cmt__ProductId__c = '${productId}'
                               OR vlocity_cmt__Product2Id__c = '${productId}'`;
      
      const assignmentResult = await salesforceService.query(assignmentSoql);
      const assignments = assignmentResult.records || [];

      // Check for required attributes
      const requiredAttributesSoql = `SELECT Id, Name, vlocity_cmt__IsRequired__c, vlocity_cmt__IsActive__c
                                      FROM vlocity_cmt__Attribute__c
                                      WHERE vlocity_cmt__IsRequired__c = true
                                      AND vlocity_cmt__IsActive__c = true`;
      
      const requiredAttrResult = await salesforceService.query(requiredAttributesSoql);
      const requiredAttributes = requiredAttrResult.records || [];

      // Check if required attributes are assigned
      const assignedAttributeIds = new Set(
        assignments.map(a => a.vlocity_cmt__AttributeId__c).filter(Boolean)
      );

      requiredAttributes.forEach(attr => {
        if (!assignedAttributeIds.has(attr.Id)) {
          diagnostics.warnings.push({
            severity: 'warning',
            category: 'Attributes',
            message: `Required attribute not assigned: ${attr.Name}`,
            details: `Attribute ${attr.Name} is marked as required but not assigned to this product`
          });
        }
      });

      return {
        assignments: assignments.map(a => ({
          id: a.Id,
          attributeId: a.vlocity_cmt__AttributeId__c,
          attributeName: a.vlocity_cmt__AttributeId__r?.Name,
          categoryId: a.vlocity_cmt__AttributeCategoryId__c,
          categoryName: a.vlocity_cmt__AttributeCategoryId__r?.Name,
          isActive: a.vlocity_cmt__IsActive__c
        })),
        requiredAttributesCount: requiredAttributes.length,
        assignedAttributesCount: assignments.length
      };
    } catch (error) {
      logger.logError(error, { operation: 'checkAttributes', productId });
      diagnostics.warnings.push({
        severity: 'warning',
        category: 'Attributes',
        message: 'Error checking attributes',
        details: error.message
      });
      return { assignments: [], requiredAttributesCount: 0, assignedAttributesCount: 0 };
    }
  }

  /**
   * Check Object Layout configurations
   */
  async checkObjectLayouts(product, username, diagnostics) {
    try {
      // Check if product has ObjectTypeId
      if (!product.vlocity_cmt__ObjectTypeId__c) {
        return { layouts: [], sections: [], facets: [] };
      }

      // Get Object Layouts for this ObjectType
      const layoutSoql = `SELECT Id, Name, vlocity_cmt__GlobalKey__c, vlocity_cmt__ObjectTypeId__c
                          FROM vlocity_cmt__ObjectLayout__c
                          WHERE vlocity_cmt__ObjectTypeId__c = '${product.vlocity_cmt__ObjectTypeId__c}'`;
      
      const layoutResult = await salesforceService.query(layoutSoql);
      const layouts = layoutResult.records || [];

      if (layouts.length === 0) {
        diagnostics.warnings.push({
          severity: 'warning',
          category: 'UI Configuration',
          message: 'No Object Layout found for product ObjectType',
          details: `ObjectTypeId: ${product.vlocity_cmt__ObjectTypeId__c}. Object Layouts are needed for proper product display in cart.`
        });
      }

      // Get Object Sections
      const sectionSoql = `SELECT Id, Name, vlocity_cmt__GlobalKey__c, vlocity_cmt__ObjectLayoutId__c
                           FROM vlocity_cmt__ObjectSection__c
                           WHERE vlocity_cmt__ObjectLayoutId__c IN (${layouts.map(l => `'${l.Id}'`).join(',')})`;
      
      const sectionResult = layouts.length > 0 ? await salesforceService.query(sectionSoql) : { records: [] };
      const sections = sectionResult.records || [];

      // Get Object Facets
      const facetSoql = `SELECT Id, Name, vlocity_cmt__GlobalKey__c, vlocity_cmt__ObjectSectionId__c
                         FROM vlocity_cmt__ObjectFacet__c
                         WHERE vlocity_cmt__ObjectSectionId__c IN (${sections.map(s => `'${s.Id}'`).join(',')})`;
      
      const facetResult = sections.length > 0 ? await salesforceService.query(facetSoql) : { records: [] };
      const facets = facetResult.records || [];

      return {
        layouts: layouts.map(l => ({ id: l.Id, name: l.Name, globalKey: l.vlocity_cmt__GlobalKey__c })),
        sections: sections.map(s => ({ id: s.Id, name: s.Name, globalKey: s.vlocity_cmt__GlobalKey__c })),
        facets: facets.map(f => ({ id: f.Id, name: f.Name, globalKey: f.vlocity_cmt__GlobalKey__c }))
      };
    } catch (error) {
      logger.logError(error, { operation: 'checkObjectLayouts', productId: product.Id });
      return { layouts: [], sections: [], facets: [] };
    }
  }

  /**
   * Check Object Context Rules
   */
  async checkObjectContextRules(product, username, diagnostics) {
    try {
      if (!product.vlocity_cmt__ObjectTypeId__c) {
        return [];
      }

      const soql = `SELECT Id, Name, vlocity_cmt__ObjectTypeId__c, vlocity_cmt__IsActive__c
                    FROM vlocity_cmt__ObjectRuleAssignment__c
                    WHERE vlocity_cmt__ObjectTypeId__c = '${product.vlocity_cmt__ObjectTypeId__c}'
                    AND vlocity_cmt__IsActive__c = true`;
      
      const result = await salesforceService.query(soql);
      return result.records || [];
    } catch (error) {
      logger.logError(error, { operation: 'checkObjectContextRules', productId: product.Id });
      return [];
    }
  }

  /**
   * Check GlobalKey (critical for Vlocity)
   */
  checkGlobalKey(product, diagnostics) {
    if (!product.vlocity_cmt__GlobalKey__c) {
      diagnostics.issues.push({
        severity: 'error',
        category: 'Product',
        message: 'Missing GlobalKey - CRITICAL',
        details: 'vlocity_cmt__GlobalKey__c is absolutely required for Vlocity products. This is the most common cause of null pointer errors when adding products to cart. The GlobalKey must be unique and properly formatted.'
      });
    } else {
      // Validate GlobalKey format
      const globalKeyPattern = /^[a-zA-Z0-9_-]+$/;
      if (!globalKeyPattern.test(product.vlocity_cmt__GlobalKey__c)) {
        diagnostics.warnings.push({
          severity: 'warning',
          category: 'Product',
          message: 'GlobalKey format may be invalid',
          details: `GlobalKey: ${product.vlocity_cmt__GlobalKey__c}. Should contain only alphanumeric characters, underscores, and hyphens.`
        });
      }
    }
  }

  /**
   * Generate recommendations based on findings
   */
  generateRecommendations(diagnostics) {
    const hasErrors = diagnostics.issues.length > 0;
    const hasWarnings = diagnostics.warnings.length > 0;

    if (hasErrors) {
      diagnostics.recommendations.push({
        priority: 'HIGH',
        action: 'Fix critical issues first',
        details: 'Address all error-level issues before testing again'
      });
    }

    if (diagnostics.issues.some(i => i.message.includes('GlobalKey'))) {
      diagnostics.recommendations.push({
        priority: 'CRITICAL',
        action: 'Set GlobalKey on Product',
        details: 'Update the Product2 record and set vlocity_cmt__GlobalKey__c to a unique value (e.g., product code or name)',
        soql: `UPDATE Product2 SET vlocity_cmt__GlobalKey__c = 'YOUR_GLOBAL_KEY' WHERE Id = '${diagnostics.productId}'`
      });
    }

    if (diagnostics.issues.some(i => i.message.includes('Price List'))) {
      diagnostics.recommendations.push({
        priority: 'HIGH',
        action: 'Create Price List Entry',
        details: 'Create an active Price List Entry for this product with valid pricing',
        soql: `SELECT Id, Name FROM vlocity_cmt__PriceList__c WHERE vlocity_cmt__IsActive__c = true LIMIT 5`
      });
    }

    if (diagnostics.warnings.some(w => w.category === 'Attributes')) {
      diagnostics.recommendations.push({
        priority: 'MEDIUM',
        action: 'Review Attribute Assignments',
        details: 'Ensure all required attributes are assigned to the product'
      });
    }

    if (!hasErrors && !hasWarnings) {
      diagnostics.recommendations.push({
        priority: 'INFO',
        action: 'Configuration looks good',
        details: 'All basic checks passed. If null pointer persists, check Apex code logs or browser console for specific field causing the issue.'
      });
    }
  }
}

module.exports = new ProductDiagnosticService();

