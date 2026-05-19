const express = require('express');
const router = express.Router();
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const validationService = require('../services/validationService');
const validationFixService = require('../services/validationFixService');
const salesforceService = require('../services/salesforceService');
const countryConfigService = require('../services/countryConfigService');
const logger = require('../utils/logger');
const { ValidationRuleEngine } = require('../services/validationRuleEngine');
const {
  duplicatePricingElementRule,
  duplicatePriceListEntryRule,
  duplicateOfferRule,
  missingOfferPriceRule,
  haZeroPriceRule,
  skuFormatRule,
  asyncApexJobFailureRule,
} = require('../validators/pricingValidators');
const { duplicateCatalogProductRelationshipRule } = require('../validators/catalogValidators');
const {
  repairProductPicklistRule,
  repairProductFieldsRule,
  repairSupplierAttributeRule,
} = require('../validators/repairProductValidators');
const {
  missingGtObjectLayoutRule,
  invalidRecordTypeIdRule,
  pricingElementTriggerRule,
  inactiveCalculationProceduresRule,
} = require('../validators/deploymentValidators');

// ── Pre-built rule engines for each validation category ──────────────────────

const pricingEngine = new ValidationRuleEngine().registerRules([
  duplicatePricingElementRule,
  duplicatePriceListEntryRule,
  duplicateOfferRule,
  missingOfferPriceRule,
  haZeroPriceRule,
  skuFormatRule,
  asyncApexJobFailureRule,
]);

const catalogEngine = new ValidationRuleEngine().registerRules([
  duplicateCatalogProductRelationshipRule,
]);

const repairEngine = new ValidationRuleEngine().registerRules([
  repairProductPicklistRule,
  repairProductFieldsRule,
  repairSupplierAttributeRule,
]);

const deployEngine = new ValidationRuleEngine().registerRules([
  missingGtObjectLayoutRule,
  invalidRecordTypeIdRule,
  pricingElementTriggerRule,
  inactiveCalculationProceduresRule,
]);

/**
 * @swagger
 * /api/validation/run:
 *   get:
 *     operationId: runValidation
 *     summary: Run comprehensive pricing system validation
 *     description: >
 *       Executes all registered pricing, catalog, repair-product, and deployment
 *       validation rules against the specified Salesforce org. Optionally filters
 *       results to a single country code.
 *     tags:
 *       - Validation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         description: SFDX username of the target Salesforce org
 *         example: admin@myorg.com
 *       - in: query
 *         name: isSandbox
 *         required: false
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Whether the org is a sandbox
 *       - in: query
 *         name: countryCode
 *         required: false
 *         schema:
 *           type: string
 *         description: ISO country code to scope the validation (e.g. AU, US)
 *         example: AU
 *       - in: query
 *         name: options
 *         required: false
 *         schema:
 *           type: string
 *         description: JSON-encoded options object passed to the validation service
 *     responses:
 *       200:
 *         description: Validation completed successfully
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
 *                   description: Validation results including summary, errors, warnings, and instanceUrl
 *                 message:
 *                   type: string
 *                   example: Validation completed successfully
 *       400:
 *         description: Missing or invalid query parameters
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
 *         description: Validation run failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * @route GET /api/validation/run
 * @desc Run comprehensive validation on pricing system
 * @access Private
 */
router.get('/run', asyncHandler(async (req, res) => {
  const { username, isSandbox = false, countryCode, options = {} } = req.query;

  if (!username) {
    throw new ValidationError('Username is required');
  }

  // Validate country code if provided
  if (countryCode) {
    const known = countryConfigService.getCountryCodes();
    if (!known.includes(countryCode.toUpperCase())) {
      throw new ValidationError(`Unknown country code: ${countryCode}. Valid codes: ${known.join(', ')}`);
    }
  }

  const runOptions = typeof options === 'string' ? JSON.parse(options) : options;
  if (countryCode) runOptions.countryCode = countryCode.toUpperCase();

  logger.info('Starting validation run', { username, isSandbox, countryCode: countryCode || 'all' });

  try {
    const results = await validationService.validatePricingSystem(username, isSandbox === 'true', runOptions);
    // salesforceService is the same singleton used by validationService, so instanceUrl
    // is already set after any successful query during the validation run.
    const instanceUrl = salesforceService.getInstanceUrl() || null;

    res.json({
      success: true,
      data: { ...results, instanceUrl },
      message: 'Validation completed successfully'
    });

  } catch (error) {
    logger.error('Validation run failed', { error: error.message, username });
    throw error;
  }
}));

