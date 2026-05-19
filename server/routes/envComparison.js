const express = require('express');
const path = require('path');
const router = express.Router();
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const { authenticate } = require('../middleware/auth');
const envComparisonService = require('../services/envComparisonService');
const jobHistoryService = require('../services/jobHistoryService');
const vlocityService = require('../services/vlocityService');
const logger = require('../utils/logger');

/**
 * @swagger
 * /api/env-comparison/object-types:
 *   get:
 *     operationId: getEnvComparisonObjectTypes
 *     summary: List supported object types for environment comparison
 *     description: >
 *       Returns the list of SObject types that the environment comparison
 *       service supports, including their match strategy (GlobalKey or
 *       composite key) and sync method (Vlocity CLI or direct API).
 *     tags:
 *       - Environment Comparison
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Object type definitions returned
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
 *                     properties:
 *                       objectType:
 *                         type: string
 *                         example: Product2
 *                       label:
 *                         type: string
 *                       matchBy:
 *                         type: string
 *                         example: globalKey
 *                       syncBy:
 *                         type: string
 *                         example: vlocity
 *       401:
 *         description: Authentication required
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
/**
 * GET /api/env-comparison/object-types
 * Returns the list of supported object types for the comparison UI.
 */
router.get('/object-types', authenticate, asyncHandler(async (req, res) => {
  const definitions = envComparisonService.getObjectDefinitions();
  res.json({ success: true, data: definitions });
}));

/**
 * @swagger
 * /api/env-comparison/last-result:
 *   get:
 *     operationId: getLastEnvComparisonResult
 *     summary: Retrieve the cached result of the most recent comparison
 *     description: >
 *       Returns the in-memory cached result from the last /run call.
 *       Returns 404 if no comparison has been run in the current server
 *       session.
 *     tags:
 *       - Environment Comparison
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Last comparison result returned
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
 *                   description: Comparison result with per-object results and summary
 *       401:
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: No comparison result available
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
/**
 * GET /api/env-comparison/last-result
 * Returns the cached result of the most recent comparison, or 404.
 */
router.get('/last-result', authenticate, asyncHandler(async (req, res) => {
  const result = envComparisonService.getLastResult();
  if (!result) {
    return res.status(404).json({
      success: false,
      message: 'No comparison result available. Run a comparison first.',
    });
  }
  res.json({ success: true, data: result });
}));

/**
 * @swagger
 * /api/env-comparison/run:
 *   get:
 *     operationId: runEnvComparison
 *     summary: Compare records between two Salesforce orgs
 *     description: >
 *       Queries the supported object types in both the source and target orgs
 *       and identifies records that are present in the source but missing from
 *       the target (or vice-versa). Results are cached in memory for
 *       subsequent /last-result and /sync calls.
 *     tags:
 *       - Environment Comparison
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: sourceUsername
 *         required: true
 *         schema:
 *           type: string
 *         description: SFDX username of the source (MasterCatalog) org
 *         example: admin@mastercatalog.com
 *       - in: query
 *         name: targetUsername
 *         required: true
 *         schema:
 *           type: string
 *         description: SFDX username of the target (UAT) org
 *         example: admin@uat.com
 *       - in: query
 *         name: objectTypes
 *         required: false
 *         schema:
 *           type: string
 *         description: Comma-separated list of object API names to compare (defaults to all supported types)
 *         example: Product2,PriceListEntry
 *     responses:
 *       200:
 *         description: Comparison completed
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
 *                   description: Per-object comparison results including missingCount and extraCount
 *       400:
 *         description: Missing required parameters or source equals target
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Comparison failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * GET /api/env-comparison/run
 * Runs a comparison between source and target orgs.
 *
 * Query params:
 *   sourceUsername  — SFDX username for the source org (MasterCatalog)
 *   targetUsername  — SFDX username for the target org (UAT)
 *   objectTypes     — comma-separated list of object API names (optional; defaults to all)
 */
