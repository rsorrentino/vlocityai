const express = require('express');
const router = express.Router();
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const enhancedVlocityPricingService = require('../services/enhancedVlocityPricingService');

/**
 * @swagger
 * /api/vlocity/enhanced-pricing/price-lists:
 *   get:
 *     operationId: listEnhancedPriceLists
 *     summary: Get all Vlocity price lists with enhanced filtering
 *     description: Retrieves Vlocity price lists from Salesforce with richer filter options than the standard pricing API, including countryCode, organizationCode, currencyCode, priceListType, primary flag, and code.
 *     tags:
 *       - Enhanced Pricing
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce org username (SFDX alias or full username)
 *       - in: query
 *         name: isSandbox
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Whether the org is a sandbox
 *       - in: query
 *         name: countryCode
 *         schema:
 *           type: string
 *         description: Filter by two-letter country code
 *       - in: query
 *         name: organizationCode
 *         schema:
 *           type: string
 *         description: Filter by organization code
 *       - in: query
 *         name: currencyCode
 *         schema:
 *           type: string
 *         description: Filter by ISO currency code
 *       - in: query
 *         name: priceListType
 *         schema:
 *           type: string
 *         description: Filter by price list type (see /price-list-types for valid values)
 *       - in: query
 *         name: isPrimary
 *         schema:
 *           type: boolean
 *         description: Filter to only primary price lists
 *       - in: query
 *         name: code
 *         schema:
 *           type: string
 *         description: Filter by price list code
 *     responses:
 *       200:
 *         description: Vlocity price lists retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     priceLists:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/PriceList'
 *                     totalPriceLists:
 *                       type: integer
 *                     filters:
 *                       type: object
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error — missing username
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/price-lists', asyncHandler(async (req, res) => {
  const {
    username,
    isSandbox = false,
    countryCode,
    organizationCode,
    currencyCode,
    priceListType,
    isPrimary,
    code
  } = req.query;

  if (!username) {
    throw new ValidationError('Username is required');
  }

  const filters = {};
  if (countryCode) filters.country = countryCode;
  if (organizationCode) filters.organizationCode = organizationCode;
  if (currencyCode) filters.currency = currencyCode;
  if (priceListType) filters.priceListType = priceListType;
  if (isPrimary !== undefined) filters.isPrimary = isPrimary === 'true';
  if (code) filters.code = code;

  const priceLists = await enhancedVlocityPricingService.getAllVlocityPriceListsFromSalesforce(
    username,
    isSandbox === 'true',
    filters
  );

  res.json({
    success: true,
    message: 'Vlocity price lists retrieved successfully',
    data: {
      priceLists,
      totalPriceLists: priceLists.length,
      filters
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/enhanced-pricing/price-lists/{priceListId}:
 *   get:
 *     operationId: getEnhancedPriceList
 *     summary: Get a specific Vlocity price list with entries
 *     description: Retrieves a single Vlocity price list by its Salesforce record ID, including its associated price list entries.
 *     tags:
 *       - Enhanced Pricing
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: priceListId
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce record ID of the price list
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce org username
 *       - in: query
 *         name: isSandbox
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Whether the org is a sandbox
 *     responses:
 *       200:
 *         description: Vlocity price list retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     priceListId:
 *                       type: string
 *                     priceList:
 *                       $ref: '#/components/schemas/PriceList'
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error — missing priceListId or username
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Price list not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/price-lists/:priceListId', asyncHandler(async (req, res) => {
  const { priceListId } = req.params;
  const { username, isSandbox = false } = req.query;

  if (!priceListId) {
    throw new ValidationError('Price list ID is required');
  }

  if (!username) {
    throw new ValidationError('Username is required');
  }

  const priceList = await enhancedVlocityPricingService.getVlocityPriceListFromSalesforce(
    priceListId,
    username,
    isSandbox === 'true'
  );

  res.json({
    success: true,
    message: 'Vlocity price list retrieved successfully',
    data: {
      priceListId,
      priceList
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/enhanced-pricing/rate-codes:
 *   get:
 *     operationId: getRateCodes
 *     summary: Get rate codes with filtering
 *     description: Retrieves Vlocity rate code records from Salesforce, optionally filtered by organization code, VAT code, and effective date range.
 *     tags:
 *       - Enhanced Pricing
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce org username
 *       - in: query
 *         name: isSandbox
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Whether the org is a sandbox
 *       - in: query
 *         name: orgCode
 *         schema:
 *           type: string
 *         description: Filter by organization code
 *       - in: query
 *         name: vatCode
 *         schema:
 *           type: string
 *         description: Filter by VAT code
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by effective start date (ISO 8601)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by effective end date (ISO 8601)
 *     responses:
 *       200:
 *         description: Rate codes retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     rateCodes:
 *                       type: array
 *                       items:
 *                         type: object
 *                     totalRateCodes:
 *                       type: integer
 *                     filters:
 *                       type: object
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error — missing username
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/rate-codes', asyncHandler(async (req, res) => {
  const {
    username,
    isSandbox = false,
    orgCode,
    vatCode,
    startDate,
    endDate
  } = req.query;

  if (!username) {
    throw new ValidationError('Username is required');
  }

  const filters = {};
  if (orgCode) filters.orgCode = orgCode;
  if (vatCode) filters.vatCode = vatCode;
  if (startDate) filters.startDate = startDate;
  if (endDate) filters.endDate = endDate;

  const rateCodes = await enhancedVlocityPricingService.getRateCodesFromSalesforce(
    username,
    isSandbox === 'true',
    filters
  );

  res.json({
    success: true,
    message: 'Rate codes retrieved successfully',
    data: {
      rateCodes,
      totalRateCodes: rateCodes.length,
      filters
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/enhanced-pricing/rate-tables:
 *   get:
 *     operationId: getRateTables
 *     summary: Get rate tables with filtering
 *     description: Retrieves Vlocity rate table records from Salesforce, optionally filtered by organization code, product ID, rate code, and effective date range.
 *     tags:
 *       - Enhanced Pricing
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce org username
 *       - in: query
 *         name: isSandbox
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Whether the org is a sandbox
 *       - in: query
 *         name: orgCode
 *         schema:
 *           type: string
 *         description: Filter by organization code
 *       - in: query
 *         name: productId
 *         schema:
 *           type: string
 *         description: Filter by Salesforce Product2 ID
 *       - in: query
 *         name: rateCode
 *         schema:
 *           type: string
 *         description: Filter by rate code
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by effective start date (ISO 8601)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by effective end date (ISO 8601)
 *     responses:
 *       200:
 *         description: Rate tables retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     rateTables:
 *                       type: array
 *                       items:
 *                         type: object
 *                     totalRateTables:
 *                       type: integer
 *                     filters:
 *                       type: object
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error — missing username
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/rate-tables', asyncHandler(async (req, res) => {
  const {
    username,
    isSandbox = false,
    orgCode,
    productId,
    rateCode,
    startDate,
    endDate
  } = req.query;

  if (!username) {
    throw new ValidationError('Username is required');
  }

  const filters = {};
  if (orgCode) filters.orgCode = orgCode;
  if (productId) filters.productId = productId;
  if (rateCode) filters.rateCode = rateCode;
  if (startDate) filters.startDate = startDate;
  if (endDate) filters.endDate = endDate;

  const rateTables = await enhancedVlocityPricingService.getRateTablesFromSalesforce(
    username,
    isSandbox === 'true',
    filters
  );

  res.json({
    success: true,
    message: 'Rate tables retrieved successfully',
    data: {
      rateTables,
      totalRateTables: rateTables.length,
      filters
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/enhanced-pricing/promotions:
 *   get:
 *     operationId: getEnhancedPromotions
 *     summary: Get Vlocity promotions with enhanced filtering
 *     description: Retrieves Vlocity promotion records from Salesforce using the enhanced pricing service, with filtering by promotion type, associated price list, trigger, and code.
 *     tags:
 *       - Enhanced Pricing
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce org username
 *       - in: query
 *         name: isSandbox
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Whether the org is a sandbox
 *       - in: query
 *         name: promotionType
 *         schema:
 *           type: string
 *         description: Filter by promotion type (see /promotion-types for valid values)
 *       - in: query
 *         name: priceListId
 *         schema:
 *           type: string
 *         description: Filter by associated price list Salesforce ID
 *       - in: query
 *         name: trigger
 *         schema:
 *           type: string
 *         description: Filter by promotion trigger
 *       - in: query
 *         name: code
 *         schema:
 *           type: string
 *         description: Filter by promotion code
 *     responses:
 *       200:
 *         description: Vlocity promotions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     promotions:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Promotion'
 *                     totalPromotions:
 *                       type: integer
 *                     filters:
 *                       type: object
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error — missing username
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/promotions', asyncHandler(async (req, res) => {
  const {
    username,
    isSandbox = false,
    promotionType,
    priceListId,
    trigger,
    code
  } = req.query;

  if (!username) {
    throw new ValidationError('Username is required');
  }

  const filters = {};
  if (promotionType) filters.promotionType = promotionType;
  if (priceListId) filters.priceListId = priceListId;
  if (trigger) filters.trigger = trigger;
  if (code) filters.code = code;

  const promotions = await enhancedVlocityPricingService.getVlocityPromotionsFromSalesforce(
    username,
    isSandbox === 'true',
    filters
  );

  res.json({
    success: true,
    message: 'Vlocity promotions retrieved successfully',
    data: {
      promotions,
      totalPromotions: promotions.length,
      filters
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/enhanced-pricing/products/{productId}/pricing:
 *   get:
 *     operationId: getProductPricingData
 *     summary: Get comprehensive pricing data for a product
 *     description: Fetches all pricing information for a given product including price list entries across multiple price lists, applicable rate tables, and optionally related promotions.
 *     tags:
 *       - Enhanced Pricing
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce Product2 record ID
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce org username
 *       - in: query
 *         name: isSandbox
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Whether the org is a sandbox
 *       - in: query
 *         name: orgCode
 *         schema:
 *           type: string
 *         description: Narrow results to a specific organization code
 *       - in: query
 *         name: countryCode
 *         schema:
 *           type: string
 *         description: Narrow results to a specific country code
 *       - in: query
 *         name: currencyCode
 *         schema:
 *           type: string
 *         description: Narrow results to a specific currency code
 *       - in: query
 *         name: includePromotions
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Whether to include applicable promotions in the response
 *     responses:
 *       200:
 *         description: Product pricing data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     productId:
 *                       type: string
 *                     pricingData:
 *                       type: object
 *                       description: Comprehensive pricing data including price list entries, rate tables, and promotions
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error — missing productId or username
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Product not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/products/:productId/pricing', asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const {
    username,
    isSandbox = false,
    orgCode,
    countryCode,
    currencyCode,
    includePromotions = true
  } = req.query;

  if (!productId) {
    throw new ValidationError('Product ID is required');
  }

  if (!username) {
    throw new ValidationError('Username is required');
  }

  const options = {
    orgCode,
    countryCode,
    currencyCode,
    includePromotions: includePromotions === 'true'
  };

  const pricingData = await enhancedVlocityPricingService.getProductPricingData(
    productId,
    username,
    isSandbox === 'true',
    options
  );

  res.json({
    success: true,
    message: 'Product pricing data retrieved successfully',
    data: {
      productId,
      pricingData
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/enhanced-pricing/stats:
 *   get:
 *     operationId: getEnhancedPricingStats
 *     summary: Get comprehensive pricing statistics
 *     description: Returns aggregate statistics covering price lists, rate codes, rate tables, and promotions in the connected Salesforce org.
 *     tags:
 *       - Enhanced Pricing
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce org username
 *       - in: query
 *         name: isSandbox
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Whether the org is a sandbox
 *     responses:
 *       200:
 *         description: Enhanced pricing statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   description: Aggregate statistics for all enhanced pricing objects
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error — missing username
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const { username, isSandbox = false } = req.query;

  if (!username) {
    throw new ValidationError('Username is required');
  }

  const stats = await enhancedVlocityPricingService.getEnhancedPricingStats(
    username,
    isSandbox === 'true'
  );

  res.json({
    success: true,
    message: 'Enhanced pricing statistics retrieved successfully',
    data: stats,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/enhanced-pricing/price-list-types:
 *   get:
 *     operationId: getPriceListTypes
 *     summary: Get available price list types
 *     description: Returns the static enumeration of supported Vlocity price list types. No Salesforce connection required.
 *     tags:
 *       - Enhanced Pricing
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Price list types retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     priceListTypes:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           value:
 *                             type: string
 *                           label:
 *                             type: string
 *                     totalTypes:
 *                       type: integer
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/price-list-types', asyncHandler(async (req, res) => {
  const priceListTypes = [
    { value: 'Free Market', label: 'Free Market' },
    { value: 'Social Market', label: 'Social Market' },
    { value: 'Donation', label: 'Donation' },
    { value: 'Insurance', label: 'Insurance' },
    { value: 'Paid Up', label: 'Paid Up' },
    { value: 'Repair', label: 'Repair' },
    { value: 'Social Customer', label: 'Social Customer' },
    { value: 'Implants Registration', label: 'Implants Registration' }
  ];

  res.json({
    success: true,
    message: 'Price list types retrieved successfully',
    data: {
      priceListTypes,
      totalTypes: priceListTypes.length
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/enhanced-pricing/promotion-types:
 *   get:
 *     operationId: getPromotionTypes
 *     summary: Get available promotion types
 *     description: Returns the static enumeration of supported Vlocity promotion types. No Salesforce connection required.
 *     tags:
 *       - Enhanced Pricing
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Promotion types retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     promotionTypes:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           value:
 *                             type: string
 *                           label:
 *                             type: string
 *                     totalTypes:
 *                       type: integer
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/promotion-types', asyncHandler(async (req, res) => {
  const promotionTypes = [
    { value: 'Promotional', label: 'Promotional' }
  ];

  res.json({
    success: true,
    message: 'Promotion types retrieved successfully',
    data: {
      promotionTypes,
      totalTypes: promotionTypes.length
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/enhanced-pricing/clear-cache:
 *   post:
 *     operationId: clearEnhancedPricingCache
 *     summary: Clear the enhanced pricing cache
 *     description: Flushes the in-memory cache maintained by the enhanced pricing service, forcing subsequent requests to re-fetch data from Salesforce.
 *     tags:
 *       - Enhanced Pricing
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Enhanced pricing cache cleared successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Enhanced pricing cache cleared successfully
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/clear-cache', asyncHandler(async (req, res) => {
  enhancedVlocityPricingService.clearCache();

  res.json({
    success: true,
    message: 'Enhanced pricing cache cleared successfully',
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/enhanced-pricing/service-stats:
 *   get:
 *     operationId: getEnhancedPricingServiceStats
 *     summary: Get enhanced pricing service statistics
 *     description: Returns internal service statistics such as cache hit rates and request counts for the enhanced pricing service (no Salesforce connection required).
 *     tags:
 *       - Enhanced Pricing
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Service statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   description: Internal service metrics
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/service-stats', asyncHandler(async (req, res) => {
  const stats = enhancedVlocityPricingService.getServiceStats();

  res.json({
    success: true,
    data: stats,
    timestamp: new Date().toISOString(),
  });
}));

module.exports = router;
