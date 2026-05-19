const express = require('express');
const router = express.Router();
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const vlocityPricingService = require('../services/vlocityPricingService');

/**
 * @swagger
 * /api/vlocity/pricing/price-lists:
 *   get:
 *     operationId: listPriceLists
 *     summary: Get all price lists
 *     description: Retrieves a paginated list of Vlocity price lists from the connected Salesforce org, with optional filtering by country, region, currency, and status.
 *     tags:
 *       - Pricing API
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
 *         description: Filter by status (e.g. Active, Inactive)
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 25
 *         description: Number of records per page
 *     responses:
 *       200:
 *         description: Price lists retrieved successfully
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
 *                   example: Price lists retrieved successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     priceLists:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/PriceList'
 *                     totalPriceLists:
 *                       type: integer
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *                     hasMore:
 *                       type: boolean
 *                     filters:
 *                       type: object
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error — username missing or invalid parameter
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
  const { username, isSandbox = false, country, region, currency, status, page, limit } = req.query;

  if (!username) {
    throw new ValidationError('Username is required');
  }

  const filters = {};
  if (country) filters.country = country;
  if (region) filters.region = region;
  if (currency) filters.currency = currency;
  if (status) filters.status = status;

  const pagination = {
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 25
  };

  const result = await vlocityPricingService.getAllPriceListsFromSalesforce(username, isSandbox === 'true', filters, pagination);

  res.json({
    success: true,
    message: 'Price lists retrieved successfully',
    data: {
      priceLists: result.priceLists,
      totalPriceLists: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      hasMore: result.hasMore,
      filters
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/pricing/price-lists/{priceListId}:
 *   get:
 *     operationId: getPriceList
 *     summary: Get a specific price list
 *     description: Retrieves a single Vlocity price list by its Salesforce record ID.
 *     tags:
 *       - Pricing API
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
 *         description: Price list retrieved successfully
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

  const priceList = await vlocityPricingService.getPriceListFromSalesforce(priceListId, username, isSandbox === 'true');

  res.json({
    success: true,
    message: 'Price list retrieved successfully',
    data: {
      priceListId,
      priceList
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/pricing/price-lists:
 *   post:
 *     operationId: createPriceList
 *     summary: Create a new price list
 *     description: Creates a new Vlocity price list record in the specified Salesforce org.
 *     tags:
 *       - Pricing API
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - priceListData
 *               - username
 *             properties:
 *               priceListData:
 *                 $ref: '#/components/schemas/PriceList'
 *                 description: Price list fields to create; name is required
 *               username:
 *                 type: string
 *                 description: Salesforce org username
 *               isSandbox:
 *                 type: boolean
 *                 default: false
 *                 description: Whether the org is a sandbox
 *     responses:
 *       200:
 *         description: Price list created successfully
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
 *                     priceListName:
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
router.post('/price-lists', asyncHandler(async (req, res) => {
  const { priceListData, username, isSandbox = false } = req.body;

  if (!priceListData) {
    throw new ValidationError('Price list data is required');
  }

  if (!username) {
    throw new ValidationError('Username is required');
  }

  if (!priceListData.name) {
    throw new ValidationError('Price list name is required');
  }

  const result = await vlocityPricingService.createPriceListInSalesforce(priceListData, username, isSandbox);

  res.json({
    success: true,
    message: 'Price list created successfully',
    data: {
      priceListId: result.id,
      priceListName: priceListData.name,
      result
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/pricing/price-lists/{priceListId}:
 *   put:
 *     operationId: updatePriceList
 *     summary: Update a price list
 *     description: Updates an existing Vlocity price list record in the specified Salesforce org.
 *     tags:
 *       - Pricing API
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: priceListId
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce record ID of the price list to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - priceListData
 *               - username
 *             properties:
 *               priceListData:
 *                 $ref: '#/components/schemas/PriceList'
 *                 description: Price list fields to update
 *               username:
 *                 type: string
 *                 description: Salesforce org username
 *               isSandbox:
 *                 type: boolean
 *                 default: false
 *                 description: Whether the org is a sandbox
 *     responses:
 *       200:
 *         description: Price list updated successfully
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
router.put('/price-lists/:priceListId', asyncHandler(async (req, res) => {
  const { priceListId } = req.params;
  const { priceListData, username, isSandbox = false } = req.body;

  if (!priceListId) {
    throw new ValidationError('Price list ID is required');
  }

  if (!priceListData) {
    throw new ValidationError('Price list data is required');
  }

  if (!username) {
    throw new ValidationError('Username is required');
  }

  const result = await vlocityPricingService.updatePriceListInSalesforce(priceListId, priceListData, username, isSandbox);

  res.json({
    success: true,
    message: 'Price list updated successfully',
    data: {
      priceListId,
      result
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/pricing/price-lists/{priceListId}/products:
 *   get:
 *     operationId: getPriceListProducts
 *     summary: Get products for a price list
 *     description: Retrieves all products associated with the specified Vlocity price list.
 *     tags:
 *       - Pricing API
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
 *         description: Products retrieved successfully
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
 *                     products:
 *                       type: array
 *                       items:
 *                         type: object
 *                     totalProducts:
 *                       type: integer
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
router.get('/price-lists/:priceListId/products', asyncHandler(async (req, res) => {
  const { priceListId } = req.params;
  const { username, isSandbox = false } = req.query;

  if (!priceListId) {
    throw new ValidationError('Price list ID is required');
  }

  if (!username) {
    throw new ValidationError('Username is required');
  }

  const products = await vlocityPricingService.getProductsForPriceList(priceListId, username, isSandbox === 'true');

  res.json({
    success: true,
    message: 'Products retrieved successfully',
    data: {
      priceListId,
      products,
      totalProducts: products.length
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/pricing/price-lists/{priceListId}/entries:
 *   post:
 *     operationId: addPriceListEntry
 *     summary: Add an entry to a price list
 *     description: Creates a new price list entry (PriceListEntry) linking a product and its unit price to the specified price list.
 *     tags:
 *       - Pricing API
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: priceListId
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce record ID of the price list
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - entryData
 *               - username
 *             properties:
 *               entryData:
 *                 type: object
 *                 required:
 *                   - productId
 *                   - unitPrice
 *                 properties:
 *                   productId:
 *                     type: string
 *                     description: Salesforce Product2 ID
 *                   unitPrice:
 *                     type: number
 *                     description: Unit price for this product in the price list
 *               username:
 *                 type: string
 *                 description: Salesforce org username
 *               isSandbox:
 *                 type: boolean
 *                 default: false
 *                 description: Whether the org is a sandbox
 *     responses:
 *       200:
 *         description: Price list entry added successfully
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
 *                     entryId:
 *                       type: string
 *                     result:
 *                       type: object
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error — missing required entry fields
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
router.post('/price-lists/:priceListId/entries', asyncHandler(async (req, res) => {
  const { priceListId } = req.params;
  const { entryData, username, isSandbox = false } = req.body;

  if (!priceListId) {
    throw new ValidationError('Price list ID is required');
  }

  if (!entryData) {
    throw new ValidationError('Entry data is required');
  }

  if (!username) {
    throw new ValidationError('Username is required');
  }

  if (!entryData.productId) {
    throw new ValidationError('Product ID is required');
  }

  if (entryData.unitPrice === undefined) {
    throw new ValidationError('Unit price is required');
  }

  const result = await vlocityPricingService.addPriceListEntry(priceListId, entryData, username, isSandbox);

  res.json({
    success: true,
    message: 'Price list entry added successfully',
    data: {
      priceListId,
      entryId: result.id,
      result
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/pricing/entries/{entryId}:
 *   put:
 *     operationId: updatePriceListEntry
 *     summary: Update a price list entry
 *     description: Updates an existing Vlocity price list entry record by its Salesforce ID.
 *     tags:
 *       - Pricing API
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce record ID of the price list entry
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - entryData
 *               - username
 *             properties:
 *               entryData:
 *                 type: object
 *                 description: Fields to update on the price list entry
 *               username:
 *                 type: string
 *                 description: Salesforce org username
 *               isSandbox:
 *                 type: boolean
 *                 default: false
 *                 description: Whether the org is a sandbox
 *     responses:
 *       200:
 *         description: Price list entry updated successfully
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
 *                     entryId:
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
 *         description: Entry not found
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
router.put('/entries/:entryId', asyncHandler(async (req, res) => {
  const { entryId } = req.params;
  const { entryData, username, isSandbox = false } = req.body;

  if (!entryId) {
    throw new ValidationError('Entry ID is required');
  }

  if (!entryData) {
    throw new ValidationError('Entry data is required');
  }

  if (!username) {
    throw new ValidationError('Username is required');
  }

  const result = await vlocityPricingService.updatePriceListEntry(entryId, entryData, username, isSandbox);

  res.json({
    success: true,
    message: 'Price list entry updated successfully',
    data: {
      entryId,
      result
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/pricing/entries/{entryId}:
 *   delete:
 *     operationId: deletePriceListEntry
 *     summary: Delete a price list entry
 *     description: Deletes a Vlocity price list entry record from the specified Salesforce org.
 *     tags:
 *       - Pricing API
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce record ID of the price list entry to delete
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
 *         description: Price list entry deleted successfully
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
 *                     entryId:
 *                       type: string
 *                     result:
 *                       type: object
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error — missing entryId or username
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
 *         description: Entry not found
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
router.delete('/entries/:entryId', asyncHandler(async (req, res) => {
  const { entryId } = req.params;
  const { username, isSandbox = false } = req.query;

  if (!entryId) {
    throw new ValidationError('Entry ID is required');
  }

  if (!username) {
    throw new ValidationError('Username is required');
  }

  const result = await vlocityPricingService.deletePriceListEntry(entryId, username, isSandbox === 'true');

  res.json({
    success: true,
    message: 'Price list entry deleted successfully',
    data: {
      entryId,
      result
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/pricing/price-lists/{priceListId}/export:
 *   post:
 *     operationId: exportPriceList
 *     summary: Export a price list to file
 *     description: Exports a Vlocity price list and its entries to a local file in JSON or CSV format.
 *     tags:
 *       - Pricing API
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: priceListId
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce record ID of the price list to export
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
 *               exportFormat:
 *                 type: string
 *                 enum:
 *                   - json
 *                   - csv
 *                 default: json
 *                 description: Output file format
 *     responses:
 *       200:
 *         description: Price list exported successfully
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
 *                     filePath:
 *                       type: string
 *                     exportFormat:
 *                       type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error — missing fields or invalid export format
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
router.post('/price-lists/:priceListId/export', asyncHandler(async (req, res) => {
  const { priceListId } = req.params;
  const { username, isSandbox = false, exportFormat = 'json' } = req.body;

  if (!priceListId) {
    throw new ValidationError('Price list ID is required');
  }

  if (!username) {
    throw new ValidationError('Username is required');
  }

  if (!['json', 'csv'].includes(exportFormat)) {
    throw new ValidationError('Export format must be json or csv');
  }

  const filePath = await vlocityPricingService.exportPriceList(priceListId, username, isSandbox, exportFormat);

  res.json({
    success: true,
    message: 'Price list exported successfully',
    data: {
      priceListId,
      filePath,
      exportFormat
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/pricing/import:
 *   post:
 *     operationId: importPriceList
 *     summary: Import a price list from a file
 *     description: Imports a price list (and its entries) from a local file path into the specified Salesforce org.
 *     tags:
 *       - Pricing API
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - filePath
 *               - username
 *             properties:
 *               filePath:
 *                 type: string
 *                 description: Absolute path to the import file (JSON or CSV)
 *               username:
 *                 type: string
 *                 description: Salesforce org username
 *               isSandbox:
 *                 type: boolean
 *                 default: false
 *                 description: Whether the org is a sandbox
 *     responses:
 *       200:
 *         description: Price list imported successfully
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
 *                     addedProducts:
 *                       type: integer
 *                     totalProducts:
 *                       type: integer
 *                     filePath:
 *                       type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation error — missing filePath or username
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
router.post('/import', asyncHandler(async (req, res) => {
  const { filePath, username, isSandbox = false } = req.body;

  if (!filePath) {
    throw new ValidationError('File path is required');
  }

  if (!username) {
    throw new ValidationError('Username is required');
  }

  const result = await vlocityPricingService.importPriceList(filePath, username, isSandbox);

  res.json({
    success: true,
    message: 'Price list imported successfully',
    data: {
      priceListId: result.priceListId,
      addedProducts: result.addedProducts,
      totalProducts: result.totalProducts,
      filePath
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/pricing/stats:
 *   get:
 *     operationId: getPricingStats
 *     summary: Get pricing statistics
 *     description: Returns aggregate statistics about price lists and pricing data in the connected Salesforce org.
 *     tags:
 *       - Pricing API
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
 *         description: Pricing statistics retrieved successfully
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
 *                   description: Aggregate pricing statistics
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

  const stats = await vlocityPricingService.getPricingStats(username, isSandbox === 'true');

  res.json({
    success: true,
    message: 'Pricing statistics retrieved successfully',
    data: stats,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/pricing/service-stats:
 *   get:
 *     operationId: getPricingServiceStats
 *     summary: Get pricing service statistics
 *     description: Returns internal service statistics such as cache hit rates and request counts for the pricing service (no Salesforce connection required).
 *     tags:
 *       - Pricing API
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
  const stats = vlocityPricingService.getServiceStats();

  res.json({
    success: true,
    data: stats,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @swagger
 * /api/vlocity/pricing/clear-cache:
 *   post:
 *     operationId: clearPricingCache
 *     summary: Clear the pricing cache
 *     description: Flushes the in-memory cache maintained by the pricing service, forcing subsequent requests to re-fetch data from Salesforce.
 *     tags:
 *       - Pricing API
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pricing cache cleared successfully
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
 *                   example: Pricing cache cleared successfully
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
  vlocityPricingService.clearCache();

  res.json({
    success: true,
    message: 'Pricing cache cleared successfully',
    timestamp: new Date().toISOString(),
  });
}));

module.exports = router;