router.get('/run', authenticate, asyncHandler(async (req, res) => {
  const { sourceUsername, targetUsername, objectTypes } = req.query;

  if (!sourceUsername) throw new ValidationError('sourceUsername is required');
  if (!targetUsername) throw new ValidationError('targetUsername is required');
  if (sourceUsername === targetUsername) {
    throw new ValidationError('Source and target orgs must be different');
  }

  const types = objectTypes
    ? objectTypes.split(',').map(t => t.trim()).filter(Boolean)
    : [];

  logger.logOperation('Env comparison started', {
    sourceUsername,
    targetUsername,
    objectTypes: types.length ? types : 'all',
    requestedBy: req.user?.username,
  });

  const result = await envComparisonService.compareOrgs(sourceUsername, targetUsername, types);

  const totalMissing = result.results.reduce((acc, r) => acc + r.missingCount, 0);
  const totalExtra = result.results.reduce((acc, r) => acc + r.extraCount, 0);

  logger.logOperation('Env comparison complete', {
    sourceUsername,
    targetUsername,
    totalMissing,
    totalExtra,
  });

  res.json({ success: true, data: result });
}));

/**
 * @swagger
 * /api/env-comparison/sync:
 *   post:
 *     operationId: syncEnvComparisonRecords
 *     summary: Sync selected missing records from source to target org
 *     description: >
 *       Starts an asynchronous two-phase pipeline: export the selected
 *       records from the source org using the Vlocity CLI, then deploy them
 *       to the target org. GT_ custom-object records are synced via direct
 *       Salesforce REST API upsert instead. Returns immediately with a jobId;
 *       progress is available via WebSocket and GET /api/jobs/:id.
 *     tags:
 *       - Environment Comparison
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sourceUsername
 *               - targetUsername
 *               - selectedRecords
 *             properties:
 *               sourceUsername:
 *                 type: string
 *                 description: SFDX username of the source (MasterCatalog) org
 *                 example: admin@mastercatalog.com
 *               targetUsername:
 *                 type: string
 *                 description: SFDX username of the target (UAT) org
 *                 example: admin@uat.com
 *               selectedRecords:
 *                 type: array
 *                 minItems: 1
 *                 description: Records to sync from source to target
 *                 items:
 *                   type: object
 *                   required:
 *                     - objectType
 *                     - globalKey
 *                     - name
 *                   properties:
 *                     objectType:
 *                       type: string
 *                       example: Product2
 *                     globalKey:
 *                       type: string
 *                       description: vlocity_cmt__GlobalKey__c value
 *                     name:
 *                       type: string
 *     responses:
 *       200:
 *         description: Sync job started — pipeline runs asynchronously
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
 *                   example: Sync job started
 *                 data:
 *                   type: object
 *                   properties:
 *                     jobId:
 *                       type: string
 *                       format: uuid
 *                     jobName:
 *                       type: string
 *       400:
 *         description: Missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Failed to create sync job
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * POST /api/env-comparison/sync
 * Triggers an export from the source org and a deploy to the target org for
 * the selected missing records.
 *
 * Body:
 *   sourceUsername   — SFDX username of the source org
 *   targetUsername   — SFDX username of the target org
 *   selectedRecords  — Array of { objectType, globalKey, name }
 *
 * Returns immediately with a jobId. Progress is available via WebSocket
 * and GET /api/jobs/:id.
 */
