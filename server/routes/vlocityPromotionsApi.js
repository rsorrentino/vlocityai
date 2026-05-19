const express = require('express');
const router = express.Router();
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const vlocityPromotionsService = require('../services/vlocityPromotionsService');

/**
 * @swagger
 * /api/vlocity/promotions:
 *   get:
 *     operationId: listPromotions
 *     summary: Get all promotions
 *     description: Retrieves all Vlocity promotions from the connected Salesforce org with optional filtering by country, region, currency, status, product family, and category.
 *     tags:
 *       - Promotions API
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
 *         name: country
 *         schema:
 *           type: string
 *         description: Filter by country code
 *       - in: query
 *         name: region
 *         schema:
 *           type: string
 *         description: Filter by region
 *       - in: query
 *         name: currency
 *         schema:
 *           type: string
 *         description: Filter by currency code
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by promotion status (e.g. Active, Inactive)
 *       - in: query
 *         name: productFamily
 *         schema:
 *           type: string
 *         description: Filter by product family
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by promotion category
 *     responses:
 *       200:
 *         description: Promotions retrieved successfully
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
router.get('/', asyncHandler(async (req, res) => {
  const { username, isSandbox = false, country, region, currency, status, productFamily, category } = req.query;

  if (!username) {
    throw new ValidationError('Username is required');
  }

  const filters = {};
  if (country) filters.country = country;
  if (region) filters.region = region;
  if (currency) filters.currency = currency;
  if (status) filters.status = status;
  if (productFamily) filters.productFamily = productFamily;
  if (category) filters.category = category;

  const promotions = await vlocityPromotionsService.getAllPromotionsFromSalesforce(username, isSandbox === 'true', filters);

  res.json({
    success: true,
    message: 'Promotions retrieved successfully',
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
 * /api/vlocity/promotions/stats:
 *   get:
 *     operationId: getPromotionStats
 *     summary: Get promotion statistics
 *     description: Returns aggregate statistics about promotions in the connected Salesforce org. This route must be declared before /{promotionId} to avoid path conflict.
 *     tags:
 *       - Promotions API
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
 *         description: Promotion statistics retrieved successfully
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
 *                   description: Aggregate promotion statistics
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

  const stats = await vlocityPromotionsService.getPromotionStats(username, isSandbox === 'true');

  res.json({
    success: true,
    message: 'Promotion statistics retrieved successfully',
    data: stats,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/promotions/service-stats:
 *   get:
 *     operationId: getPromotionsServiceStats
 *     summary: Get promotions service statistics
 *     description: Returns internal service statistics such as cache hit rates and request counts for the promotions service (no Salesforce connection required).
 *     tags:
 *       - Promotions API
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
  const stats = vlocityPromotionsService.getServiceStats();

  res.json({
    success: true,
    data: stats,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/promotions/product/{productId}/active:
 *   get:
 *     operationId: getActivePromotionsForProduct
 *     summary: Get active promotions for a product
 *     description: Retrieves all currently active Vlocity promotions applicable to the specified product.
 *     tags:
 *       - Promotions API
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
 *     responses:
 *       200:
 *         description: Active promotions retrieved successfully
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
 *                     promotions:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Promotion'
 *                     totalPromotions:
 *                       type: integer
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
router.get('/product/:productId/active', asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const { username, isSandbox = false } = req.query;

  if (!productId) {
    throw new ValidationError('Product ID is required');
  }

  if (!username) {
    throw new ValidationError('Username is required');
  }

  const promotions = await vlocityPromotionsService.getActivePromotionsForProduct(productId, username, isSandbox === 'true');

  res.json({
    success: true,
    message: 'Active promotions retrieved successfully',
    data: {
      productId,
      promotions,
      totalPromotions: promotions.length
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/promotions/calculate-discount:
 *   post:
 *     operationId: calculatePromotionDiscount
 *     summary: Calculate promotion discount
 *     description: Computes the discount amount and final price for a given promotion, product price, and quantity.
 *     tags:
 *       - Promotions API
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - promotion
 *               - productPrice
 *             properties:
 *               promotion:
 *                 $ref: '#/components/schemas/Promotion'
 *                 description: Promotion object to apply
 *               productPrice:
 *                 type: number
 *                 minimum: 0
 *                 description: Original unit price of the product
 *               quantity:
 *                 type: number
 *                 minimum: 1
 *                 default: 1
 *                 description: Number of units being purchased
 *     responses:
 *       200:
 *         description: Discount calculated successfully
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
 *                     originalPrice:
 *                       type: number
 *                     quantity:
 *                       type: number
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error — missing or invalid fields
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
router.post('/calculate-discount', asyncHandler(async (req, res) => {
  const { promotion, productPrice, quantity = 1 } = req.body;

  if (!promotion) {
    throw new ValidationError('Promotion data is required');
  }

  if (productPrice === undefined || productPrice === null) {
    throw new ValidationError('Product price is required');
  }

  if (typeof productPrice !== 'number' || productPrice < 0) {
    throw new ValidationError('Product price must be a non-negative number');
  }

  if (typeof quantity !== 'number' || quantity < 1) {
    throw new ValidationError('Quantity must be a positive number');
  }

  const discountResult = vlocityPromotionsService.calculatePromotionDiscount(promotion, productPrice, quantity);

  res.json({
    success: true,
    message: 'Discount calculated successfully',
    data: {
      originalPrice: productPrice,
      quantity,
      ...discountResult
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/promotions/export:
 *   post:
 *     operationId: exportPromotions
 *     summary: Export promotions to a file
 *     description: Exports Vlocity promotions matching the provided filters to a local file in JSON or CSV format.
 *     tags:
 *       - Promotions API
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *             properties:
 *               username:
 *                 type: string
 *                 description: Salesforce org username
 *               isSandbox:
 *                 type: boolean
 *                 default: false
 *                 description: Whether the org is a sandbox
 *               filters:
 *                 type: object
 *                 default: {}
 *                 description: Optional filters to narrow exported promotions
 *               exportFormat:
 *                 type: string
 *                 enum:
 *                   - json
 *                   - csv
 *                 default: json
 *                 description: Output file format
 *     responses:
 *       200:
 *         description: Promotions exported successfully
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
 *                     filePath:
 *                       type: string
 *                     exportFormat:
 *                       type: string
 *                     filters:
 *                       type: object
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error — missing username or invalid export format
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
router.post('/export', asyncHandler(async (req, res) => {
  const { username, isSandbox = false, filters = {}, exportFormat = 'json' } = req.body;

  if (!username) {
    throw new ValidationError('Username is required');
  }

  if (!['json', 'csv'].includes(exportFormat)) {
    throw new ValidationError('Export format must be json or csv');
  }

  const filePath = await vlocityPromotionsService.exportPromotions(username, isSandbox, filters, exportFormat);

  res.json({
    success: true,
    message: 'Promotions exported successfully',
    data: {
      filePath,
      exportFormat,
      filters
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/promotions/clear-cache:
 *   post:
 *     operationId: clearPromotionsCache
 *     summary: Clear the promotions cache
 *     description: Flushes the in-memory cache maintained by the promotions service, forcing subsequent requests to re-fetch data from Salesforce.
 *     tags:
 *       - Promotions API
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Promotions cache cleared successfully
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
 *                   example: Promotions cache cleared successfully
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
  vlocityPromotionsService.clearCache();

  res.json({
    success: true,
    message: 'Promotions cache cleared successfully',
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/promotions:
 *   post:
 *     operationId: createPromotion
 *     summary: Create a new promotion
 *     description: Creates a new Vlocity promotion record in the specified Salesforce org.
 *     tags:
 *       - Promotions API
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - promotionData
 *               - username
 *             properties:
 *               promotionData:
 *                 $ref: '#/components/schemas/Promotion'
 *                 description: Promotion fields to create; name is required
 *               username:
 *                 type: string
 *                 description: Salesforce org username
 *               isSandbox:
 *                 type: boolean
 *                 default: false
 *                 description: Whether the org is a sandbox
 *     responses:
 *       200:
 *         description: Promotion created successfully
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
 *                     promotionId:
 *                       type: string
 *                     promotionName:
 *                       type: string
 *                     result:
 *                       type: object
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error — missing required fields
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
router.post('/', asyncHandler(async (req, res) => {
  const { promotionData, username, isSandbox = false } = req.body;

  if (!promotionData) {
    throw new ValidationError('Promotion data is required');
  }

  if (!username) {
    throw new ValidationError('Username is required');
  }

  if (!promotionData.name) {
    throw new ValidationError('Promotion name is required');
  }

  const result = await vlocityPromotionsService.createPromotionInSalesforce(promotionData, username, isSandbox);

  res.json({
    success: true,
    message: 'Promotion created successfully',
    data: {
      promotionId: result.id,
      promotionName: promotionData.name,
      result
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/promotions/{promotionId}:
 *   get:
 *     operationId: getPromotion
 *     summary: Get a specific promotion
 *     description: Retrieves a single Vlocity promotion by its Salesforce record ID.
 *     tags:
 *       - Promotions API
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: promotionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce record ID of the promotion
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
 *         description: Promotion retrieved successfully
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
 *                     promotionId:
 *                       type: string
 *                     promotion:
 *                       $ref: '#/components/schemas/Promotion'
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error — missing promotionId or username
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
 *         description: Promotion not found
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
router.get('/:promotionId', asyncHandler(async (req, res) => {
  const { promotionId } = req.params;
  const { username, isSandbox = false } = req.query;

  if (!promotionId) {
    throw new ValidationError('Promotion ID is required');
  }

  if (!username) {
    throw new ValidationError('Username is required');
  }

  const promotion = await vlocityPromotionsService.getPromotionFromSalesforce(promotionId, username, isSandbox === 'true');

  res.json({
    success: true,
    message: 'Promotion retrieved successfully',
    data: {
      promotionId,
      promotion
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/promotions/{promotionId}:
 *   put:
 *     operationId: updatePromotion
 *     summary: Update a promotion
 *     description: Updates an existing Vlocity promotion record in the specified Salesforce org.
 *     tags:
 *       - Promotions API
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: promotionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce record ID of the promotion to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - promotionData
 *               - username
 *             properties:
 *               promotionData:
 *                 $ref: '#/components/schemas/Promotion'
 *                 description: Promotion fields to update
 *               username:
 *                 type: string
 *                 description: Salesforce org username
 *               isSandbox:
 *                 type: boolean
 *                 default: false
 *                 description: Whether the org is a sandbox
 *     responses:
 *       200:
 *         description: Promotion updated successfully
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
 *                     promotionId:
 *                       type: string
 *                     result:
 *                       type: object
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error — missing required fields
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
 *         description: Promotion not found
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
router.put('/:promotionId', asyncHandler(async (req, res) => {
  const { promotionId } = req.params;
  const { promotionData, username, isSandbox = false } = req.body;

  if (!promotionId) {
    throw new ValidationError('Promotion ID is required');
  }

  if (!promotionData) {
    throw new ValidationError('Promotion data is required');
  }

  if (!username) {
    throw new ValidationError('Username is required');
  }

  const result = await vlocityPromotionsService.updatePromotionInSalesforce(promotionId, promotionData, username, isSandbox);

  res.json({
    success: true,
    message: 'Promotion updated successfully',
    data: {
      promotionId,
      result
    },
    timestamp: new Date().toISOString(),
  });
}));

module.exports = router;
