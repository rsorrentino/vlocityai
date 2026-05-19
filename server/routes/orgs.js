const express = require('express');
const router = express.Router();
const path = require('path');
const vlocityService = require('../services/vlocityService');
const orgAnalysisService = require('../services/orgAnalysisService');
const productDiagnosticService = require('../services/productDiagnosticService');
const orgService = require('../services/orgService');
const { asyncHandler, NotFoundError, ValidationError } = require('../middleware/errorHandler');
const { validate, schemas } = require('../utils/configValidator');
const logger = require('../utils/logger');
const PropertiesReader = require('../utils/propertiesReader');

// Still load the .properties file for backward-compat PUT /label writes
const propertiesPath = path.join(__dirname, '../../environments.properties');
const properties = new PropertiesReader(propertiesPath);

// ── CLI status ────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/orgs/status:
 *   get:
 *     operationId: getCliStatus
 *     summary: Get Vlocity CLI status
 *     description: Checks whether the Vlocity CLI is installed and returns its version.
 *     tags:
 *       - Salesforce Orgs
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: CLI status retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 available:
 *                   type: boolean
 *                   description: Whether the Vlocity CLI is available on the system.
 *                 version:
 *                   type: string
 *                   nullable: true
 *                   description: CLI version string, or null if unavailable.
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
router.get('/status', asyncHandler(async (req, res) => {
  const isAvailable = await vlocityService.checkAvailability();
  const version = isAvailable ? await vlocityService.getVersion() : null;
  res.json({ available: isAvailable, version, timestamp: new Date().toISOString() });
}));

// ── List orgs from DB ─────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/orgs/list:
 *   get:
 *     operationId: listOrgs
 *     summary: List all orgs
 *     description: Returns all Salesforce org records stored in the database.
 *     tags:
 *       - Salesforce Orgs
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Org list retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 orgs:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Org'
 *                 count:
 *                   type: integer
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
router.get('/list', asyncHandler(async (req, res) => {
  const orgs = await orgService.listOrgs();
  res.json({ orgs, count: orgs.length, timestamp: new Date().toISOString() });
}));

// ── Sync from SF CLI ──────────────────────────────────────────────────────────
// Must be declared before /:username routes to avoid Express matching "sync"

