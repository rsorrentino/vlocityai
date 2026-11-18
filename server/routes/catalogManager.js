/**
 * Catalog Manager API (/api/catalog-manager).
 *
 * Each object type has its own router in ./catalogManager/; this file keeps
 * the stats endpoint and mounts the others.
 */
const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const catalogManagerService = require('../services/catalogManagerService');
const { requireUsername } = require('./catalogManager/helpers');

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

router.use(require('./catalogManager/products'));
router.use(require('./catalogManager/priceLists'));
router.use(require('./catalogManager/pricingVariables'));
router.use(require('./catalogManager/attributes'));
router.use(require('./catalogManager/picklists'));
router.use(require('./catalogManager/catalogs'));
router.use(require('./catalogManager/promotions'));
router.use(require('./catalogManager/rates'));
router.use(require('./catalogManager/jobs'));

module.exports = router;