/**
 * @swagger
 * /api/validation/countries:
 *   get:
 *     operationId: getValidationCountries
 *     summary: List configured countries
 *     description: >
 *       Returns all countries configured in the country-config service together
 *       with their currency and validation metadata. Used by the dashboard
 *       country selector.
 *     tags:
 *       - Validation
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Country list returned successfully
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
 *                       code:
 *                         type: string
 *                         example: AU
 *                       name:
 *                         type: string
 *                         example: Australia
 *                       currency:
 *                         type: string
 *                         example: AUD
 *                       validation:
 *                         type: object
 *                         nullable: true
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
 * @route GET /api/validation/countries
 * @desc Return the list of configured countries with their validation metadata.
 *       Used by the dashboard country selector.
 * @access Private
 */
router.get('/countries', asyncHandler(async (req, res) => {
  const countries = countryConfigService.getAllCountries().map(c => ({
    code: c.code,
    name: c.name,
    currency: c.currency,
    validation: c.validation || null,
  }));
  res.json({ success: true, data: countries });
}));

/**
 * @swagger
 * /api/validation/status:
 *   get:
 *     operationId: getValidationStatus
 *     summary: Get validation status summary
 *     description: >
 *       Runs a quick validation pass and returns a high-level status summary
 *       including overall status, check counts, warnings, and category
 *       breakdowns.
 *     tags:
 *       - Validation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         description: SFDX username of the target Salesforce org
 *     responses:
 *       200:
 *         description: Validation status returned
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
 *                     status:
 *                       type: string
 *                       example: PASS
 *                     lastRun:
 *                       type: string
 *                       format: date-time
 *                     totalChecks:
 *                       type: integer
 *                     passedChecks:
 *                       type: integer
 *                     failedChecks:
 *                       type: integer
 *                     warnings:
 *                       type: integer
 *                     categories:
 *                       type: array
 *                       items:
 *                         type: object
 *                     recommendations:
 *                       type: array
 *                       items:
 *                         type: string
 *       400:
 *         description: username is required
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
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * @route GET /api/validation/status
 * @desc Get validation status and summary
 * @access Private
 */
router.get('/status', asyncHandler(async (req, res) => {
  const { username } = req.query;
  
  if (!username) {
    throw new ValidationError('Username is required');
  }
  
  try {
    // Get the latest validation results (in a real implementation, you'd store this in a database)
    const results = await validationService.validatePricingSystem(username, false, { quick: true });
    
    res.json({
      success: true,
      data: {
        status: results.summary.overallStatus,
        lastRun: results.timestamp,
        totalChecks: results.totalChecks,
        passedChecks: results.passedChecks,
        failedChecks: results.failedChecks,
        warnings: results.warnings.length,
        categories: results.summary.categories,
        recommendations: results.summary.recommendations
      }
    });
    
  } catch (error) {
    logger.error('Failed to get validation status', { error: error.message, username });
    throw error;
  }
}));

/**
 * @swagger
 * /api/validation/fix:
 *   post:
 *     operationId: applyValidationFix
 *     summary: Apply a simple validation fix
 *     description: >
 *       Applies a pre-defined fix for a named validation check, such as
 *       assigning GlobalKeys or deleting orphaned records.
 *     tags:
 *       - Validation
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
 *               - checkName
 *             properties:
 *               username:
 *                 type: string
 *                 description: SFDX username of the target Salesforce org
 *                 example: admin@myorg.com
 *               checkName:
 *                 type: string
 *                 description: Identifier of the validation check to fix
 *                 example: duplicatePricingElement
 *     responses:
 *       200:
 *         description: Fix applied successfully
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
 *                 message:
 *                   type: string
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
 *         description: Fix operation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * @route POST /api/validation/fix
 * @desc Apply a simple fix (assign GlobalKeys or delete orphaned records) for a single check.
 * @body { username, checkName }
 * @access Private
 */
