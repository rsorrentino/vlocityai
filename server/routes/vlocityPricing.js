const express = require('express');
const router = express.Router();
const salesforceService = require('../services/salesforceService');
const sfdxAuthService = require('../services/sfdxAuthService');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

/**
 * @swagger
 * /api/vlocity/pricing/pricelists:
 *   get:
 *     summary: Get Vlocity Price Lists
 *     tags: [Vlocity Pricing]
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: country
 *         schema:
 *           type: string
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: List of price lists
 */
router.get('/pricelists', asyncHandler(async (req, res) => {
  const { username, country, active, name, page, limit } = req.query;

  if (!username) {
    return res.status(400).json({
      success: false,
      error: 'Username parameter is required',
    });
  }

  // Authenticate with SF CLI
  await salesforceService.authenticateWithSfdx(username);

  const filters = {};
  if (country) filters.country = country;
  if (active !== undefined) filters.active = active === 'true';
  if (name) filters.name = name;

  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 25;
  const offset = (pageNum - 1) * limitNum;

  const priceLists = await salesforceService.getVlocityPriceLists(filters);
  const total = priceLists.length;
  const paginatedPriceLists = priceLists.slice(offset, offset + limitNum);

  res.json({
    success: true,
    data: paginatedPriceLists,
    count: paginatedPriceLists.length,
    total: total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum),
    hasMore: offset + paginatedPriceLists.length < total,
    filters,
  });
}));

/**
 * @swagger
 * /api/vlocity/pricing/pricelists/{id}:
 *   get:
 *     summary: Get Price List by ID
 *     tags: [Vlocity Pricing]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *       - in: query
 *         name: username
 *         required: true
 *     responses:
 *       200:
 *         description: Price list details
 */
router.get('/pricelists/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { username } = req.query;

  if (!username) {
    return res.status(400).json({
      success: false,
      error: 'Username parameter is required',
    });
  }

  await salesforceService.authenticateWithSfdx(username);

  const priceList = await salesforceService.retrieve('vlocity_cmt__PriceList__c', id, [
    'Id',
    'Name',
    'vlocity_cmt__Code__c',
    'vlocity_cmt__IsActive__c',
    'vlocity_cmt__CurrencyCode__c',
    'vlocity_cmt__EffectiveDate__c',
    'vlocity_cmt__EndDate__c',
    'vlocity_cmt__Description__c',
    'CreatedDate',
    'LastModifiedDate',
  ]);

  res.json({
    success: true,
    data: priceList,
  });
}));

/**
 * @swagger
 * /api/vlocity/pricing/pricelists/{id}/entries:
 *   get:
 *     summary: Get Price List Entries
 *     tags: [Vlocity Pricing]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *       - in: query
 *         name: username
 *         required: true
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 200
 *     responses:
 *       200:
 *         description: List of price list entries
 */
router.get('/pricelists/:id/entries', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { username, limit = 200 } = req.query;

  if (!username) {
    return res.status(400).json({
      success: false,
      error: 'Username parameter is required',
    });
  }

  await salesforceService.authenticateWithSfdx(username);

  try {
    // Query Price List Entries - use only basic fields that should exist
    const soql = `SELECT Id, Name
                  FROM vlocity_cmt__PriceListEntry__c
                  WHERE vlocity_cmt__PriceListId__c = '${id}'
                  ORDER BY Name
                  LIMIT ${parseInt(limit)}`;

    const result = await salesforceService.query(soql);
    
    // Return minimal data - frontend will handle missing fields gracefully
    res.json({
      success: true,
      data: result.records || [],
      totalSize: result.totalSize || 0,
      done: result.done || true,
      message: 'Note: Some fields may not be available in your Salesforce org'
    });
    return;
  } catch (error) {
    logger.logWarning('Price list entries query failed, returning empty', { error: error.message });
    res.json({
      success: true,
      data: [],
      totalSize: 0,
      done: true,
      message: 'Price list entries not available for this org'
    });
    return;
  }
  
}));

