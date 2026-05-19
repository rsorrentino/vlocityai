const express = require('express');
const router = express.Router();
const { asyncHandler, ValidationError, NotFoundError } = require('../middleware/errorHandler');
const catalogManagerService = require('../services/catalogManagerService');
const rollbackService = require('../services/rollbackService');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// Helper — extract username and validate it is present
// ─────────────────────────────────────────────────────────────────────────────
function requireUsername(query) {
  const { username } = query;
  if (!username) throw new ValidationError('username query parameter is required');
  return username;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/catalog-manager/stats:
 *   get:
 *     operationId: getCatalogStats
 *     summary: Catalog statistics
 *     description: Returns aggregate counts for all catalog object types for a given Salesforce user
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce org username
 *     responses:
 *       200:
 *         description: Catalog statistics
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
 *       400:
 *         description: Missing username
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
  const username = requireUsername(req.query);
  const stats = await catalogManagerService.getStats(username);
  res.json({ success: true, data: stats });
}));

// ─────────────────────────────────────────────────────────────────────────────
// Products
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/catalog-manager/products:
 *   get:
 *     operationId: getProducts
 *     summary: List products
 *     description: Returns a paginated list of Product2 records from the Salesforce org
 *     tags: [Catalog Manager]
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
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated product list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                 total:
 *                   type: integer
 *       400:
 *         description: Missing username
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
router.get('/products', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  const result = await catalogManagerService.getProducts(username, req.query);
  res.json({ success: true, ...result });
}));

