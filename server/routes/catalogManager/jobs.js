/** Catalog Manager API: Batch jobs and catalog snapshots (rollback). Mounted by ../catalogManager.js. */
const express = require('express');
const router = express.Router();
const { asyncHandler, ValidationError } = require('../../middleware/errorHandler');
const catalogManagerService = require('../../services/catalogManagerService');
const rollbackService = require('../../services/rollbackService');
const { requireUsername } = require('./helpers');

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
