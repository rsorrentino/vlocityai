/** Catalog Manager API: Rate codes and rate tables (GT_ objects). Mounted by ../catalogManager.js. */
const express = require('express');
const router = express.Router();
const { asyncHandler, ValidationError, NotFoundError } = require('../../middleware/errorHandler');
const catalogManagerService = require('../../services/catalogManagerService');
const { requireUsername } = require('./helpers');

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

module.exports = router;