router.post('/fix', asyncHandler(async (req, res) => {
  const { username, checkName } = req.body;

  if (!username) throw new ValidationError('username is required');
  if (!checkName) throw new ValidationError('checkName is required');

  logger.info('Applying validation fix', { username, checkName });
  const result = await validationFixService.applyFix(username, checkName);
  res.json({ success: true, data: result, message: result.message });
}));

/**
 * @swagger
 * /api/validation/preview-fix:
 *   post:
 *     operationId: previewValidationFix
 *     summary: Preview a validation fix (dry run)
 *     description: >
 *       Returns a dry-run preview showing how many records would be affected
 *       by applying the fix for the named validation check, without making
 *       any changes.
 *     tags:
 *       - Validation
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
 *               - checkName
 *             properties:
 *               username:
 *                 type: string
 *                 description: SFDX username of the target Salesforce org
 *                 example: admin@myorg.com
 *               checkName:
 *                 type: string
 *                 description: Identifier of the validation check to preview
 *                 example: duplicatePricingElement
 *     responses:
 *       200:
 *         description: Preview generated successfully
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
 *                   description: Preview result with affected record counts
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
 *         description: Preview failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * @route POST /api/validation/preview-fix
 * @desc Preview how many records would be affected by a simple fix (dry run).
 * @body { username, checkName }
 * @access Private
 */
router.post('/preview-fix', asyncHandler(async (req, res) => {
  const { username, checkName } = req.body;

  if (!username) throw new ValidationError('username is required');
  if (!checkName) throw new ValidationError('checkName is required');

  const preview = await validationFixService.previewFix(username, checkName);
  res.json({ success: true, data: preview });
}));

/**
 * @swagger
 * /api/validation/duplicate-groups:
 *   get:
 *     operationId: getDuplicateGroups
 *     summary: Load duplicate record groups
 *     description: >
 *       Retrieves grouped duplicate records for the specified validation check,
 *       intended for display in the duplicate-review dialog so users can choose
 *       which records to keep.
 *     tags:
 *       - Validation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         description: SFDX username of the target Salesforce org
 *       - in: query
 *         name: checkName
 *         required: true
 *         schema:
 *           type: string
 *         description: Identifier of the duplicate-check to load groups for
 *         example: duplicatePricingElement
 *     responses:
 *       200:
 *         description: Duplicate groups returned successfully
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
 *                     description: A group of duplicate records sharing the same key
 *       400:
 *         description: Missing required query parameters
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
 *         description: Failed to load duplicate groups
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * @route GET /api/validation/duplicate-groups
 * @desc Load duplicate record groups for the review dialog.
 * @query { username, checkName }
 * @access Private
 */
router.get('/duplicate-groups', asyncHandler(async (req, res) => {
  const { username, checkName } = req.query;

  if (!username) throw new ValidationError('username is required');
  if (!checkName) throw new ValidationError('checkName is required');

  logger.info('Loading duplicate groups', { username, checkName });
  const data = await validationFixService.getDuplicateGroups(username, checkName);
  res.json({ success: true, data });
}));

/**
 * @swagger
 * /api/validation/resolve-duplicates:
 *   post:
 *     operationId: resolveDuplicates
 *     summary: Delete user-selected duplicate records
 *     description: >
 *       Deletes the records the user has marked for removal from a duplicate
 *       group, preserving the records they chose to keep.
 *     tags:
 *       - Validation
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
 *               - checkName
 *               - deleteIds
 *             properties:
 *               username:
 *                 type: string
 *                 description: SFDX username of the target Salesforce org
 *                 example: admin@myorg.com
 *               checkName:
 *                 type: string
 *                 description: Identifier of the duplicate check being resolved
 *                 example: duplicatePricingElement
 *               deleteIds:
 *                 type: array
 *                 description: Salesforce record IDs to delete
 *                 items:
 *                   type: string
 *                 example:
 *                   - a0B000000ABC001
 *                   - a0B000000ABC002
 *     responses:
 *       200:
 *         description: Duplicates resolved successfully
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
 *                 message:
 *                   type: string
 *       400:
 *         description: Missing or invalid request body
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
 *         description: Resolution failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * @route POST /api/validation/resolve-duplicates
 * @desc Delete the records the user selected for removal (keeping their chosen keepers).
 * @body { username, checkName, deleteIds: string[] }
 * @access Private
 */