/**
 * @swagger
 * /api/vlocity/pricing/promotions:
 *   get:
 *     summary: Get Vlocity Promotions
 *     tags: [Vlocity Pricing]
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *       - in: query
 *         name: country
 *       - in: query
 *         name: active
 *     responses:
 *       200:
 *         description: List of promotions
 */
router.get('/promotions', asyncHandler(async (req, res) => {
  const { username, country, active, name, code, promotionType, page, limit } = req.query;

  if (!username) {
    return res.status(400).json({
      success: false,
      error: 'Username parameter is required',
    });
  }

  await salesforceService.authenticateWithSfdx(username);

  const filters = {};
  if (country) filters.country = country;
  if (active !== undefined) filters.active = active === 'true';
  if (name) filters.name = name;
  if (code) filters.code = code;
  if (promotionType) filters.promotionType = promotionType;

  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 25;
  const offset = (pageNum - 1) * limitNum;

  const promotions = await salesforceService.getVlocityPromotions(filters);
  const total = promotions.length;
  const paginatedPromotions = promotions.slice(offset, offset + limitNum);

  res.json({
    success: true,
    data: paginatedPromotions,
    count: paginatedPromotions.length,
    total: total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum),
    hasMore: offset + paginatedPromotions.length < total,
  });
}));

/**
 * @swagger
 * /api/vlocity/pricing/staging-area:
 *   get:
 *     summary: Get Staging Area Records
 *     tags: [Vlocity Pricing]
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *       - in: query
 *         name: countryCode
 *         required: true
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           default: New
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 1000
 *     responses:
 *       200:
 *         description: List of staging area records
 */
router.get('/staging-area', asyncHandler(async (req, res) => {
  const { username, countryCode, status = 'New', limit = 1000 } = req.query;

  if (!username) {
    return res.status(400).json({
      success: false,
      error: 'Username parameter is required',
    });
  }

  if (!countryCode) {
    return res.status(400).json({
      success: false,
      error: 'countryCode parameter is required',
    });
  }

  await salesforceService.authenticateWithSfdx(username);

  const records = await salesforceService.getStagingAreaRecords(countryCode, status, limit);

  res.json({
    success: true,
    data: records,
    count: records.length,
    filters: { countryCode, status, limit },
  });
}));

/**
 * @swagger
 * /api/vlocity/pricing/batch/execute:
 *   post:
 *     summary: Execute Salesforce Batch Job
 *     tags: [Vlocity Pricing]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               apexClassName:
 *                 type: string
 *               batchSize:
 *                 type: integer
 *                 default: 200
 *     responses:
 *       200:
 *         description: Batch job started
 */
router.post('/batch/execute', asyncHandler(async (req, res) => {
  const { username, apexClassName, batchSize = 200 } = req.body;

  if (!username || !apexClassName) {
    return res.status(400).json({
      success: false,
      error: 'username and apexClassName are required',
    });
  }

  await salesforceService.authenticateWithSfdx(username);

  const result = await salesforceService.executeBatchJob(apexClassName, batchSize);

  res.json({
    success: true,
    ...result,
  });
}));

/**
 * @swagger
 * /api/vlocity/pricing/batch/status:
 *   get:
 *     summary: Get Running Batch Jobs
 *     tags: [Vlocity Pricing]
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *       - in: query
 *         name: apexClassName
 *     responses:
 *       200:
 *         description: List of running batch jobs
 */
router.get('/batch/status', asyncHandler(async (req, res) => {
  const { username, apexClassName } = req.query;

  if (!username) {
    return res.status(400).json({
      success: false,
      error: 'Username parameter is required',
    });
  }

  await salesforceService.authenticateWithSfdx(username);

  const jobs = await salesforceService.getRunningBatchJobs(apexClassName);

  res.json({
    success: true,
    data: jobs,
    count: jobs.length,
  });
}));

/**
 * @swagger
 * /api/vlocity/pricing/rate-codes:
 *   get:
 *     summary: Get Rate Codes
 *     tags: [Vlocity Pricing]
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: country
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of rate codes
 */
