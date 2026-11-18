/** Catalog Manager API: Attribute categories and their attributes. Mounted by ../catalogManager.js. */
const express = require('express');
const router = express.Router();
const { asyncHandler, ValidationError } = require('../../middleware/errorHandler');
const catalogManagerService = require('../../services/catalogManagerService');
const { requireUsername } = require('./helpers');

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

module.exports = router;