router.post('/resolve-duplicates', asyncHandler(async (req, res) => {
  const { username, checkName, deleteIds } = req.body;

  if (!username) throw new ValidationError('username is required');
  if (!checkName) throw new ValidationError('checkName is required');
  if (!Array.isArray(deleteIds)) throw new ValidationError('deleteIds must be an array');

  logger.info('Resolving duplicate records', { username, checkName, count: deleteIds.length });
  const result = await validationFixService.resolveSelectedDuplicates(username, checkName, deleteIds);
  res.json({ success: true, data: result, message: result.message });
}));

/**
 * @swagger
 * /api/validation/report:
 *   get:
 *     operationId: getValidationReport
 *     summary: Generate a detailed validation report
 *     description: >
 *       Runs a full validation pass and returns the results as either a JSON
 *       report with a calculated health score, or a CSV file download.
 *     tags:
 *       - Validation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         description: SFDX username of the target Salesforce org
 *       - in: query
 *         name: format
 *         required: false
 *         schema:
 *           type: string
 *           enum:
 *             - json
 *             - csv
 *           default: json
 *         description: Response format — json returns a report object, csv triggers a file download
 *     responses:
 *       200:
 *         description: Report generated successfully
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
 *                     report:
 *                       type: object
 *                     generatedAt:
 *                       type: string
 *                       format: date-time
 *                     summary:
 *                       type: object
 *                       properties:
 *                         totalIssues:
 *                           type: integer
 *                         criticalIssues:
 *                           type: integer
 *                         warnings:
 *                           type: integer
 *                         overallHealth:
 *                           type: integer
 *                           description: Health score 0-100
 *           text/csv:
 *             schema:
 *               type: string
 *               description: CSV report attachment
 *       400:
 *         description: Missing required parameters
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
 *         description: Report generation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * @route GET /api/validation/report
 * @desc Generate detailed validation report
 * @access Private
 */
router.get('/report', asyncHandler(async (req, res) => {
  const { username, format = 'json' } = req.query;
  
  if (!username) {
    throw new ValidationError('Username is required');
  }
  
  try {
    const results = await validationService.validatePricingSystem(username, false);
    
    if (format === 'csv') {
      // Generate CSV report
      const csvData = generateCSVReport(results);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="validation-report-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csvData);
      
    } else {
      // Return JSON report
      res.json({
        success: true,
        data: {
          report: results,
          generatedAt: new Date().toISOString(),
          summary: {
            totalIssues: results.failedChecks + results.warnings.length,
            criticalIssues: results.failedChecks,
            warnings: results.warnings.length,
            overallHealth: calculateHealthScore(results)
          }
        }
      });
    }
    
  } catch (error) {
    logger.error('Failed to generate validation report', { error: error.message, username });
    throw error;
  }
}));

/**
 * @swagger
 * /api/validation/categories:
 *   get:
 *     operationId: getValidationCategories
 *     summary: Get validation categories and their status
 *     description: >
 *       Runs a full validation pass and returns a breakdown of categories
 *       (pricing, catalog, repair-product, deployment) with pass/fail counts.
 *     tags:
 *       - Validation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         description: SFDX username of the target Salesforce org
 *     responses:
 *       200:
 *         description: Categories returned successfully
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
 *                     categories:
 *                       type: array
 *                       items:
 *                         type: object
 *                     totalCategories:
 *                       type: integer
 *                     healthyCategories:
 *                       type: integer
 *                     unhealthyCategories:
 *                       type: integer
 *       400:
 *         description: username is required
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
 *         description: Failed to get categories
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * @route GET /api/validation/categories
 * @desc Get validation categories and their status
 * @access Private
 */
