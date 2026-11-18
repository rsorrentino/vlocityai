/** Export API (/api/exports): ready-made export job templates. Mounted by ../exports.js. */
const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../../middleware/errorHandler');
const { getExportTemplates } = require('../../config/exportTemplates');

/**
 * @swagger
 * /api/exports/templates:
 *   get:
 *     operationId: getExportTemplates
 *     summary: Get export job templates
 *     description: Returns a set of pre-built export job configuration templates (e.g. Full Catalog Export) that can be used as a starting point for new jobs.
 *     tags:
 *       - Export Jobs
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Templates retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 templates:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       description:
 *                         type: string
 *                       config:
 *                         type: object
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/templates', asyncHandler(async (req, res) => {
  const templates = getExportTemplates();

  res.json({
    templates,
    count: templates.length,
    timestamp: new Date().toISOString(),
  });
}));

module.exports = router;
