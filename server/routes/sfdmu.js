const express = require('express');
const path = require('path');
const router = express.Router();
const { asyncHandler, ValidationError, NotFoundError } = require('../middleware/errorHandler');
const { authenticate } = require('../middleware/auth');
const sfdmuService = require('../services/sfdmuService');
const jobHistoryService = require('../services/jobHistoryService');
const { Job, SfdmuConfig } = require('../models');
const logger = require('../utils/logger');

/**
 * @swagger
 * /api/sfdmu/status:
 *   get:
 *     operationId: getSfdmuStatus
 *     summary: Check SFDMU plugin installation status
 *     description: Returns whether the SFDMU Salesforce CLI plugin is installed and available on the server.
 *     tags:
 *       - SFDMU
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Plugin installation status retrieved successfully
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
 *                   properties:
 *                     installed:
 *                       type: boolean
 *                       example: true
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
router.get('/status', authenticate, asyncHandler(async (req, res) => {
  const installed = await sfdmuService.checkSfdmuInstalled();
  res.json({ success: true, data: { installed } });
}));

/**
 * @swagger
 * /api/sfdmu/jobs:
 *   get:
 *     operationId: getSfdmuJobs
 *     summary: List recent SFDMU migration jobs
 *     description: Returns the 20 most recent SFDMU migration jobs, ordered newest first.
 *     tags:
 *       - SFDMU
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of recent SFDMU jobs
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
 *                     $ref: '#/components/schemas/Job'
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
router.get('/jobs', authenticate, asyncHandler(async (req, res) => {
  const jobs = await Job.findAll({
    where: { type: 'sfdmu' },
    order: [['createdAt', 'DESC']],
    limit: 20,
  });
  res.json({ success: true, data: jobs });
}));

/**
 * @swagger
 * /api/sfdmu/run:
 *   post:
 *     operationId: runSfdmuMigration
 *     summary: Start an ad-hoc SFDMU migration job
 *     description: >
 *       Starts an SFDMU data migration job asynchronously. The job is created immediately
 *       and the endpoint returns a job ID; the actual migration runs in the background.
 *       Monitor progress via WebSocket or the jobs endpoint.
 *     tags:
 *       - SFDMU
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
 *               - objects
 *             properties:
 *               sourceUsername:
 *                 type: string
 *                 description: Salesforce org alias or username to migrate data from
 *                 example: source-org@example.com
 *               targetUsername:
 *                 type: string
 *                 description: Salesforce org alias or username to migrate data to
 *                 example: target-org@example.com
 *               objects:
 *                 type: array
 *                 description: Array of SFDMU ScriptObject definitions to migrate
 *                 items:
 *                   type: object
 *                   properties:
 *                     sObjectType:
 *                       type: string
 *                       example: Account
 *                     query:
 *                       type: string
 *                       example: SELECT Id, Name FROM Account
 *                     operation:
 *                       type: string
 *                       enum: [Insert, Update, Upsert, Readonly, Delete, DeleteSource, Hard_Delete]
 *                       example: Upsert
 *               settings:
 *                 type: object
 *                 description: Optional SFDMU job settings overrides
 *                 properties:
 *                   simulationMode:
 *                     type: boolean
 *                     example: false
 *                   allOrNone:
 *                     type: boolean
 *                     example: false
 *     responses:
 *       200:
 *         description: Migration job started successfully
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
 *                   example: Migration job started
 *                 data:
 *                   type: object
 *                   properties:
 *                     jobId:
 *                       type: integer
 *                       example: 42
 *                     jobName:
 *                       type: string
 *                       example: "SFDMU: source-org → target-org (3 objects)"
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
router.post('/run', authenticate, asyncHandler(async (req, res) => {
  const { sourceUsername, targetUsername, objects, settings = {} } = req.body;

  if (!sourceUsername) throw new ValidationError('sourceUsername is required');
  if (!targetUsername) throw new ValidationError('targetUsername is required');
  if (!objects || !objects.length) throw new ValidationError('objects must be a non-empty array');

  const exportConfig = sfdmuService.buildExportJson({ objects, settings });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const workDir = path.resolve(process.cwd(), 'temp', `sfdmu-${timestamp}`);

  const jobName = `SFDMU: ${sourceUsername} → ${targetUsername} (${objects.length} object${objects.length !== 1 ? 's' : ''})`;

  const job = await jobHistoryService.createJob({
    type: 'sfdmu',
    name: jobName,
    status: 'running',
    username: sourceUsername,
    projectPath: workDir,
    sourceUsername,
    targetUsername,
    environment: 'sfdmu',
    cliType: 'sf',
    startedAt: new Date(),
    configuration: {
      objects: objects.map(o => o.sObjectType || o.query),
      simulationMode: exportConfig.simulationMode,
      settings,
    },
  });

  logger.logOperation('SFDMU job started', {
    jobId: job.id,
    jobName,
    sourceUsername,
    targetUsername,
    objectCount: objects.length,
    requestedBy: req.user?.username,
  });

  res.json({
    success: true,
    message: 'Migration job started',
    data: { jobId: job.id, jobName },
  });

  // Run async — fire and forget from request perspective
  setImmediate(async () => {
    try {
      const result = await sfdmuService.runMigration({
        sourceUsername,
        targetUsername,
        exportConfig,
        jobId: job.id,
        workDir,
      });
      await jobHistoryService.completeJob(job.id, result, result.success);
    } catch (err) {
      logger.logError(err, { operation: 'sfdmu run', jobId: job.id });
      try {
        await jobHistoryService.completeJob(job.id, { error: err.message }, false);
      } catch (_) { /* best-effort */ }
    }
  });
}));