router.get('/categories', asyncHandler(async (req, res) => {
  const { username } = req.query;
  
  if (!username) {
    throw new ValidationError('Username is required');
  }
  
  try {
    const results = await validationService.validatePricingSystem(username, false);
    
    res.json({
      success: true,
      data: {
        categories: results.summary.categories,
        totalCategories: results.summary.categories.length,
        healthyCategories: results.summary.categories.filter(c => c.status === 'PASS').length,
        unhealthyCategories: results.summary.categories.filter(c => c.status === 'FAIL').length
      }
    });
    
  } catch (error) {
    logger.error('Failed to get validation categories', { error: error.message, username });
    throw error;
  }
}));

/**
 * @swagger
 * /api/validation/yaml-tests:
 *   get:
 *     operationId: runYamlTests
 *     summary: Run YAML-based validation tests
 *     description: >
 *       Executes only the YAML-defined validation tests. Optionally limits
 *       execution to the specified comma-separated list of object types.
 *     tags:
 *       - Validation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         description: SFDX username of the target Salesforce org
 *       - in: query
 *         name: objectTypes
 *         required: false
 *         schema:
 *           type: string
 *         description: Comma-separated list of object types to test (defaults to all)
 *         example: Product2,PriceListEntry
 *     responses:
 *       200:
 *         description: YAML tests completed
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
 *                   description: Test results grouped by object type
 *                 message:
 *                   type: string
 *                   example: YAML validation tests completed
 *       400:
 *         description: username is required
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
 *         description: YAML tests failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * @route GET /api/validation/yaml-tests
 * @desc Run YAML-based validation tests only
 * @access Private
 */
router.get('/yaml-tests', asyncHandler(async (req, res) => {
  const { username, objectTypes } = req.query;
  
  if (!username) {
    throw new ValidationError('Username is required');
  }
  
  try {
    const typesArray = objectTypes ? objectTypes.split(',') : null;
    const results = await validationService.runYamlTests(username, typesArray);
    
    res.json({
      success: true,
      data: results,
      message: 'YAML validation tests completed'
    });
    
  } catch (error) {
    logger.error('YAML tests failed', { error: error.message, username });
    throw error;
  }
}));

/**
 * @swagger
 * /api/validation/test-definitions:
 *   get:
 *     operationId: getTestDefinitions
 *     summary: Get available YAML test definitions
 *     description: >
 *       Returns a catalogue of all test definitions registered in the
 *       validation service, grouped by SObject type, with name, description,
 *       and severity for each test.
 *     tags:
 *       - Validation
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Test definitions returned
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
 *                     definitions:
 *                       type: object
 *                       additionalProperties:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             name:
 *                               type: string
 *                             description:
 *                               type: string
 *                             severity:
 *                               type: string
 *                     totalObjectTypes:
 *                       type: integer
 *                     totalTests:
 *                       type: integer
 *       401:
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Failed to retrieve test definitions
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * @route GET /api/validation/test-definitions
 * @desc Get available test definitions
 * @access Private
 */