router.get('/rate-codes', asyncHandler(async (req, res) => {
  const { username, country, name, orgCode, vatCode, code, type, category } = req.query;
  if (!username) {
    return res.status(400).json({ success: false, error: 'Username parameter is required' });
  }
  await salesforceService.authenticateWithSfdx(username);
  
  let soql = `SELECT Id, Name, GT_OrgCode__c, GT_VATCode__c, GT_VATDescription__c, GT_VATRate__c, GT_StartDate__c, GT_EndDate__c, GT_GlobalKey__c FROM GT_RateCode__c`;
  
  const conditions = [];
  if (country) {
    conditions.push(`GT_OrgCode__c LIKE '%${country}%'`);
  }
  if (name) {
    conditions.push(`Name LIKE '%${name}%'`);
  }
  if (orgCode) {
    conditions.push(`GT_OrgCode__c LIKE '%${orgCode}%'`);
  }
  if (vatCode) {
    conditions.push(`GT_VATCode__c LIKE '%${vatCode}%'`);
  }
  
  if (conditions.length > 0) {
    soql += ' WHERE ' + conditions.join(' AND ');
  }
  
  const result = await salesforceService.query(soql);
  
  // Transform to match UI expectations
  const transformedRecords = (result.records || []).map(record => {
    // Check if active based on dates
    const isActive = record.GT_StartDate__c && (
      new Date(record.GT_StartDate__c) <= new Date() && 
      (!record.GT_EndDate__c || new Date(record.GT_EndDate__c) >= new Date())
    );
    
    return {
      id: record.Id,
      name: record.Name,
      code: record.GT_VATCode__c || '',
      type: record.GT_VATDescription__c || '',
      category: record.GT_OrgCode__c || '',
      isActive: isActive
    };
  });
  
  res.json({
    success: true,
    data: transformedRecords,
    count: transformedRecords.length,
  });
}));

/**
 * @swagger
 * /api/vlocity/pricing/rate-tables:
 *   get:
 *     summary: Get Rate Tables
 *     tags: [Vlocity Pricing]
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: country
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of rate tables
 */
router.get('/rate-tables', asyncHandler(async (req, res) => {
  const { username, country, name, orgCode, productName, code, type } = req.query;
  if (!username) {
    return res.status(400).json({ success: false, error: 'Username parameter is required' });
  }
  await salesforceService.authenticateWithSfdx(username);
  
  let soql = `SELECT Id, Name, GT_OrgCode__c, Product__c, Product__r.Name, GT_ProductName_Text__c, GT_RateCode__c, GT_RateDescription__c, GT_StartDate__c, GT_EndDate__c, GT_VATType__c, GT_UniqueKey__c, GT_GlobalKey__c FROM GT_RateTable__c`;
  
  const conditions = [];
  if (country) {
    conditions.push(`GT_OrgCode__c LIKE '%${country}%'`);
  }
  if (name) {
    conditions.push(`Name LIKE '%${name}%'`);
  }
  if (orgCode) {
    conditions.push(`GT_OrgCode__c LIKE '%${orgCode}%'`);
  }
  if (productName) {
    conditions.push(`(GT_ProductName_Text__c LIKE '%${productName}%' OR Product__r.Name LIKE '%${productName}%')`);
  }
  
  if (conditions.length > 0) {
    soql += ' WHERE ' + conditions.join(' AND ');
  }
  
  const result = await salesforceService.query(soql);
  
  // Transform to match UI expectations
  const transformedRecords = (result.records || []).map(record => {
    // Check if active based on dates
    const isActive = record.GT_StartDate__c && (
      new Date(record.GT_StartDate__c) <= new Date() && 
      (!record.GT_EndDate__c || new Date(record.GT_EndDate__c) >= new Date())
    );
    
    return {
      id: record.Id,
      name: record.Name,
      code: record.GT_RateCode__c || '',
      type: record.GT_VATType__c || '',
      productName: record.GT_ProductName_Text__c || (record.Product__r && record.Product__r.Name) || '',
      isActive: isActive
    };
  });
  
  res.json({
    success: true,
    data: transformedRecords,
    count: transformedRecords.length,
  });
}));

module.exports = router;

