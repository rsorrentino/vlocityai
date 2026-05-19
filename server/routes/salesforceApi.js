const express = require('express');
const router = express.Router();
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const salesforceApiService = require('../services/salesforceApiService');

/**
 * @swagger
 * /api/salesforce/auth:
 *   post:
 *     summary: Authenticate with Salesforce
 *     description: Get OAuth access token for Salesforce API operations
 *     tags: [Salesforce API]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 description: Salesforce username
 *               password:
 *                 type: string
 *                 description: Salesforce password
 *               securityToken:
 *                 type: string
 *                 description: Salesforce security token (if required)
 *               isSandbox:
 *                 type: boolean
 *                 description: Whether this is a sandbox org
 *                 default: false
 *     responses:
 *       200:
 *         description: Authentication successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/SalesforceAuth'
 */
router.post('/auth', asyncHandler(async (req, res) => {
  const { username, password, securityToken = null, isSandbox = false } = req.body;
  
  if (!username || !password) {
    throw new ValidationError('Username and password are required');
  }
  
  const tokenData = await salesforceApiService.getAccessToken(username, password, securityToken, isSandbox);
  
  res.json({
    success: true,
    message: 'Authentication successful',
    data: {
      accessToken: tokenData.access_token,
      instanceUrl: tokenData.instance_url,
      id: tokenData.id,
      tokenType: tokenData.token_type,
      issuedAt: tokenData.issued_at,
      signature: tokenData.signature,
      expiresIn: tokenData.expires_in,
      isSandbox
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route GET /api/salesforce/validate/:username
 * @desc Validate Salesforce connection
 * @access Public
 */
router.get('/validate/:username', asyncHandler(async (req, res) => {
  const { username } = req.params;
  const { isSandbox = false } = req.query;
  
  if (!username) {
    throw new ValidationError('Username is required');
  }
  
  const validation = await salesforceApiService.validateConnection(username, isSandbox === 'true');
  
  res.json({
    success: validation.valid,
    message: validation.message,
    data: validation,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route GET /api/salesforce/query
 * @desc Execute SOQL query
 * @access Public
 */
router.get('/query', asyncHandler(async (req, res) => {
  const { soql, username, isSandbox = false } = req.query;
  
  if (!soql) {
    throw new ValidationError('SOQL query is required');
  }
  
  if (!username) {
    throw new ValidationError('Username is required');
  }
  
  const result = await salesforceApiService.query(soql, username, isSandbox === 'true');
  
  res.json({
    success: true,
    message: 'Query executed successfully',
    data: result,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route GET /api/salesforce/search
 * @desc Execute SOSL search
 * @access Public
 */
router.get('/search', asyncHandler(async (req, res) => {
  const { sosl, username, isSandbox = false } = req.query;
  
  if (!sosl) {
    throw new ValidationError('SOSL query is required');
  }
  
  if (!username) {
    throw new ValidationError('Username is required');
  }
  
  const result = await salesforceApiService.search(sosl, username, isSandbox === 'true');
  
  res.json({
    success: true,
    message: 'Search executed successfully',
    data: result,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route GET /api/salesforce/objects/:objectName/metadata
 * @desc Get object metadata
 * @access Public
 */
router.get('/objects/:objectName/metadata', asyncHandler(async (req, res) => {
  const { objectName } = req.params;
  const { username, isSandbox = false } = req.query;
  
  if (!objectName) {
    throw new ValidationError('Object name is required');
  }
  
  if (!username) {
    throw new ValidationError('Username is required');
  }
  
  const result = await salesforceApiService.getObjectMetadata(objectName, username, isSandbox === 'true');
  
  res.json({
    success: true,
    message: 'Object metadata retrieved successfully',
    data: result,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route POST /api/salesforce/objects/:objectName
 * @desc Create record
 * @access Public
 */
router.post('/objects/:objectName', asyncHandler(async (req, res) => {
  const { objectName } = req.params;
  const { recordData, username, isSandbox = false } = req.body;
  
  if (!objectName) {
    throw new ValidationError('Object name is required');
  }
  
  if (!recordData) {
    throw new ValidationError('Record data is required');
  }
  
  if (!username) {
    throw new ValidationError('Username is required');
  }
  
  const result = await salesforceApiService.createRecord(objectName, recordData, username, isSandbox);
  
  res.json({
    success: true,
    message: 'Record created successfully',
    data: result,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route PUT /api/salesforce/objects/:objectName/:recordId
 * @desc Update record
 * @access Public
 */
router.put('/objects/:objectName/:recordId', asyncHandler(async (req, res) => {
  const { objectName, recordId } = req.params;
  const { recordData, username, isSandbox = false } = req.body;
  
  if (!objectName) {
    throw new ValidationError('Object name is required');
  }
  
  if (!recordId) {
    throw new ValidationError('Record ID is required');
  }
  
  if (!recordData) {
    throw new ValidationError('Record data is required');
  }
  
  if (!username) {
    throw new ValidationError('Username is required');
  }
  
  const result = await salesforceApiService.updateRecord(objectName, recordId, recordData, username, isSandbox);
  
  res.json({
    success: true,
    message: 'Record updated successfully',
    data: result,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route DELETE /api/salesforce/objects/:objectName/:recordId
 * @desc Delete record
 * @access Public
 */
router.delete('/objects/:objectName/:recordId', asyncHandler(async (req, res) => {
  const { objectName, recordId } = req.params;
  const { username, isSandbox = false } = req.query;
  
  if (!objectName) {
    throw new ValidationError('Object name is required');
  }
  
  if (!recordId) {
    throw new ValidationError('Record ID is required');
  }
  
  if (!username) {
    throw new ValidationError('Username is required');
  }
  
  const result = await salesforceApiService.deleteRecord(objectName, recordId, username, isSandbox === 'true');
  
  res.json({
    success: true,
    message: 'Record deleted successfully',
    data: result,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route GET /api/salesforce/user/:username
 * @desc Get user info
 * @access Public
 */
router.get('/user/:username', asyncHandler(async (req, res) => {
  const { username } = req.params;
  const { isSandbox = false } = req.query;
  
  if (!username) {
    throw new ValidationError('Username is required');
  }
  
  const result = await salesforceApiService.getUserInfo(username, isSandbox === 'true');
  
  res.json({
    success: true,
    message: 'User info retrieved successfully',
    data: result,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route GET /api/salesforce/limits/:username
 * @desc Get organization limits
 * @access Public
 */
router.get('/limits/:username', asyncHandler(async (req, res) => {
  const { username } = req.params;
  const { isSandbox = false } = req.query;
  
  if (!username) {
    throw new ValidationError('Username is required');
  }
  
  const result = await salesforceApiService.getLimits(username, isSandbox === 'true');
  
  res.json({
    success: true,
    message: 'Limits retrieved successfully',
    data: result,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route POST /api/salesforce/apex/execute
 * @desc Execute Apex code
 * @access Public
 */
router.post('/apex/execute', asyncHandler(async (req, res) => {
  const { apexCode, username, isSandbox = false } = req.body;
  
  if (!apexCode) {
    throw new ValidationError('Apex code is required');
  }
  
  if (!username) {
    throw new ValidationError('Username is required');
  }
  
  const result = await salesforceApiService.executeApex(apexCode, username, isSandbox);
  
  res.json({
    success: true,
    message: 'Apex code executed successfully',
    data: result,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route GET /api/salesforce/versions
 * @desc Get available API versions
 * @access Public
 */
router.get('/versions', asyncHandler(async (req, res) => {
  const result = await salesforceApiService.getApiVersions();
  
  res.json({
    success: true,
    message: 'API versions retrieved successfully',
    data: result,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route GET /api/salesforce/stats
 * @desc Get service statistics
 * @access Public
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const stats = salesforceApiService.getServiceStats();
  
  res.json({
    success: true,
    data: stats,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route POST /api/salesforce/clear-cache
 * @desc Clear token cache
 * @access Public
 */
router.post('/clear-cache', asyncHandler(async (req, res) => {
  salesforceApiService.clearTokenCache();
  
  res.json({
    success: true,
    message: 'Token cache cleared successfully',
    timestamp: new Date().toISOString(),
  });
}));

module.exports = router;