router.get('/test-definitions', asyncHandler(async (req, res) => {
  try {
    const definitions = {};
    
    Object.keys(validationService.testDefinitions).forEach(objectType => {
      definitions[objectType] = validationService.testDefinitions[objectType].tests.map(t => ({
        name: t.name,
        description: t.description,
        severity: t.severity
      }));
    });
    
    res.json({
      success: true,
      data: {
        definitions,
        totalObjectTypes: Object.keys(definitions).length,
        totalTests: Object.values(definitions).reduce((sum, tests) => sum + tests.length, 0)
      }
    });
    
  } catch (error) {
    logger.error('Failed to get test definitions', { error: error.message });
    throw error;
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// Rule-Engine Endpoints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/validation/pricing:
 *   post:
 *     operationId: runPricingValidation
 *     summary: Run pricing rule-engine validators
 *     description: >
 *       Executes the pricing rule engine (rules 1-4, 12-14) covering duplicate
 *       PricingElements, duplicate PriceListEntries, duplicate Offers, missing
 *       offer prices, zero-price HA records, SKU format, and AsyncApex job
 *       failures. Optionally restricts to a subset of rule IDs.
 *     tags:
 *       - Validation
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
 *                 description: SFDX username of the target Salesforce org
 *               context:
 *                 type: object
 *                 description: Contextual data passed to each rule
 *                 properties:
 *                   productId:
 *                     type: string
 *                   pricingPlanId:
 *                     type: string
 *                   pricingVariableId:
 *                     type: string
 *                   pricingElementName:
 *                     type: string
 *                   pricebookId:
 *                     type: string
 *                   currencyIsoCode:
 *                     type: string
 *                   productName:
 *                     type: string
 *                   sku:
 *                     type: string
 *                   offerCode:
 *                     type: string
 *                   price:
 *                     type: number
 *                   productType:
 *                     type: string
 *                   apexJobId:
 *                     type: string
 *               countryCode:
 *                 type: string
 *                 description: ISO country code to scope results
 *               rules:
 *                 type: array
 *                 description: Subset of rule IDs to execute (defaults to all)
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Pricing validation completed
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
 *                   description: Rule engine results per rule
 *       400:
 *         description: username is required
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
 *         description: Pricing validation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * @route POST /api/validation/pricing
 * @desc Run pricing validators (rules 1–4, 12–14)
 * @body { username, context: { productId?, pricingPlanId?, pricingVariableId?,
 *         pricingElementName?, productId?, pricebookId?, currencyIsoCode?,
 *         productName?, sku?, offerCode?, price?, productType?, apexJobId? },
 *         rules?: string[] }
 */
router.post('/pricing', asyncHandler(async (req, res) => {
  const { username, context = {}, rules, countryCode } = req.body;
  if (!username) throw new ValidationError('username is required');

  const ctx = { ...context, countryCode: countryCode || context.countryCode || null };
  logger.info('Pricing validation run', { username, rules, countryCode: ctx.countryCode || 'all' });
  const result = await pricingEngine.run(username, ctx, rules);
  res.json({ success: true, data: result });
}));

/**
 * @swagger
 * /api/validation/catalog:
 *   post:
 *     operationId: runCatalogValidation
 *     summary: Run catalog rule-engine validators
 *     description: >
 *       Executes the catalog rule engine (rule 15 — duplicate
 *       CatalogProductRelationship). Optionally restricts to a subset of
 *       rule IDs.
 *     tags:
 *       - Validation
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
 *                 description: SFDX username of the target Salesforce org
 *               context:
 *                 type: object
 *                 properties:
 *                   catalogId:
 *                     type: string
 *                   productId:
 *                     type: string
 *                   relationshipType:
 *                     type: string
 *               countryCode:
 *                 type: string
 *               rules:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Catalog validation completed
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
 *         description: username is required
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
 *         description: Catalog validation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * @route POST /api/validation/catalog
 * @desc Run catalog validators (rule 15 – duplicate CatalogProductRelationship)
 * @body { username, context: { catalogId, productId, relationshipType? }, countryCode?, rules?: string[] }
 */
router.post('/catalog', asyncHandler(async (req, res) => {
  const { username, context = {}, rules, countryCode } = req.body;
  if (!username) throw new ValidationError('username is required');

  const ctx = { ...context, countryCode: countryCode || context.countryCode || null };
  logger.info('Catalog validation run', { username, rules, countryCode: ctx.countryCode || 'all' });
  const result = await catalogEngine.run(username, ctx, rules);
  res.json({ success: true, data: result });
}));

/**
 * @swagger
 * /api/validation/repair-product:
 *   post:
 *     operationId: runRepairProductValidation
 *     summary: Run repair-product rule-engine validators
 *     description: >
 *       Executes the repair-product rule engine (rules 5-7) covering picklist
 *       values, required field presence, and supplier attribute correctness.
 *     tags:
 *       - Validation
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
 *                 description: SFDX username of the target Salesforce org
 *               context:
 *                 type: object
 *                 properties:
 *                   productId:
 *                     type: string
 *                   data:
 *                     type: object
 *               countryCode:
 *                 type: string
 *               rules:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Repair-product validation completed
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
 *         description: username is required
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
 *         description: Repair-product validation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * @route POST /api/validation/repair-product
 * @desc Run repair product validators (rules 5–7)
 * @body { username, context: { productId?, data? }, countryCode?, rules?: string[] }
 */
router.post('/repair-product', asyncHandler(async (req, res) => {
  const { username, context = {}, rules, countryCode } = req.body;
  if (!username) throw new ValidationError('username is required');

  const ctx = { ...context, countryCode: countryCode || context.countryCode || null };
  logger.info('Repair product validation run', { username, rules, countryCode: ctx.countryCode || 'all' });
  const result = await repairEngine.run(username, ctx, rules);
  res.json({ success: true, data: result });
}));

/**
 * @swagger
 * /api/validation/deployment:
 *   post:
 *     operationId: runDeploymentValidation
 *     summary: Run deployment rule-engine validators
 *     description: >
 *       Executes the deployment rule engine (rules 8-11) covering missing GT
 *       object layouts, invalid RecordType IDs, PricingElement trigger
 *       configuration, and inactive calculation procedures.
 *     tags:
 *       - Validation
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
 *                 description: SFDX username of the source/deploying org
 *               context:
 *                 type: object
 *                 properties:
 *                   targetUsername:
 *                     type: string
 *                     description: SFDX username of the target org (defaults to username)
 *                   recordTypeIds:
 *                     type: array
 *                     items:
 *                       type: string
 *                   pricingElements:
 *                     type: array
 *                     items:
 *                       type: object
 *               countryCode:
 *                 type: string
 *               rules:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Deployment validation completed
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
 *         description: username is required
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
 *         description: Deployment validation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * @route POST /api/validation/deployment
 * @desc Run deployment validators (rules 8–11)
 * @body { username, context: { targetUsername?, recordTypeIds?, pricingElements? }, countryCode?, rules?: string[] }
 */
router.post('/deployment', asyncHandler(async (req, res) => {
  const { username, context = {}, rules, countryCode } = req.body;
  if (!username) throw new ValidationError('username is required');

  const ctx = { ...context, countryCode: countryCode || context.countryCode || null };
  logger.info('Deployment validation run', { username, rules, countryCode: ctx.countryCode || 'all' });
  const result = await deployEngine.run(ctx.targetUsername || username, ctx, rules);
  res.json({ success: true, data: result });
}));

/**
 * @swagger
 * /api/validation/rules:
 *   get:
 *     operationId: listValidationRules
 *     summary: List all registered validation rule IDs
 *     description: >
 *       Returns the rule IDs registered in each of the four rule engines
 *       (pricing, catalog, repairProduct, deployment) without executing them.
 *     tags:
 *       - Validation
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Rule lists returned
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
 *                     pricing:
 *                       type: array
 *                       items:
 *                         type: string
 *                     catalog:
 *                       type: array
 *                       items:
 *                         type: string
 *                     repairProduct:
 *                       type: array
 *                       items:
 *                         type: string
 *                     deployment:
 *                       type: array
 *                       items:
 *                         type: string
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
 * @route GET /api/validation/rules
 * @desc List all registered rule IDs per engine
 */
router.get('/rules', asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    data: {
      pricing:       pricingEngine.listRules(),
      catalog:       catalogEngine.listRules(),
      repairProduct: repairEngine.listRules(),
      deployment:    deployEngine.listRules(),
    },
  });
}));

/**
 * Generate CSV report from validation results
 */
function generateCSVReport(results) {
  const headers = ['Category', 'Check', 'Status', 'Message', 'Timestamp'];
  const rows = [];
  
  // Add error rows
  results.errors.forEach(error => {
    rows.push([
      error.category,
      error.check,
      'FAIL',
      error.message,
      error.timestamp
    ]);
  });
  
  // Add warning rows
  results.warnings.forEach(warning => {
    rows.push([
      warning.category,
      warning.check,
      'WARNING',
      warning.message,
      warning.timestamp
    ]);
  });
  
  // Convert to CSV
  const csvContent = [headers, ...rows]
    .map(row => row.map(field => `"${field}"`).join(','))
    .join('\n');
  
  return csvContent;
}

/**
 * Calculate health score based on validation results
 */
function calculateHealthScore(results) {
  const totalChecks = results.totalChecks;
  const failedChecks = results.failedChecks;
  const warnings = results.warnings.length;
  
  if (totalChecks === 0) return 0;
  
  const score = Math.max(0, ((totalChecks - failedChecks - (warnings * 0.5)) / totalChecks) * 100);
  return Math.round(score);
}

module.exports = router;
