/** Catalog Manager API: Product2 records. Mounted by ../catalogManager.js. */
const express = require('express');
const router = express.Router();
const { asyncHandler, ValidationError, NotFoundError } = require('../../middleware/errorHandler');
const catalogManagerService = require('../../services/catalogManagerService');
const { requireUsername } = require('./helpers');

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

module.exports = router;
