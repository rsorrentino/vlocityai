/** Catalog Manager API: Catalogs, catalog products, product child items and the org instance URL. Mounted by ../catalogManager.js. */
const express = require('express');
const router = express.Router();
const { asyncHandler, ValidationError } = require('../../middleware/errorHandler');
const catalogManagerService = require('../../services/catalogManagerService');
const { requireUsername } = require('./helpers');

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
  const salesforceService = require('../../services/salesforceService');
  await salesforceService.authenticateWithSfdx(username);
  res.json({ success: true, instanceUrl: salesforceService.instanceUrl || null });
}));

module.exports = router;