/**
 * @swagger
 * /api/catalog-manager/products/{id}:
 *   get:
 *     operationId: getProductById
 *     summary: Get product
 *     description: Retrieve a single Product2 record by Salesforce ID
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce Product2 ID
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Product record
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
 *       400:
 *         description: Missing username
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
router.get('/products/:id', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  const record = await catalogManagerService.getProductById(username, req.params.id);
  if (!record) throw new NotFoundError(`Product ${req.params.id} not found`);
  res.json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/products:
 *   post:
 *     operationId: createProduct
 *     summary: Create product
 *     description: Create a new Product2 record in the Salesforce org
 *     tags: [Catalog Manager]
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
 *               Name:
 *                 type: string
 *               ProductCode:
 *                 type: string
 *               IsActive:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Product created
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
 *       400:
 *         description: Validation error
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
router.post('/products', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.createProduct(username, data);
  res.status(201).json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/products/{id}:
 *   patch:
 *     operationId: updateProduct
 *     summary: Update product
 *     description: Partially update a Product2 record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce Product2 ID
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
 *     responses:
 *       200:
 *         description: Product updated
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
 *       400:
 *         description: Validation error
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
router.patch('/products/:id', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.updateProduct(username, req.params.id, data);
  res.json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/products/{id}:
 *   delete:
 *     operationId: deleteProduct
 *     summary: Delete product
 *     description: Delete a Product2 record from the Salesforce org
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce Product2 ID
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Product deleted
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
 *       400:
 *         description: Missing username
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
router.delete('/products/:id', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  await catalogManagerService.deleteProduct(username, req.params.id);
  res.json({ success: true, message: 'Product deleted' });
}));

// ─────────────────────────────────────────────────────────────────────────────
// Price Lists
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/catalog-manager/price-lists:
 *   get:
 *     operationId: getPriceLists
 *     summary: List price lists
 *     description: Returns a paginated list of vlocity_cmt__PriceList__c records
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Price list records
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PriceList'
 *       400:
 *         description: Missing username
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
  const username = requireUsername(req.query);
  const result = await catalogManagerService.getPriceLists(username, req.query);
  res.json({ success: true, ...result });
}));

/**
 * @swagger
 * /api/catalog-manager/price-lists/{id}:
 *   get:
 *     operationId: getPriceListById
 *     summary: Get price list
 *     description: Retrieve a single price list record by ID
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Price list record
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/PriceList'
 *       400:
 *         description: Missing username
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
router.get('/price-lists/:id', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  const record = await catalogManagerService.getPriceListById(username, req.params.id);
  if (!record) throw new NotFoundError(`Price list ${req.params.id} not found`);
  res.json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/price-lists:
 *   post:
 *     operationId: createPriceList
 *     summary: Create price list
 *     description: Create a new vlocity_cmt__PriceList__c record
 *     tags: [Catalog Manager]
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
 *     responses:
 *       201:
 *         description: Price list created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/PriceList'
 *       400:
 *         description: Validation error
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
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.createPriceList(username, data);
  res.status(201).json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/price-lists/{id}:
 *   patch:
 *     operationId: updatePriceList
 *     summary: Update price list
 *     description: Partially update a price list record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
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
 *     responses:
 *       200:
 *         description: Price list updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/PriceList'
 *       400:
 *         description: Validation error
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
router.patch('/price-lists/:id', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.updatePriceList(username, req.params.id, data);
  res.json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/price-lists/{id}:
 *   delete:
 *     operationId: deletePriceList
 *     summary: Delete price list
 *     description: Delete a price list record from the Salesforce org
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Price list deleted
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
 *       400:
 *         description: Missing username
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
router.delete('/price-lists/:id', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  await catalogManagerService.deletePriceList(username, req.params.id);
  res.json({ success: true, message: 'Price list deleted' });
}));

// Price List Entries
/**
 * @swagger
 * /api/catalog-manager/price-lists/{id}/entries:
 *   get:
 *     operationId: getPriceListEntries
 *     summary: List price list entries
 *     description: Returns all PriceListEntry records for a given price list
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Price list ID
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Price list entries
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Missing username
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
router.get('/price-lists/:id/entries', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  const result = await catalogManagerService.getPriceListEntries(username, req.params.id, req.query);
  res.json({ success: true, ...result });
}));

/**
 * @swagger
 * /api/catalog-manager/price-lists/{id}/entries:
 *   post:
 *     operationId: createPriceListEntry
 *     summary: Create price list entry
 *     description: Create a new PriceListEntry under a given price list
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Price list ID
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
 *     responses:
 *       201:
 *         description: Entry created
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
 *       400:
 *         description: Validation error
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
router.post('/price-lists/:id/entries', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.createPriceListEntry(username, req.params.id, data);
  res.status(201).json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/price-lists/{id}/entries/{entryId}:
 *   patch:
 *     operationId: updatePriceListEntry
 *     summary: Update price list entry
 *     description: Partially update a PriceListEntry record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Price list ID
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entry ID
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
 *     responses:
 *       200:
 *         description: Entry updated
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
 *       400:
 *         description: Validation error
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
router.patch('/price-lists/:id/entries/:entryId', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.updatePriceListEntry(username, req.params.entryId, data);
  res.json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/price-lists/{id}/entries/{entryId}:
 *   delete:
 *     operationId: deletePriceListEntry
 *     summary: Delete price list entry
 *     description: Delete a PriceListEntry record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Price list ID
 *       - in: path
 *         name: entryId
 *         required: true
 *         schema:
 *           type: string
 *         description: Entry ID
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Entry deleted
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
 *       400:
 *         description: Missing username
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
router.delete('/price-lists/:id/entries/:entryId', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  await catalogManagerService.deletePriceListEntry(username, req.params.entryId);
  res.json({ success: true, message: 'Price list entry deleted' });
}));

// Pricing Elements (nested under price lists)
/**
 * @swagger
 * /api/catalog-manager/price-lists/{id}/pricing-elements:
 *   get:
 *     operationId: getPricingElements
 *     summary: List pricing elements
 *     description: Returns all PricingElement records for a given price list
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Price list ID
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Pricing elements
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Missing username
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
router.get('/price-lists/:id/pricing-elements', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  const result = await catalogManagerService.getPricingElements(username, req.params.id);
  res.json({ success: true, ...result });
}));

/**
 * @swagger
 * /api/catalog-manager/price-lists/{id}/pricing-elements:
 *   post:
 *     operationId: createPricingElement
 *     summary: Create pricing element
 *     description: Create a new PricingElement under a given price list
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Price list ID
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
 *     responses:
 *       201:
 *         description: Pricing element created
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
 *       400:
 *         description: Validation error
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
router.post('/price-lists/:id/pricing-elements', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.createPricingElement(username, req.params.id, data);
  res.status(201).json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/price-lists/{id}/pricing-elements/{elemId}:
 *   patch:
 *     operationId: updatePricingElement
 *     summary: Update pricing element
 *     description: Partially update a PricingElement record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Price list ID
 *       - in: path
 *         name: elemId
 *         required: true
 *         schema:
 *           type: string
 *         description: Pricing element ID
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
 *     responses:
 *       200:
 *         description: Pricing element updated
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
 *       400:
 *         description: Validation error
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
router.patch('/price-lists/:id/pricing-elements/:elemId', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.updatePricingElement(username, req.params.elemId, data);
  res.json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/price-lists/{id}/pricing-elements/{elemId}:
 *   delete:
 *     operationId: deletePricingElement
 *     summary: Delete pricing element
 *     description: Delete a PricingElement record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Price list ID
 *       - in: path
 *         name: elemId
 *         required: true
 *         schema:
 *           type: string
 *         description: Pricing element ID
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Pricing element deleted
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
 *       400:
 *         description: Missing username
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
router.delete('/price-lists/:id/pricing-elements/:elemId', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  await catalogManagerService.deletePricingElement(username, req.params.elemId);
  res.json({ success: true, message: 'Pricing element deleted' });
}));

// ─────────────────────────────────────────────────────────────────────────────
// Pricing Variables
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/catalog-manager/pricing-variables:
 *   get:
 *     operationId: getPricingVariables
 *     summary: List pricing variables
 *     description: Returns pricing variable records from the Salesforce org
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Pricing variables
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Missing username
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
router.get('/pricing-variables', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  const result = await catalogManagerService.getPricingVariables(username, req.query);
  res.json({ success: true, ...result });
}));

/**
 * @swagger
 * /api/catalog-manager/pricing-variables:
 *   post:
 *     operationId: createPricingVariable
 *     summary: Create pricing variable
 *     description: Create a new pricing variable record
 *     tags: [Catalog Manager]
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
 *     responses:
 *       201:
 *         description: Pricing variable created
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
 *       400:
 *         description: Validation error
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
router.post('/pricing-variables', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.createPricingVariable(username, data);
  res.status(201).json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/pricing-variables/{id}:
 *   patch:
 *     operationId: updatePricingVariable
 *     summary: Update pricing variable
 *     description: Partially update a pricing variable record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
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
 *     responses:
 *       200:
 *         description: Pricing variable updated
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
 *       400:
 *         description: Validation error
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
router.patch('/pricing-variables/:id', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.updatePricingVariable(username, req.params.id, data);
  res.json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/pricing-variables/{id}:
 *   delete:
 *     operationId: deletePricingVariable
 *     summary: Delete pricing variable
 *     description: Delete a pricing variable record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Pricing variable deleted
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
 *       400:
 *         description: Missing username
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
router.delete('/pricing-variables/:id', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  await catalogManagerService.deletePricingVariable(username, req.params.id);
  res.json({ success: true, message: 'Pricing variable deleted' });
}));

// ─────────────────────────────────────────────────────────────────────────────
// Attribute Categories
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/catalog-manager/attribute-categories:
 *   get:
 *     operationId: getAttributeCategories
 *     summary: List attribute categories
 *     description: Returns attribute category records from the Salesforce org
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Attribute categories
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Missing username
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
router.get('/attribute-categories', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  const result = await catalogManagerService.getAttributeCategories(username, req.query);
  res.json({ success: true, ...result });
}));

/**
 * @swagger
 * /api/catalog-manager/attribute-categories:
 *   post:
 *     operationId: createAttributeCategory
 *     summary: Create attribute category
 *     description: Create a new attribute category record
 *     tags: [Catalog Manager]
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
 *     responses:
 *       201:
 *         description: Attribute category created
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
 *       400:
 *         description: Validation error
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
router.post('/attribute-categories', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.createAttributeCategory(username, data);
  res.status(201).json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/attribute-categories/{id}:
 *   patch:
 *     operationId: updateAttributeCategory
 *     summary: Update attribute category
 *     description: Partially update an attribute category record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
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
 *     responses:
 *       200:
 *         description: Attribute category updated
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
 *       400:
 *         description: Validation error
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
router.patch('/attribute-categories/:id', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.updateAttributeCategory(username, req.params.id, data);
  res.json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/attribute-categories/{id}:
 *   delete:
 *     operationId: deleteAttributeCategory
 *     summary: Delete attribute category
 *     description: Delete an attribute category record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Attribute category deleted
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
 *       400:
 *         description: Missing username
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
router.delete('/attribute-categories/:id', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  await catalogManagerService.deleteAttributeCategory(username, req.params.id);
  res.json({ success: true, message: 'Attribute category deleted' });
}));

// Attributes (nested under attribute categories)
/**
 * @swagger
 * /api/catalog-manager/attribute-categories/{catId}/attributes:
 *   get:
 *     operationId: getAttributes
 *     summary: List attributes
 *     description: Returns attributes nested under a given attribute category
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: catId
 *         required: true
 *         schema:
 *           type: string
 *         description: Attribute category ID
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Attributes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Missing username
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
router.get('/attribute-categories/:catId/attributes', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  const result = await catalogManagerService.getAttributes(username, req.params.catId, req.query);
  res.json({ success: true, ...result });
}));

/**
 * @swagger
 * /api/catalog-manager/attribute-categories/{catId}/attributes:
 *   post:
 *     operationId: createAttribute
 *     summary: Create attribute
 *     description: Create a new attribute under the given category
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: catId
 *         required: true
 *         schema:
 *           type: string
 *         description: Attribute category ID
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
 *     responses:
 *       201:
 *         description: Attribute created
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
 *       400:
 *         description: Validation error
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
router.post('/attribute-categories/:catId/attributes', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.createAttribute(username, req.params.catId, data);
  res.status(201).json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/attribute-categories/{catId}/attributes/{attrId}:
 *   patch:
 *     operationId: updateAttribute
 *     summary: Update attribute
 *     description: Partially update an attribute record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: catId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: attrId
 *         required: true
 *         schema:
 *           type: string
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
 *     responses:
 *       200:
 *         description: Attribute updated
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
 *       400:
 *         description: Validation error
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
router.patch('/attribute-categories/:catId/attributes/:attrId', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.updateAttribute(username, req.params.attrId, data);
  res.json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/attribute-categories/{catId}/attributes/{attrId}:
 *   delete:
 *     operationId: deleteAttribute
 *     summary: Delete attribute
 *     description: Delete an attribute record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: catId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: attrId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Attribute deleted
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
 *       400:
 *         description: Missing username
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
router.delete('/attribute-categories/:catId/attributes/:attrId', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  await catalogManagerService.deleteAttribute(username, req.params.attrId);
  res.json({ success: true, message: 'Attribute deleted' });
}));

// ─────────────────────────────────────────────────────────────────────────────
// Picklists
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/catalog-manager/picklists:
 *   get:
 *     operationId: getPicklists
 *     summary: List picklists
 *     description: Returns picklist records from the Salesforce org
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Picklists
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Missing username
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
router.get('/picklists', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  const result = await catalogManagerService.getPicklists(username, req.query);
  res.json({ success: true, ...result });
}));

/**
 * @swagger
 * /api/catalog-manager/picklists:
 *   post:
 *     operationId: createPicklist
 *     summary: Create picklist
 *     description: Create a new picklist record
 *     tags: [Catalog Manager]
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
 *     responses:
 *       201:
 *         description: Picklist created
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
 *       400:
 *         description: Validation error
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
router.post('/picklists', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.createPicklist(username, data);
  res.status(201).json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/picklists/{id}:
 *   patch:
 *     operationId: updatePicklist
 *     summary: Update picklist
 *     description: Partially update a picklist record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
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
 *     responses:
 *       200:
 *         description: Picklist updated
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
 *       400:
 *         description: Validation error
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
router.patch('/picklists/:id', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.updatePicklist(username, req.params.id, data);
  res.json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/picklists/{id}:
 *   delete:
 *     operationId: deletePicklist
 *     summary: Delete picklist
 *     description: Delete a picklist record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Picklist deleted
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
 *       400:
 *         description: Missing username
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
router.delete('/picklists/:id', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  await catalogManagerService.deletePicklist(username, req.params.id);
  res.json({ success: true, message: 'Picklist deleted' });
}));

// Picklist Values (nested under picklists)
/**
 * @swagger
 * /api/catalog-manager/picklists/{id}/values:
 *   get:
 *     operationId: getPicklistValues
 *     summary: List picklist values
 *     description: Returns all value records for a given picklist
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Picklist ID
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Picklist values
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Missing username
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
router.get('/picklists/:id/values', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  const result = await catalogManagerService.getPicklistValues(username, req.params.id);
  res.json({ success: true, ...result });
}));

/**
 * @swagger
 * /api/catalog-manager/picklists/{id}/values:
 *   post:
 *     operationId: createPicklistValue
 *     summary: Create picklist value
 *     description: Add a new value to an existing picklist
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Picklist ID
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
 *     responses:
 *       201:
 *         description: Picklist value created
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
 *       400:
 *         description: Validation error
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
router.post('/picklists/:id/values', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.createPicklistValue(username, req.params.id, data);
  res.status(201).json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/picklists/{id}/values/{valueId}:
 *   patch:
 *     operationId: updatePicklistValue
 *     summary: Update picklist value
 *     description: Partially update a picklist value record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: valueId
 *         required: true
 *         schema:
 *           type: string
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
 *     responses:
 *       200:
 *         description: Picklist value updated
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
 *       400:
 *         description: Validation error
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
router.patch('/picklists/:id/values/:valueId', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.updatePicklistValue(username, req.params.valueId, data);
  res.json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/picklists/{id}/values/{valueId}:
 *   delete:
 *     operationId: deletePicklistValue
 *     summary: Delete picklist value
 *     description: Delete a picklist value record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: valueId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Picklist value deleted
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
 *       400:
 *         description: Missing username
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
router.delete('/picklists/:id/values/:valueId', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  await catalogManagerService.deletePicklistValue(username, req.params.valueId);
  res.json({ success: true, message: 'Picklist value deleted' });
}));

// ─────────────────────────────────────────────────────────────────────────────
// Catalogs (vlocity_cmt__Catalog__c)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/catalog-manager/catalogs:
 *   get:
 *     operationId: getCatalogs
 *     summary: List catalogs
 *     description: Returns vlocity_cmt__Catalog__c records
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Catalog records
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Missing username
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
router.get('/catalogs', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  const result = await catalogManagerService.getCatalogs(username, req.query);
  res.json({ success: true, ...result });
}));

/**
 * @swagger
 * /api/catalog-manager/catalogs:
 *   post:
 *     operationId: createCatalog
 *     summary: Create catalog
 *     description: Create a new vlocity_cmt__Catalog__c record
 *     tags: [Catalog Manager]
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
 *     responses:
 *       201:
 *         description: Catalog created
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
 *       400:
 *         description: Validation error
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
router.post('/catalogs', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.createCatalog(username, data);
  res.status(201).json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/catalogs/{id}:
 *   patch:
 *     operationId: updateCatalog
 *     summary: Update catalog
 *     description: Partially update a catalog record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
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
 *     responses:
 *       200:
 *         description: Catalog updated
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
 *       400:
 *         description: Validation error
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
router.patch('/catalogs/:id', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.updateCatalog(username, req.params.id, data);
  res.json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/catalogs/{id}:
 *   delete:
 *     operationId: deleteCatalog
 *     summary: Delete catalog
 *     description: Delete a catalog record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Catalog deleted
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
 *       400:
 *         description: Missing username
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
router.delete('/catalogs/:id', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  await catalogManagerService.deleteCatalog(username, req.params.id);
  res.json({ success: true, message: 'Catalog deleted' });
}));

// Catalog-Product / Catalog-Catalog Relationships (nested under catalogs)
// ?itemType=Product|Catalog filters by vlocity_cmt__ItemType__c
/**
 * @swagger
 * /api/catalog-manager/catalogs/{id}/products:
 *   get:
 *     operationId: getCatalogProducts
 *     summary: List catalog product relationships
 *     description: Returns CatalogProductRelationship records for a catalog, optionally filtered by itemType (Product or Catalog)
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Catalog ID
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: itemType
 *         schema:
 *           type: string
 *           enum: [Product, Catalog]
 *         description: Filter by vlocity_cmt__ItemType__c
 *     responses:
 *       200:
 *         description: Catalog product relationships
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Missing username
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
router.get('/catalogs/:id/products', asyncHandler(async (req, res) => {
  const { username, itemType } = req.query;
  if (!username) throw new ValidationError('username is required');
  const result = await catalogManagerService.getCatalogProducts(username, req.params.id, itemType || null);
  res.json({ success: true, ...result });
}));

/**
 * @swagger
 * /api/catalog-manager/catalogs/{id}/products:
 *   post:
 *     operationId: createCatalogProduct
 *     summary: Add product to catalog
 *     description: Create a CatalogProductRelationship linking a product or sub-catalog to the catalog
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Catalog ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - productId
 *             properties:
 *               username:
 *                 type: string
 *               productId:
 *                 type: string
 *               itemType:
 *                 type: string
 *                 enum: [Product, Catalog]
 *                 default: Product
 *     responses:
 *       201:
 *         description: Relationship created
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
 *       400:
 *         description: Validation error
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
router.post('/catalogs/:id/products', asyncHandler(async (req, res) => {
  const { username, productId, itemType = 'Product' } = req.body;
  if (!username) throw new ValidationError('username is required');
  if (!productId) throw new ValidationError('productId is required');
  const record = await catalogManagerService.createCatalogProduct(username, req.params.id, productId, itemType);
  res.status(201).json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/catalogs/{id}/products/{relId}:
 *   delete:
 *     operationId: deleteCatalogProduct
 *     summary: Remove product from catalog
 *     description: Delete a CatalogProductRelationship record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Catalog ID
 *       - in: path
 *         name: relId
 *         required: true
 *         schema:
 *           type: string
 *         description: Relationship record ID
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Relationship removed
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
 *       400:
 *         description: Missing username
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
router.delete('/catalogs/:id/products/:relId', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  await catalogManagerService.deleteCatalogProduct(username, req.params.relId);
  res.json({ success: true, message: 'Relationship removed from catalog' });
}));

// ─────────────────────────────────────────────────────────────────────────────
// Product Child Items (vlocity_cmt__ProductChildItem__c)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/catalog-manager/product-child-items:
 *   get:
 *     operationId: getProductChildItems
 *     summary: List product child items
 *     description: Returns vlocity_cmt__ProductChildItem__c records, optionally filtered by parent product
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: parentProductId
 *         schema:
 *           type: string
 *         description: Filter by parent product Salesforce ID
 *     responses:
 *       200:
 *         description: Product child items
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Missing username
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
router.get('/product-child-items', asyncHandler(async (req, res) => {
  const { username, parentProductId, ...filters } = req.query;
  if (!username) throw new ValidationError('username is required');
  const result = await catalogManagerService.getProductChildItems(username, parentProductId || null, filters);
  res.json({ success: true, ...result });
}));

/**
 * @swagger
 * /api/catalog-manager/product-child-items:
 *   post:
 *     operationId: createProductChildItem
 *     summary: Create product child item
 *     description: Create a vlocity_cmt__ProductChildItem__c linking a parent and child product
 *     tags: [Catalog Manager]
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
 *               - parentProductId
 *               - childProductId
 *             properties:
 *               username:
 *                 type: string
 *               parentProductId:
 *                 type: string
 *               childProductId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Product child item created
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
 *       400:
 *         description: Validation error
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
router.post('/product-child-items', asyncHandler(async (req, res) => {
  const { username, parentProductId, childProductId, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  if (!parentProductId) throw new ValidationError('parentProductId is required');
  if (!childProductId) throw new ValidationError('childProductId is required');
  const record = await catalogManagerService.createProductChildItem(username, parentProductId, childProductId, data);
  res.status(201).json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/product-child-items/{id}:
 *   delete:
 *     operationId: deleteProductChildItem
 *     summary: Delete product child item
 *     description: Delete a ProductChildItem record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Product child item deleted
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
 *       400:
 *         description: Missing username
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
router.delete('/product-child-items/:id', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  await catalogManagerService.deleteProductChildItem(username, req.params.id);
  res.json({ success: true, message: 'Product child item deleted' });
}));

// ─────────────────────────────────────────────────────────────────────────────
// Instance URL
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/catalog-manager/instance-url:
 *   get:
 *     operationId: getCatalogInstanceUrl
 *     summary: Get Salesforce instance URL
 *     description: Authenticates with SFDX and returns the instance URL for the given Salesforce username
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Instance URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 instanceUrl:
 *                   type: string
 *                   nullable: true
 *       400:
 *         description: Missing username
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
router.get('/instance-url', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  const salesforceService = require('../services/salesforceService');
  await salesforceService.authenticateWithSfdx(username);
  res.json({ success: true, instanceUrl: salesforceService.instanceUrl || null });
}));

// ─────────────────────────────────────────────────────────────────────────────
// Promotions
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/catalog-manager/promotions:
 *   get:
 *     operationId: getPromotions
 *     summary: List promotions
 *     description: Returns promotion records from the Salesforce org
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Promotions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Promotion'
 *       400:
 *         description: Missing username
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
  const username = requireUsername(req.query);
  const result = await catalogManagerService.getPromotions(username, req.query);
  res.json({ success: true, ...result });
}));

/**
 * @swagger
 * /api/catalog-manager/promotions/{id}:
 *   get:
 *     operationId: getPromotionById
 *     summary: Get promotion
 *     description: Retrieve a single promotion record by ID
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Promotion record
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Promotion'
 *       400:
 *         description: Missing username
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
router.get('/promotions/:id', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  const record = await catalogManagerService.getPromotionById(username, req.params.id);
  if (!record) throw new NotFoundError(`Promotion ${req.params.id} not found`);
  res.json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/promotions:
 *   post:
 *     operationId: createPromotion
 *     summary: Create promotion
 *     description: Create a new promotion record
 *     tags: [Catalog Manager]
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
 *     responses:
 *       201:
 *         description: Promotion created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Promotion'
 *       400:
 *         description: Validation error
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
router.post('/promotions', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.createPromotion(username, data);
  res.status(201).json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/promotions/{id}:
 *   patch:
 *     operationId: updatePromotion
 *     summary: Update promotion
 *     description: Partially update a promotion record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
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
 *     responses:
 *       200:
 *         description: Promotion updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Promotion'
 *       400:
 *         description: Validation error
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
router.patch('/promotions/:id', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.updatePromotion(username, req.params.id, data);
  res.json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/promotions/{id}:
 *   delete:
 *     operationId: deletePromotion
 *     summary: Delete promotion
 *     description: Delete a promotion record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Promotion deleted
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
 *       400:
 *         description: Missing username
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
router.delete('/promotions/:id', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  await catalogManagerService.deletePromotion(username, req.params.id);
  res.json({ success: true, message: 'Promotion deleted' });
}));

// Promotion Rules
/**
 * @swagger
 * /api/catalog-manager/promotions/{id}/rules:
 *   get:
 *     operationId: getPromotionRules
 *     summary: List promotion rules
 *     description: Returns all rules associated with a promotion
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Promotion ID
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Promotion rules
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Missing username
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
router.get('/promotions/:id/rules', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  const result = await catalogManagerService.getPromotionRules(username, req.params.id);
  res.json({ success: true, ...result });
}));

/**
 * @swagger
 * /api/catalog-manager/promotions/{id}/rules:
 *   post:
 *     operationId: createPromotionRule
 *     summary: Create promotion rule
 *     description: Add a new rule to a promotion
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Promotion ID
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
 *     responses:
 *       201:
 *         description: Promotion rule created
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
 *       400:
 *         description: Validation error
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
router.post('/promotions/:id/rules', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.createPromotionRule(username, { ...data, Promotion__c: req.params.id });
  res.status(201).json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/promotions/{id}/rules/{ruleId}:
 *   patch:
 *     operationId: updatePromotionRule
 *     summary: Update promotion rule
 *     description: Partially update a promotion rule record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Promotion ID
 *       - in: path
 *         name: ruleId
 *         required: true
 *         schema:
 *           type: string
 *         description: Rule ID
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
 *     responses:
 *       200:
 *         description: Promotion rule updated
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
 *       400:
 *         description: Validation error
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
router.patch('/promotions/:id/rules/:ruleId', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.updatePromotionRule(username, req.params.ruleId, data);
  res.json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/promotions/{id}/rules/{ruleId}:
 *   delete:
 *     operationId: deletePromotionRule
 *     summary: Delete promotion rule
 *     description: Delete a promotion rule record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Promotion ID
 *       - in: path
 *         name: ruleId
 *         required: true
 *         schema:
 *           type: string
 *         description: Rule ID
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Promotion rule deleted
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
 *       400:
 *         description: Missing username
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
router.delete('/promotions/:id/rules/:ruleId', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  await catalogManagerService.deletePromotionRule(username, req.params.ruleId);
  res.json({ success: true, message: 'Rule deleted' });
}));

// ─────────────────────────────────────────────────────────────────────────────
// Rate Codes
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/catalog-manager/rate-codes:
 *   get:
 *     operationId: getRateCodes
 *     summary: List rate codes
 *     description: Returns rate code records from the Salesforce org
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Rate codes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Missing username
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
  const username = requireUsername(req.query);
  const result = await catalogManagerService.getRateCodes(username, req.query);
  res.json({ success: true, ...result });
}));

/**
 * @swagger
 * /api/catalog-manager/rate-codes/{id}:
 *   get:
 *     operationId: getRateCodeById
 *     summary: Get rate code
 *     description: Retrieve a single rate code record by ID
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Rate code record
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
 *       400:
 *         description: Missing username
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
 *         description: Rate code not found
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
router.get('/rate-codes/:id', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  const record = await catalogManagerService.getRateCodeById(username, req.params.id);
  if (!record) throw new NotFoundError(`Rate code ${req.params.id} not found`);
  res.json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/rate-codes:
 *   post:
 *     operationId: createRateCode
 *     summary: Create rate code
 *     description: Create a new rate code record
 *     tags: [Catalog Manager]
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
 *     responses:
 *       201:
 *         description: Rate code created
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
 *       400:
 *         description: Validation error
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
router.post('/rate-codes', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.createRateCode(username, data);
  res.status(201).json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/rate-codes/{id}:
 *   patch:
 *     operationId: updateRateCode
 *     summary: Update rate code
 *     description: Partially update a rate code record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
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
 *     responses:
 *       200:
 *         description: Rate code updated
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
 *       400:
 *         description: Validation error
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
router.patch('/rate-codes/:id', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.updateRateCode(username, req.params.id, data);
  res.json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/rate-codes/{id}:
 *   delete:
 *     operationId: deleteRateCode
 *     summary: Delete rate code
 *     description: Delete a rate code record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Rate code deleted
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
 *       400:
 *         description: Missing username
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
router.delete('/rate-codes/:id', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  await catalogManagerService.deleteRateCode(username, req.params.id);
  res.json({ success: true, message: 'Rate code deleted' });
}));

// ─────────────────────────────────────────────────────────────────────────────
// Rate Tables
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/catalog-manager/rate-tables:
 *   get:
 *     operationId: getRateTables
 *     summary: List rate tables
 *     description: Returns rate table records from the Salesforce org
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Rate tables
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Missing username
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
  const username = requireUsername(req.query);
  const result = await catalogManagerService.getRateTables(username, req.query);
  res.json({ success: true, ...result });
}));

/**
 * @swagger
 * /api/catalog-manager/rate-tables/{id}:
 *   get:
 *     operationId: getRateTableById
 *     summary: Get rate table
 *     description: Retrieve a single rate table record by ID
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Rate table record
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
 *       400:
 *         description: Missing username
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
 *         description: Rate table not found
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
router.get('/rate-tables/:id', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  const record = await catalogManagerService.getRateTableById(username, req.params.id);
  if (!record) throw new NotFoundError(`Rate table ${req.params.id} not found`);
  res.json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/rate-tables:
 *   post:
 *     operationId: createRateTable
 *     summary: Create rate table
 *     description: Create a new rate table record
 *     tags: [Catalog Manager]
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
 *     responses:
 *       201:
 *         description: Rate table created
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
 *       400:
 *         description: Validation error
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
router.post('/rate-tables', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.createRateTable(username, data);
  res.status(201).json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/rate-tables/{id}:
 *   patch:
 *     operationId: updateRateTable
 *     summary: Update rate table
 *     description: Partially update a rate table record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
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
 *     responses:
 *       200:
 *         description: Rate table updated
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
 *       400:
 *         description: Validation error
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
router.patch('/rate-tables/:id', asyncHandler(async (req, res) => {
  const { username, ...data } = req.body;
  if (!username) throw new ValidationError('username is required');
  const record = await catalogManagerService.updateRateTable(username, req.params.id, data);
  res.json({ success: true, data: record });
}));

/**
 * @swagger
 * /api/catalog-manager/rate-tables/{id}:
 *   delete:
 *     operationId: deleteRateTable
 *     summary: Delete rate table
 *     description: Delete a rate table record
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Rate table deleted
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
 *       400:
 *         description: Missing username
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
router.delete('/rate-tables/:id', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  await catalogManagerService.deleteRateTable(username, req.params.id);
  res.json({ success: true, message: 'Rate table deleted' });
}));

// ─────────────────────────────────────────────────────────────────────────────
// Batch Jobs
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/catalog-manager/batch/jobs:
 *   get:
 *     operationId: getBatchJobs
 *     summary: List batch jobs
 *     description: Returns Apex batch job records for the given Salesforce org
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Batch job records
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Missing username
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
router.get('/batch/jobs', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  const result = await catalogManagerService.getBatchJobs(username);
  res.json({ success: true, ...result });
}));

/**
 * @swagger
 * /api/catalog-manager/batch/execute:
 *   post:
 *     operationId: executeBatchJob
 *     summary: Execute batch job
 *     description: Trigger an Apex batch class execution in the Salesforce org
 *     tags: [Catalog Manager]
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
 *               - apexClassName
 *             properties:
 *               username:
 *                 type: string
 *               apexClassName:
 *                 type: string
 *                 description: Fully qualified Apex batch class name
 *               country:
 *                 type: string
 *                 description: Optional country code to scope the batch
 *     responses:
 *       200:
 *         description: Batch job started
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
 *       400:
 *         description: Validation error
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
router.post('/batch/execute', asyncHandler(async (req, res) => {
  const { username, apexClassName, country } = req.body;
  if (!username)      throw new ValidationError('username is required');
  if (!apexClassName) throw new ValidationError('apexClassName is required');
  const result = await catalogManagerService.executeBatch(username, apexClassName, country);
  res.json({ success: true, data: result });
}));

// ─────────────────────────────────────────────────────────────────────────────
// Snapshots (Rollback)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/catalog-manager/snapshots:
 *   get:
 *     operationId: listSnapshots
 *     summary: List snapshots
 *     description: Returns all catalog state snapshots for the given user (used for rollback)
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Snapshot list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 records:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Missing username
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
router.get('/snapshots', asyncHandler(async (req, res) => {
  const username = requireUsername(req.query);
  const snapshots = await rollbackService.listSnapshots(username);
  res.json({ success: true, records: snapshots });
}));

/**
 * @swagger
 * /api/catalog-manager/snapshots:
 *   post:
 *     operationId: createSnapshot
 *     summary: Create snapshot
 *     description: Capture the current catalog state as a named snapshot for rollback purposes
 *     tags: [Catalog Manager]
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
 *               label:
 *                 type: string
 *                 description: Optional human-readable label for the snapshot
 *     responses:
 *       201:
 *         description: Snapshot created
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
 *       400:
 *         description: Validation error
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
router.post('/snapshots', asyncHandler(async (req, res) => {
  const { username, label } = req.body;
  if (!username) throw new ValidationError('username is required');
  const result = await rollbackService.createSnapshot(
    username,
    label || `Manual snapshot — ${new Date().toLocaleString()}`,
    false
  );
  res.status(201).json({ success: true, data: result });
}));

/**
 * @swagger
 * /api/catalog-manager/snapshots/{snapshotId}:
 *   get:
 *     operationId: getSnapshot
 *     summary: Get snapshot
 *     description: Retrieve the metadata and data for a specific snapshot
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: snapshotId
 *         required: true
 *         schema:
 *           type: string
 *         description: Snapshot ID
 *     responses:
 *       200:
 *         description: Snapshot content
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 metadata:
 *                   type: object
 *                 data:
 *                   type: object
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Snapshot not found
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
router.get('/snapshots/:snapshotId', asyncHandler(async (req, res) => {
  const { metadata, data } = await rollbackService.getSnapshot(req.params.snapshotId);
  res.json({ success: true, metadata, data });
}));

/**
 * @swagger
 * /api/catalog-manager/snapshots/{snapshotId}/restore:
 *   post:
 *     operationId: restoreSnapshot
 *     summary: Restore snapshot
 *     description: Restore catalog state from a snapshot to a target Salesforce org
 *     tags: [Catalog Manager]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: snapshotId
 *         required: true
 *         schema:
 *           type: string
 *         description: Snapshot ID to restore from
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - targetUsername
 *             properties:
 *               targetUsername:
 *                 type: string
 *                 description: Salesforce username for the target org to restore into
 *     responses:
 *       200:
 *         description: Snapshot restored successfully
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
 *       400:
 *         description: Validation error
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
 *         description: Snapshot not found
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
router.post('/snapshots/:snapshotId/restore', asyncHandler(async (req, res) => {
  const { targetUsername } = req.body;
  if (!targetUsername) throw new ValidationError('targetUsername is required');
  const result = await rollbackService.restoreSnapshot(req.params.snapshotId, targetUsername);
  res.json({ success: true, data: result });
}));

module.exports = router;