// ── Saved Configuration CRUD ────────────────────────────────────────────────

/**
 * @swagger
 * /api/sfdmu/configs:
 *   get:
 *     operationId: listSfdmuConfigs
 *     summary: List all saved SFDMU configurations
 *     description: Returns all saved SFDMU migration configurations, ordered newest first.
 *     tags:
 *       - SFDMU
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of saved SFDMU configurations
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
 *                     $ref: '#/components/schemas/SfdmuConfig'
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
router.get('/configs', authenticate, asyncHandler(async (req, res) => {
  const configs = await SfdmuConfig.findAll({
    order: [['createdAt', 'DESC']],
  });
  res.json({ success: true, data: configs });
}));

/**
 * @swagger
 * /api/sfdmu/configs/import:
 *   post:
 *     operationId: importSfdmuConfig
 *     summary: Import an SFDMU configuration from an export.json body
 *     description: >
 *       Accepts a raw SFDMU export.json object and converts it to an internal
 *       configuration, saving it as a new named configuration. This route must
 *       be defined before /configs/:id to avoid route collision.
 *     tags:
 *       - SFDMU
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - exportJson
 *             properties:
 *               name:
 *                 type: string
 *                 description: Display name for the imported configuration
 *                 example: Production Migration Config
 *               exportJson:
 *                 type: object
 *                 description: Raw SFDMU export.json content
 *                 properties:
 *                   objects:
 *                     type: array
 *                     items:
 *                       type: object
 *                   simulationMode:
 *                     type: boolean
 *                   allOrNone:
 *                     type: boolean
 *     responses:
 *       201:
 *         description: Configuration imported and created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/SfdmuConfig'
 *       400:
 *         description: Validation error — missing or invalid fields
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
router.post('/configs/import', authenticate, asyncHandler(async (req, res) => {
  const { name, exportJson } = req.body;
  if (!name || !name.trim()) throw new ValidationError('name is required');
  if (!exportJson || typeof exportJson !== 'object') throw new ValidationError('exportJson object is required');

  // Convert export.json format → our internal ScriptObject format
  const objects = (exportJson.objects || []).map(o => ({
    sObjectType: extractSObjectType(o.query),
    query: o.query || '',
    operation: o.operation || 'Upsert',
    externalId: o.externalId || 'Name',
    orderBy: o.orderBy || '',
    limit: o.limit || 0,
    offset: o.offset || 0,
    useQueryAll: !!o.useQueryAll,
    deleteOldData: !!o.deleteOldData,
    deleteQuery: o.deleteQuery || '',
    skipExistingRecords: !!o.skipExistingRecords,
    excludedFields: o.excludedFields || [],
    excludedFromUpdateFields: o.excludedFromUpdateFields || [],
    useFieldMapping: !!(o.fieldMapping && o.fieldMapping.length),
    fieldMapping: o.fieldMapping || [],
    updateWithMockData: !!o.updateWithMockData,
    mockFields: o.mockFields || [],
  }));

  const settings = {
    simulationMode: !!exportJson.simulationMode,
    allOrNone: !!exportJson.allOrNone,
    concurrencyMode: exportJson.concurrencyMode || 'Serial',
    bulkThreshold: exportJson.bulkThreshold || 200,
    apiVersion: exportJson.apiVersion || '',
    bulkApiVersion: exportJson.bulkApiVersion || '',
    bulkApiV1BatchSize: exportJson.bulkApiV1BatchSize || 0,
    restApiBatchSize: exportJson.restApiBatchSize || 0,
    parallelBulkJobs: exportJson.parallelBulkJobs || 1,
    parallelRestJobs: exportJson.parallelRestJobs || 1,
    csvReadFileDelimiter: exportJson.csvReadFileDelimiter || '',
    csvWriteFileDelimiter: exportJson.csvWriteFileDelimiter || '',
    createTargetCSVFiles: !!exportJson.createTargetCSVFiles,
    importCSVFilesAsIs: !!exportJson.importCSVFilesAsIs,
    excludeIdsFromCSVFiles: !!exportJson.excludeIdsFromCSVFiles,
    validateCSVFilesOnly: !!exportJson.validateCSVFilesOnly,
    skipRecordsComparison: !!exportJson.skipRecordsComparison,
    allowFieldTruncation: !!exportJson.allowFieldTruncation,
    keepObjectOrderWhileExecute: !!exportJson.keepObjectOrderWhileExecute,
  };

  const config = await SfdmuConfig.create({ name: name.trim(), objects, settings });
  res.status(201).json({ success: true, data: config });
}));

/**
 * @swagger
 * /api/sfdmu/configs:
 *   post:
 *     operationId: createSfdmuConfig
 *     summary: Create a new saved SFDMU configuration
 *     description: Persists a new named SFDMU migration configuration including objects and settings.
 *     tags:
 *       - SFDMU
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: Unique display name for this configuration
 *                 example: Nightly Account Sync
 *               description:
 *                 type: string
 *                 description: Optional human-readable description
 *                 example: Syncs Account and Contact records nightly
 *               sourceUsername:
 *                 type: string
 *                 description: Default source org alias
 *                 example: source-org@example.com
 *               targetUsername:
 *                 type: string
 *                 description: Default target org alias
 *                 example: target-org@example.com
 *               objects:
 *                 type: array
 *                 description: Array of SFDMU ScriptObject definitions
 *                 items:
 *                   type: object
 *               settings:
 *                 type: object
 *                 description: SFDMU job settings
 *     responses:
 *       201:
 *         description: Configuration created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/SfdmuConfig'
 *       400:
 *         description: Validation error — name is required
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
router.post('/configs', authenticate, asyncHandler(async (req, res) => {
  const { name, description, sourceUsername, targetUsername, objects, settings } = req.body;
  if (!name || !name.trim()) throw new ValidationError('name is required');

  const config = await SfdmuConfig.create({
    name: name.trim(),
    description: description || null,
    sourceUsername: sourceUsername || null,
    targetUsername: targetUsername || null,
    objects: objects || [],
    settings: settings || {},
  });

  res.status(201).json({ success: true, data: config });
}));

/**
 * @swagger
 * /api/sfdmu/configs/{id}:
 *   get:
 *     operationId: getSfdmuConfig
 *     summary: Get a single saved SFDMU configuration
 *     description: Retrieves a specific saved SFDMU configuration by its primary key.
 *     tags:
 *       - SFDMU
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The SFDMU configuration ID
 *         example: 1
 *     responses:
 *       200:
 *         description: Configuration retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/SfdmuConfig'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Configuration not found
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
router.get('/configs/:id', authenticate, asyncHandler(async (req, res) => {
  const config = await SfdmuConfig.findByPk(req.params.id);
  if (!config) throw new NotFoundError(`SFDMU config ${req.params.id} not found`);
  res.json({ success: true, data: config });
}));

/**
 * @swagger
 * /api/sfdmu/configs/{id}:
 *   put:
 *     operationId: updateSfdmuConfig
 *     summary: Update a saved SFDMU configuration
 *     description: Performs a partial update on a saved SFDMU configuration. Only provided fields are updated.
 *     tags:
 *       - SFDMU
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The SFDMU configuration ID
 *         example: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: Updated Config Name
 *               description:
 *                 type: string
 *                 example: Updated description
 *               sourceUsername:
 *                 type: string
 *                 example: new-source@example.com
 *               targetUsername:
 *                 type: string
 *                 example: new-target@example.com
 *               objects:
 *                 type: array
 *                 items:
 *                   type: object
 *               settings:
 *                 type: object
 *     responses:
 *       200:
 *         description: Configuration updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/SfdmuConfig'
 *       400:
 *         description: Validation error — name cannot be empty
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
 *         description: Configuration not found
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
router.put('/configs/:id', authenticate, asyncHandler(async (req, res) => {
  const config = await SfdmuConfig.findByPk(req.params.id);
  if (!config) throw new NotFoundError(`SFDMU config ${req.params.id} not found`);

  const { name, description, sourceUsername, targetUsername, objects, settings } = req.body;
  if (name !== undefined && !name.trim()) throw new ValidationError('name cannot be empty');

  await config.update({
    ...(name !== undefined ? { name: name.trim() } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(sourceUsername !== undefined ? { sourceUsername } : {}),
    ...(targetUsername !== undefined ? { targetUsername } : {}),
    ...(objects !== undefined ? { objects } : {}),
    ...(settings !== undefined ? { settings } : {}),
  });

  res.json({ success: true, data: config });
}));

/**
 * @swagger
 * /api/sfdmu/configs/{id}:
 *   delete:
 *     operationId: deleteSfdmuConfig
 *     summary: Delete a saved SFDMU configuration
 *     description: Permanently removes a saved SFDMU configuration from the database.
 *     tags:
 *       - SFDMU
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The SFDMU configuration ID
 *         example: 1
 *     responses:
 *       200:
 *         description: Configuration deleted successfully
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
 *                   example: Configuration deleted
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Configuration not found
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
router.delete('/configs/:id', authenticate, asyncHandler(async (req, res) => {
  const config = await SfdmuConfig.findByPk(req.params.id);
  if (!config) throw new NotFoundError(`SFDMU config ${req.params.id} not found`);
  await config.destroy();
  res.json({ success: true, message: 'Configuration deleted' });
}));

/**
 * @swagger
 * /api/sfdmu/configs/{id}/export:
 *   post:
 *     operationId: exportSfdmuConfig
 *     summary: Export a saved configuration to disk as export.json
 *     description: >
 *       Serialises the saved SFDMU configuration to a standard SFDMU export.json
 *       file on the server filesystem and returns the file path. The path is also
 *       stored back on the configuration record.
 *     tags:
 *       - SFDMU
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The SFDMU configuration ID
 *         example: 1
 *     responses:
 *       200:
 *         description: Configuration exported to disk successfully
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
 *                   properties:
 *                     filePath:
 *                       type: string
 *                       example: /app/sfdmu-configs/1/export.json
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Configuration not found
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
router.post('/configs/:id/export', authenticate, asyncHandler(async (req, res) => {
  const config = await SfdmuConfig.findByPk(req.params.id);
  if (!config) throw new NotFoundError(`SFDMU config ${req.params.id} not found`);

  const dirPath = path.resolve(process.cwd(), 'sfdmu-configs', config.id);
  const filePath = await sfdmuService.saveConfigToFile(config, dirPath);

  // Save the path back so the UI can show it
  await config.update({ filePath });

  res.json({ success: true, data: { filePath } });
}));

/**
 * @swagger
 * /api/sfdmu/configs/{id}/run:
 *   post:
 *     operationId: runSfdmuConfigJob
 *     summary: Run a saved SFDMU configuration as a migration job
 *     description: >
 *       Starts an SFDMU migration job using the settings from a previously saved
 *       configuration. Source and target usernames can be overridden per-request.
 *       The job runs asynchronously; monitor progress via WebSocket or the jobs endpoint.
 *     tags:
 *       - SFDMU
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: The SFDMU configuration ID
 *         example: 1
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               sourceUsername:
 *                 type: string
 *                 description: Override the source org; falls back to the value stored in the config
 *                 example: override-source@example.com
 *               targetUsername:
 *                 type: string
 *                 description: Override the target org; falls back to the value stored in the config
 *                 example: override-target@example.com
 *               settingsOverride:
 *                 type: object
 *                 description: Partial settings to merge over the saved config settings
 *                 properties:
 *                   simulationMode:
 *                     type: boolean
 *                     example: true
 *     responses:
 *       200:
 *         description: Migration job started successfully
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
 *                   example: Migration job started
 *                 data:
 *                   type: object
 *                   properties:
 *                     jobId:
 *                       type: integer
 *                       example: 43
 *                     jobName:
 *                       type: string
 *                       example: "SFDMU: source → target [Nightly Sync] (5 objects)"
 *       400:
 *         description: Validation error — missing username or empty objects
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
 *         description: Configuration not found
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
router.post('/configs/:id/run', authenticate, asyncHandler(async (req, res) => {
  const config = await SfdmuConfig.findByPk(req.params.id);
  if (!config) throw new NotFoundError(`SFDMU config ${req.params.id} not found`);

  const { sourceUsername, targetUsername, settingsOverride = {} } = req.body;

  const src = sourceUsername || config.sourceUsername;
  const tgt = targetUsername || config.targetUsername;

  if (!src) throw new ValidationError('sourceUsername is required (not set in config)');
  if (!tgt) throw new ValidationError('targetUsername is required (not set in config)');
  if (!config.objects || !config.objects.length) throw new ValidationError('Configuration has no objects defined');

  const mergedSettings = { ...config.settings, ...settingsOverride };
  const exportConfig = sfdmuService.buildExportJson({ objects: config.objects, settings: mergedSettings });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const workDir = path.resolve(process.cwd(), 'temp', `sfdmu-${timestamp}`);
  const jobName = `SFDMU: ${src} → ${tgt} [${config.name}] (${config.objects.length} object${config.objects.length !== 1 ? 's' : ''})`;

  const job = await jobHistoryService.createJob({
    type: 'sfdmu',
    name: jobName,
    status: 'running',
    username: src,
    projectPath: workDir,
    sourceUsername: src,
    targetUsername: tgt,
    environment: 'sfdmu',
    cliType: 'sf',
    startedAt: new Date(),
    configuration: {
      sfdmuConfigId: config.id,
      configName: config.name,
      objects: config.objects.map(o => o.sObjectType || o.query),
      simulationMode: exportConfig.simulationMode,
      settings: mergedSettings,
    },
  });

  logger.logOperation('SFDMU config job started', {
    jobId: job.id,
    configId: config.id,
    configName: config.name,
    sourceUsername: src,
    targetUsername: tgt,
    requestedBy: req.user?.username,
  });

  res.json({
    success: true,
    message: 'Migration job started',
    data: { jobId: job.id, jobName },
  });

  setImmediate(async () => {
    try {
      const result = await sfdmuService.runMigration({
        sourceUsername: src,
        targetUsername: tgt,
        exportConfig,
        jobId: job.id,
        workDir,
      });
      await jobHistoryService.completeJob(job.id, result, result.success);
    } catch (err) {
      logger.logError(err, { operation: 'sfdmu config run', jobId: job.id });
      try {
        await jobHistoryService.completeJob(job.id, { error: err.message }, false);
      } catch (_) { /* best-effort */ }
    }
  });
}));

// ── Helper ────────────────────────────────────────────────────────────────────

function extractSObjectType(query) {
  if (!query) return '';
  const match = query.match(/\bFROM\s+(\w+)/i);
  return match ? match[1] : '';
}

module.exports = router;