/**
 * @swagger
 * /api/orgs/sync:
 *   post:
 *     operationId: syncOrgsFromCli
 *     summary: Sync orgs from Salesforce CLI
 *     description: Reads the locally authenticated orgs from the Salesforce CLI (`sf org list`) and upserts them into the database.
 *     tags:
 *       - Salesforce Orgs
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Orgs synced successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 added:
 *                   type: integer
 *                 updated:
 *                   type: integer
 *                 total:
 *                   type: integer
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
router.post('/sync', asyncHandler(async (req, res) => {
  const result = await orgService.syncFromCli();
  res.json({ success: true, ...result, timestamp: new Date().toISOString() });
}));

// ── Backward-compat: update label in .properties (still writes file) ──────────
// Must be declared before PUT /:username

/**
 * @swagger
 * /api/orgs/label:
 *   put:
 *     operationId: updateOrgLabel
 *     summary: Update org label (legacy)
 *     description: Writes a display label for an org key into the `environments.properties` file. Provided for backward compatibility with legacy label-based org identification.
 *     tags:
 *       - Salesforce Orgs
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - labelKey
 *             properties:
 *               labelKey:
 *                 type: string
 *                 description: The properties-file key to write.
 *               alias:
 *                 type: string
 *                 description: Human-readable label / alias value. Pass an empty string to clear.
 *     responses:
 *       200:
 *         description: Label updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 labelKey:
 *                   type: string
 *                 alias:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Missing labelKey.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
router.put('/label', asyncHandler(async (req, res) => {
  const { labelKey, alias } = req.body;
  if (!labelKey) throw new ValidationError('labelKey is required');
  properties.saveKey(labelKey, alias || '');
  res.json({ success: true, labelKey, alias: alias || '', timestamp: new Date().toISOString() });
}));

// ── Validate org connection ───────────────────────────────────────────────────

/**
 * @swagger
 * /api/orgs/validate:
 *   post:
 *     operationId: validateOrgConnection
 *     summary: Validate org connection
 *     description: Tests connectivity to a Salesforce org by running a lightweight Vlocity CLI command. Does not persist the result.
 *     tags:
 *       - Salesforce Orgs
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
 *                 description: Salesforce org username or alias.
 *     responses:
 *       200:
 *         description: Org connection validated.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                 username:
 *                   type: string
 *                 message:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Validation failed — org is unreachable.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 valid:
 *                   type: boolean
 *                   example: false
 *                 username:
 *                   type: string
 *                 error:
 *                   type: string
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
router.post('/validate', validate(schemas.org), asyncHandler(async (req, res) => {
  const { username } = req.body;
  try {
    await vlocityService.executeCommand('--help', { username });
    res.json({ valid: true, username, message: 'Org connection validated successfully', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(400).json({ valid: false, username, error: error.message, timestamp: new Date().toISOString() });
  }
}));

// ── Test connection (persists result to DB) ───────────────────────────────────

/**
 * @swagger
 * /api/orgs/test-connection:
 *   post:
 *     operationId: testOrgConnection
 *     summary: Test and persist org connection
 *     description: Authenticates against the Salesforce org using the SF CLI, retrieves org metadata, and persists the test result to the database.
 *     tags:
 *       - Salesforce Orgs
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
 *                 description: Salesforce org username or alias.
 *     responses:
 *       200:
 *         description: Connection test passed.
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
 *                 username:
 *                   type: string
 *                 orgInfo:
 *                   type: object
 *                   properties:
 *                     username:
 *                       type: string
 *                     alias:
 *                       type: string
 *                     orgId:
 *                       type: string
 *                     instanceUrl:
 *                       type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Connection test failed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                 username:
 *                   type: string
 *                 authError:
 *                   type: string
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
router.post('/test-connection', asyncHandler(async (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ success: false, message: 'Username is required', timestamp: new Date().toISOString() });
  }

  try {
    const sfdxAuthService = require('../services/sfdxAuthService');
    const testResult = await sfdxAuthService.testConnection(username);

    // Persist test result to DB (best-effort — don't fail if org not in DB yet)
    await orgService.recordTestResult(username, {
      success: testResult.success,
      message: testResult.message,
      orgInfo: testResult.success ? testResult.orgInfo : null,
    }).catch(err => logger.warn('Failed to persist test result', { username, err: err.message }));

    if (testResult.success) {
      logger.logOperation('Org connection test', { username, success: true, orgId: testResult.orgInfo?.orgId });
      return res.json({
        success: true, message: testResult.message, username,
        orgInfo: {
          username: testResult.orgInfo?.username,
          alias: testResult.orgInfo?.alias,
          orgId: testResult.orgInfo?.orgId,
          instanceUrl: testResult.orgInfo?.instanceUrl,
        },
        timestamp: new Date().toISOString(),
      });
    }

    logger.logOperation('Org connection test', { username, success: false, error: testResult.message });
    const response = { success: false, message: testResult.message, username, timestamp: new Date().toISOString() };
    if (testResult.authError) response.authError = testResult.authError;
    return res.status(400).json(response);
  } catch (error) {
    logger.logError(error, { operation: 'testConnection', username });
    return res.status(500).json({ success: false, message: error.message, username, timestamp: new Date().toISOString() });
  }
}));

// ── Update org metadata (label, environment, notes) ──────────────────────────

/**
 * @swagger
 * /api/orgs/{username}:
 *   put:
 *     operationId: updateOrg
 *     summary: Update org metadata
 *     description: Updates the label, environment classification, and/or notes for an org record in the database.
 *     tags:
 *       - Salesforce Orgs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         description: URL-encoded Salesforce org username.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               label:
 *                 type: string
 *                 description: Human-readable display label for the org.
 *               environment:
 *                 type: string
 *                 description: Environment classification (e.g. dev, uat, prod).
 *               notes:
 *                 type: string
 *                 description: Free-text notes about the org.
 *     responses:
 *       200:
 *         description: Org updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 username:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Org not found.
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
router.put('/:username', asyncHandler(async (req, res) => {
  const username = decodeURIComponent(req.params.username);
  const { label, environment, notes } = req.body;
  try {
    await orgService.updateOrg(username, { label, environment, notes });
    res.json({ success: true, username, timestamp: new Date().toISOString() });
  } catch (err) {
    if (err.message.startsWith('Org not found')) throw new NotFoundError(err.message);
    throw err;
  }
}));

// ── Delete org from DB (does NOT revoke SF CLI auth) ─────────────────────────

/**
 * @swagger
 * /api/orgs/{username}:
 *   delete:
 *     operationId: deleteOrg
 *     summary: Delete an org record
 *     description: Removes an org record from the database. Does NOT revoke the Salesforce CLI authentication.
 *     tags:
 *       - Salesforce Orgs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         description: URL-encoded Salesforce org username.
 *     responses:
 *       200:
 *         description: Org deleted successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 username:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Org not found.
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
router.delete('/:username', asyncHandler(async (req, res) => {
  const username = decodeURIComponent(req.params.username);
  await orgService.deleteOrg(username);
  res.json({ success: true, username, timestamp: new Date().toISOString() });
}));

// ── Org info (legacy sfdx command) ───────────────────────────────────────────

/**
 * @swagger
 * /api/orgs/{username}/info:
 *   get:
 *     operationId: getOrgInfo
 *     summary: Get org info (legacy)
 *     description: Retrieves detailed org metadata via the legacy `sfdx force:org:display` command.
 *     tags:
 *       - Salesforce Orgs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce org username or alias.
 *     responses:
 *       200:
 *         description: Org info retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 username:
 *                   type: string
 *                 orgInfo:
 *                   type: object
 *                   description: Raw result from sfdx force:org:display.
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Failed to retrieve org info.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 username:
 *                   type: string
 *                 error:
 *                   type: string
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
router.get('/:username/info', asyncHandler(async (req, res) => {
  const { username } = req.params;
  try {
    const { spawn } = require('child_process');
    const result = await new Promise((resolve, reject) => {
      const child = spawn('sfdx', ['force:org:display', '-u', username, '--json'], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', d => { stdout += d.toString(); });
      child.stderr.on('data', d => { stderr += d.toString(); });
      child.on('close', code => {
        if (code === 0) {
          try { resolve(JSON.parse(stdout).result); }
          catch { reject(new Error('Failed to parse org information')); }
        } else {
          reject(new Error(`Failed to get org info: ${stderr}`));
        }
      });
    });
    res.json({ success: true, username, orgInfo: result, timestamp: new Date().toISOString() });
  } catch (error) {
    logger.logError(error, { operation: 'getOrgInfo', username });
    res.status(400).json({ success: false, username, error: error.message, timestamp: new Date().toISOString() });
  }
}));

// ── Org analysis ──────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/orgs/{username}/analyze:
 *   post:
 *     operationId: analyzeOrg
 *     summary: Analyse a Salesforce org
 *     description: Runs a deep analysis of the org's DataPack types, record counts, and health indicators. Results are persisted to the database.
 *     tags:
 *       - Salesforce Orgs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce org username or alias.
 *     responses:
 *       200:
 *         description: Analysis completed successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 analysis:
 *                   type: object
 *                   description: Detailed org analysis result.
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
 *         description: Analysis failed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/:username/analyze', asyncHandler(async (req, res) => {
  const { username } = req.params;
  try {
    const analysis = await orgAnalysisService.analyzeOrg(username);
    res.json({ success: true, analysis, timestamp: new Date().toISOString() });
  } catch (error) {
    logger.logError(error, { operation: 'orgAnalysis', username });
    res.status(500).json({ success: false, username, error: error.message, timestamp: new Date().toISOString() });
  }
}));

/**
 * @swagger
 * /api/orgs/{username}/analysis-history:
 *   get:
 *     operationId: getOrgAnalysisHistory
 *     summary: Get org analysis history
 *     description: Returns previous org analysis runs for the given username, ordered most-recent first.
 *     tags:
 *       - Salesforce Orgs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce org username or alias.
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Maximum number of history entries to return.
 *     responses:
 *       200:
 *         description: Analysis history retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 username:
 *                   type: string
 *                 history:
 *                   type: array
 *                   items:
 *                     type: object
 *                 count:
 *                   type: integer
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
router.get('/:username/analysis-history', asyncHandler(async (req, res) => {
  const { username } = req.params;
  const { limit = 10 } = req.query;
  try {
    const history = await orgAnalysisService.getAnalysisHistory(username, parseInt(limit));
    res.json({ success: true, username, history, count: history.length, timestamp: new Date().toISOString() });
  } catch (error) {
    logger.logError(error, { operation: 'getAnalysisHistory', username });
    res.status(500).json({ success: false, username, error: error.message, timestamp: new Date().toISOString() });
  }
}));

// ── Product diagnostic ────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/orgs/{username}/products/{productId}/diagnose:
 *   post:
 *     operationId: diagnoseProduct
 *     summary: Diagnose a product
 *     description: Runs diagnostic checks on a specific Salesforce product record, examining related pricing, attributes, and catalog relationships.
 *     tags:
 *       - Salesforce Orgs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce org username or alias.
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce Product2 record ID.
 *     responses:
 *       200:
 *         description: Diagnostics completed successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 diagnostics:
 *                   type: object
 *                   description: Diagnostic results keyed by check category.
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Username or productId missing.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Diagnostic failed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/:username/products/:productId/diagnose', asyncHandler(async (req, res) => {
  const { username, productId } = req.params;
  if (!username || !productId) throw new ValidationError('Username and productId are required');
  try {
    const diagnostics = await productDiagnosticService.diagnoseProduct(productId, username);
    res.json({ success: true, diagnostics, timestamp: new Date().toISOString() });
  } catch (error) {
    logger.logError(error, { operation: 'diagnoseProduct', username, productId });
    throw error;
  }
}));

module.exports = router;