router.post('/sync', authenticate, asyncHandler(async (req, res) => {
  const { sourceUsername, targetUsername, selectedRecords } = req.body;

  if (!sourceUsername) throw new ValidationError('sourceUsername is required');
  if (!targetUsername) throw new ValidationError('targetUsername is required');
  if (!selectedRecords || !selectedRecords.length) {
    throw new ValidationError('selectedRecords must be a non-empty array');
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const projectPath = `./export/env-sync-${timestamp}`;

  // Split records: GT_ custom objects sync via direct API; Vlocity objects go through CLI pipeline
  const OBJECT_DEFINITIONS = require('../services/envComparisonService').getObjectDefinitions
    ? null : null; // accessed via service below
  const directApiRecords  = selectedRecords.filter(r => {
    const defs = envComparisonService.getObjectDefinitions();
    const def = defs.find(d => d.objectType === r.objectType);
    return def && def.syncBy === 'directApi';
  });
  const vlocityRecords = selectedRecords.filter(r => {
    const defs = envComparisonService.getObjectDefinitions();
    const def = defs.find(d => d.objectType === r.objectType);
    return !def || def.syncBy !== 'directApi';
  });

  // Build the Vlocity export job file (only for Vlocity records; directApi are skipped internally)
  const hasVlocityRecords = vlocityRecords.length > 0;
  const jobFilePath = hasVlocityRecords
    ? await envComparisonService.buildSyncJobFile(sourceUsername, targetUsername, vlocityRecords, projectPath)
    : null;

  const jobName = `Env Sync: ${sourceUsername} → ${targetUsername} (${selectedRecords.length} records)`;

  // Create the DB job record and register it with the WebSocket monitor
  const job = await jobHistoryService.createJob({
    type: 'export',
    name: jobName,
    status: 'running',
    username: sourceUsername,
    filePath: jobFilePath,
    projectPath,
    sourceUsername,
    targetUsername,
    environment: 'env-comparison',
    cliType: 'vlocity',
    startedAt: new Date(),
    configuration: {
      selectedRecords: selectedRecords.length,
      objectTypes: [...new Set(selectedRecords.map(r => r.objectType))],
    },
  });

  logger.logOperation('Env sync job started', {
    jobId: job.id,
    jobName,
    sourceUsername,
    targetUsername,
    recordCount: selectedRecords.length,
    requestedBy: req.user?.username,
  });

  // Respond immediately — the sync runs in the background
  res.json({
    success: true,
    message: 'Sync job started',
    data: { jobId: job.id, jobName },
  });

  // Run export + deploy asynchronously (fire and forget from the request perspective)
  setImmediate(() => _runSyncPipeline(
    job, jobFilePath, projectPath, sourceUsername, targetUsername,
    directApiRecords, hasVlocityRecords
  ));
}));

/**
 * Internal: runs the two-phase export → deploy pipeline in the background.
 * Also handles GT_ custom objects via direct Salesforce API upsert.
 * All progress is emitted via jobMonitor WebSocket.
 */
async function _runSyncPipeline(job, jobFilePath, projectPath, sourceUsername, targetUsername, directApiRecords = [], hasVlocityRecords = true) {
  try {
    // Phase 0: Sync GT_ custom objects via direct Salesforce REST API
    if (directApiRecords.length > 0) {
      logger.info('Sync pipeline: syncing direct API records', {
        jobId: job.id, count: directApiRecords.length,
      });
      const directResult = await envComparisonService.syncDirectApiRecords(
        sourceUsername, targetUsername, directApiRecords
      );
      logger.info('Sync pipeline: direct API sync complete', { jobId: job.id, ...directResult });

      // If there are no Vlocity records to process, finish the job now
      if (!hasVlocityRecords) {
        const success = directResult.errors === 0;
        await jobHistoryService.completeJob(job.id, { directResult }, success);
        return;
      }
    }

    if (!hasVlocityRecords) {
      await jobHistoryService.completeJob(job.id, { message: 'No Vlocity records to sync' }, true);
      return;
    }

    logger.info('Sync pipeline: starting export', { jobId: job.id, sourceUsername });

    // Phase 1: Export from source
    // Signature: exportDataPacks(username, jobFilePath, jobId)
    const exportResult = await vlocityService.exportDataPacks(
      sourceUsername,
      jobFilePath,
      job.id,
    );

    if (!exportResult.success) {
      await jobHistoryService.completeJob(job.id, exportResult, false);
      logger.warn('Sync pipeline: export failed', { jobId: job.id, error: exportResult });
      return;
    }

    logger.info('Sync pipeline: export complete, starting deploy', {
      jobId: job.id,
      targetUsername,
    });

    // Phase 2: Build and run a deploy job YAML pointing at the same projectPath
    const deployJobConfig = {
      name: job.name,
      projectPath,
      maxDepth: 10,
      continueAfterError: true,
      useAllRelationships: true,
    };

    const deployTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const deployJobFile = require('path').join(
      __dirname,
      '../temp',
      `env-sync-deploy-${deployTimestamp}.yaml`,
    );
    await require('fs-extra').writeFile(
      deployJobFile,
      require('yaml').stringify(deployJobConfig),
      'utf8',
    );

    // Signature: deployDataPacks(username, jobFilePath, jobId, version)
    const deployResult = await vlocityService.deployDataPacks(
      targetUsername,
      deployJobFile,
      job.id,
    );

    await jobHistoryService.completeJob(job.id, deployResult, deployResult.success);

    logger.logOperation('Sync pipeline complete', {
      jobId: job.id,
      success: deployResult.success,
    });
  } catch (err) {
    logger.logError(err, { operation: 'syncPipeline', jobId: job.id });
    try {
      await jobHistoryService.completeJob(job.id, { error: err.message }, false);
    } catch (e) {
      // best-effort
    }
  }
}

module.exports = router;
