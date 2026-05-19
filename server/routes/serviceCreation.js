'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const multer = require('multer');
const router = express.Router();

const { asyncHandler, ValidationError, NotFoundError } = require('../middleware/errorHandler');
const { authenticate } = require('../middleware/auth');
const jobHistoryService = require('../services/jobHistoryService');
const notificationService = require('../services/notificationService');
const serviceCreationService = require('../services/serviceCreationService');
const sourceComparisonService = require('../services/sourceComparisonService');
const logger = require('../utils/logger');

// ── File upload setup ──────────────────────────────────────────────────────────

const UPLOAD_DIR = path.join(__dirname, '../../uploads/service-creation');
fs.ensureDirSync(UPLOAD_DIR);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${ts}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      return cb(new ValidationError('Only CSV files are accepted'));
    }
    cb(null, true);
  },
});

// In-memory store for comparison results (keyed by jobId)
const comparisonCache = new Map();

// ── POST /upload ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/service-creation/upload:
 *   post:
 *     operationId: uploadServiceCreationFile
 *     summary: Upload a CSV file and receive a preview
 *     description: >
 *       Accepts a multipart CSV file upload (product or price type), validates
 *       and parses the rows, classifies columns as mapped/unmapped against the
 *       service-creation column mapping config, and returns a preview with a
 *       tracking job ID.
 *     tags:
 *       - Service Creation
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *               - fileType
 *               - orgUsername
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: CSV file (max 20 MB)
 *               fileType:
 *                 type: string
 *                 enum:
 *                   - product
 *                   - price
 *                 description: Type of data contained in the CSV
 *               orgUsername:
 *                 type: string
 *                 description: SFDX username of the target Salesforce org
 *     responses:
 *       200:
 *         description: File uploaded and preview generated
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
 *                     jobId:
 *                       type: string
 *                       format: uuid
 *                     preview:
 *                       type: object
 *                       properties:
 *                         fileType:
 *                           type: string
 *                         totalRows:
 *                           type: integer
 *                         validRows:
 *                           type: integer
 *                         invalidRows:
 *                           type: integer
 *                         columns:
 *                           type: object
 *                           properties:
 *                             mapped:
 *                               type: array
 *                               items:
 *                                 type: string
 *                             unmapped:
 *                               type: array
 *                               items:
 *                                 type: string
 *                         sampleRows:
 *                           type: array
 *                           items:
 *                             type: object
 *                         warnings:
 *                           type: array
 *                           items:
 *                             type: string
 *                         invalidSample:
 *                           type: array
 *                           items:
 *                             type: object
 *       400:
 *         description: Missing file, invalid fileType, or CSV parse error
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
 *         description: Upload processing failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * Upload a CSV file (product or price) and return a preview.
 * Body: multipart/form-data
 *   file        — CSV file
 *   fileType    — 'product' | 'price'
 *   orgUsername — SFDX username
 */
router.post(
  '/upload',
  authenticate,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ValidationError('No file uploaded');

    const { fileType, orgUsername } = req.body;
    if (!fileType || !['product', 'price'].includes(fileType)) {
      throw new ValidationError('fileType must be "product" or "price"');
    }
    if (!orgUsername) throw new ValidationError('orgUsername is required');

    const filePath = req.file.path;

    let headers, rows, validationResult;

    try {
      ({ headers, rows } = serviceCreationService.parseCSV(filePath));
    } catch (err) {
      throw new ValidationError(`CSV parse error: ${err.message}`);
    }

    if (fileType === 'price') {
      validationResult = serviceCreationService.validatePriceRows(rows);
    } else {
      // Product file: basic check — more detailed validation will come with product path
      validationResult = { valid: rows, invalid: [], warnings: [] };
    }

    // Classify columns
    const mapping = require('../config/service-creation-mapping.json');
    const knownColumns = fileType === 'price'
      ? Object.keys(mapping.priceFile.columns)
      : [
          ...Object.keys(mapping.productFile.product2),
          ...mapping.productFile.knownAttributeColumns,
        ];
    const mapped = headers.filter(h => knownColumns.includes(h));
    const unmapped = headers.filter(h => !knownColumns.includes(h));

    // Create a tracking job
    const job = await jobHistoryService.createJob({
      name: `Service Creation — ${fileType} file upload`,
      type: 'service-creation',
      orgUsername,
      meta: {
        fileType,
        originalName: req.file.originalname,
        filePath,
        totalRows: rows.length,
      },
    });

    const preview = {
      fileType,
      totalRows: rows.length,
      validRows: validationResult.valid.length,
      invalidRows: validationResult.invalid.length,
      columns: { mapped, unmapped },
      sampleRows: rows.slice(0, 5),
      warnings: validationResult.warnings,
      invalidSample: validationResult.invalid.slice(0, 5),
    };

    res.json({ success: true, data: { jobId: job.id, preview } });
  })
);

// ── POST /run ──────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/service-creation/run:
 *   post:
 *     operationId: runServiceCreation
 *     summary: Run upsert or comparison for an uploaded file
 *     description: >
 *       Parses the CSV file associated with the given job ID and either upserts
 *       the normalised rows to Salesforce (action=upsert) or compares them
 *       against the current org state (action=compare). Progress is tracked
 *       against the job record.
 *     tags:
 *       - Service Creation
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jobId
 *               - action
 *             properties:
 *               jobId:
 *                 type: string
 *                 format: uuid
 *                 description: Job ID returned by the /upload endpoint
 *               action:
 *                 type: string
 *                 enum:
 *                   - upsert
 *                   - compare
 *                 description: Operation to perform on the uploaded data
 *     responses:
 *       200:
 *         description: Operation completed
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
 *                     action:
 *                       type: string
 *                     result:
 *                       type: object
 *                       description: Upsert counts (created/updated/skipped/errors) or comparison result
 *       400:
 *         description: Missing jobId, invalid action, or file type not supported
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
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Run operation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * Run the upsert for a previously uploaded file.
 * Body: { jobId, action: 'upsert' | 'compare' }
 */
router.post(
  '/run',
  authenticate,
  asyncHandler(async (req, res) => {
    const { jobId, action } = req.body;
    if (!jobId) throw new ValidationError('jobId is required');
    if (!action || !['upsert', 'compare'].includes(action)) {
      throw new ValidationError('action must be "upsert" or "compare"');
    }

    const job = await jobHistoryService.getJobById(jobId);
    if (!job) throw new NotFoundError(`Job ${jobId} not found`);

    const { fileType, filePath, orgUsername } = job.meta || {};
    if (!filePath) throw new ValidationError('No file associated with this job');

    let rows, validationResult, normalisedRows;

    const { headers: _h, rows: rawRows } = serviceCreationService.parseCSV(filePath);

    if (fileType === 'price') {
      validationResult = serviceCreationService.validatePriceRows(rawRows);
      normalisedRows = serviceCreationService.normalisePriceRows(validationResult.valid);
    } else {
      throw new ValidationError('Product file upsert not yet implemented');
    }

    if (action === 'compare') {
      await jobHistoryService.updateJobProgress(jobId, 10, 'Running comparison...');
      const result = await sourceComparisonService.comparePricingElementsToOrg(normalisedRows, orgUsername);
      comparisonCache.set(jobId, result);
      await jobHistoryService.completeJob(jobId, { action: 'compare', summary: result.summary }, true);
      return res.json({ success: true, data: { action: 'compare', result } });
    }

    // action === 'upsert'
    await jobHistoryService.updateJobProgress(jobId, 10, 'Starting upsert...');

    const upsertResult = await serviceCreationService.upsertPricingElementsToOrg(
      normalisedRows,
      orgUsername,
      {
        onProgress: async pct => {
          await jobHistoryService.updateJobProgress(jobId, 10 + Math.round(pct * 0.85), null);
        },
      }
    );

    await jobHistoryService.completeJob(jobId, { action: 'upsert', ...upsertResult }, true);

    try {
      await notificationService.create({
        userId: req.user?.id,
        type: 'job_completed',
        title: `Service Creation completed`,
        message: `${upsertResult.created} created, ${upsertResult.updated} updated, ${upsertResult.skipped} skipped, ${upsertResult.errors} errors`,
        relatedId: jobId,
        relatedType: 'job',
        relatedUrl: `/jobs/service-creation/${jobId}`,
      });
    } catch (_) { /* non-fatal */ }

    res.json({ success: true, data: { action: 'upsert', result: upsertResult } });
  })
);

// ── GET /jobs/:jobId ───────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/service-creation/jobs/{jobId}:
 *   get:
 *     operationId: getServiceCreationJob
 *     summary: Get a service-creation job by ID
 *     description: Returns the full job record for the specified service-creation job.
 *     tags:
 *       - Service Creation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Service-creation job ID
 *     responses:
 *       200:
 *         description: Job returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Job'
 *       401:
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Job not found
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
router.get(
  '/jobs/:jobId',
  authenticate,
  asyncHandler(async (req, res) => {
    const job = await jobHistoryService.getJobById(req.params.jobId);
    if (!job) throw new NotFoundError(`Job ${req.params.jobId} not found`);
    res.json({ success: true, data: job });
  })
);

// ── GET /compare/:jobId/export ─────────────────────────────────────────────────

/**
 * @swagger
 * /api/service-creation/compare/{jobId}/export:
 *   get:
 *     operationId: exportComparisonResult
 *     summary: Export comparison results as CSV or JSON
 *     description: >
 *       Downloads the comparison result for the specified job as a CSV or JSON
 *       file. If the in-memory cache has expired the comparison is re-run
 *       against the org before exporting.
 *     tags:
 *       - Service Creation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job ID from the /run compare operation
 *       - in: query
 *         name: format
 *         required: false
 *         schema:
 *           type: string
 *           enum:
 *             - csv
 *             - json
 *           default: csv
 *         description: Download format
 *     responses:
 *       200:
 *         description: Comparison export file
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *           application/json:
 *             schema:
 *               type: object
 *       400:
 *         description: Export not supported for this file type
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
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Export failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get(
  '/compare/:jobId/export',
  authenticate,
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;
    const { format = 'csv' } = req.query;

    // Try cache first, then re-run if available
    let result = comparisonCache.get(jobId);
    if (!result) {
      const job = await jobHistoryService.getJobById(jobId);
      if (!job) throw new NotFoundError(`Job ${jobId} not found`);
      const { fileType, filePath, orgUsername } = job.meta || {};
      if (!filePath) throw new NotFoundError('No file associated with this job');
      const { rows: rawRows } = serviceCreationService.parseCSV(filePath);
      if (fileType === 'price') {
        const { valid } = serviceCreationService.validatePriceRows(rawRows);
        const normalised = serviceCreationService.normalisePriceRows(valid);
        result = await sourceComparisonService.comparePricingElementsToOrg(normalised, orgUsername);
        comparisonCache.set(jobId, result);
      } else {
        throw new ValidationError('Export not supported for this file type yet');
      }
    }

    if (format === 'json') {
      res.setHeader('Content-Disposition', `attachment; filename="comparison-${jobId}.json"`);
      res.setHeader('Content-Type', 'application/json');
      return res.send(JSON.stringify(result, null, 2));
    }

    // Default: CSV
    const csv = sourceComparisonService.comparisonToCsv(result);
    res.setHeader('Content-Disposition', `attachment; filename="comparison-${jobId}.csv"`);
    res.setHeader('Content-Type', 'text/csv');
    res.send(csv);
  })
);

// ── POST /apply-fixes ──────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/service-creation/apply-fixes:
 *   post:
 *     operationId: applyServiceCreationFixes
 *     summary: Upsert only mismatch and missing rows
 *     description: >
 *       Re-runs the upsert for rows that were identified as mismatched or
 *       missing in the most recent comparison for the given job. The in-memory
 *       comparison cache is invalidated after the fix job completes.
 *     tags:
 *       - Service Creation
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jobId
 *             properties:
 *               jobId:
 *                 type: string
 *                 format: uuid
 *                 description: Job ID from a previous /run compare operation
 *     responses:
 *       200:
 *         description: Fix job completed (or no rows to fix)
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
 *                     fixJobId:
 *                       type: string
 *                       format: uuid
 *                     result:
 *                       type: object
 *                       description: Upsert counts for fixed rows
 *                     message:
 *                       type: string
 *                       description: Present when there are no rows to fix
 *       400:
 *         description: jobId is required or file type not supported
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
 *       404:
 *         description: Job or comparison result not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Apply-fixes operation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * Re-run upsert for only the rows that are mismatched or missing.
 * Body: { jobId }
 */
router.post(
  '/apply-fixes',
  authenticate,
  asyncHandler(async (req, res) => {
    const { jobId } = req.body;
    if (!jobId) throw new ValidationError('jobId is required');

    const cachedResult = comparisonCache.get(jobId);
    if (!cachedResult) throw new NotFoundError('No comparison result found. Run a comparison first.');

    const job = await jobHistoryService.getJobById(jobId);
    if (!job) throw new NotFoundError(`Job ${jobId} not found`);

    const { fileType, filePath, orgUsername } = job.meta || {};
    const { rows: rawRows } = serviceCreationService.parseCSV(filePath);

    let normalisedRows;
    if (fileType === 'price') {
      const { valid } = serviceCreationService.validatePriceRows(rawRows);
      const allNormalised = serviceCreationService.normalisePriceRows(valid);

      // Filter to only mismatch and missing rows
      const fixKeys = new Set(
        cachedResult.rows
          .filter(r => r.status === 'mismatch' || r.status === 'missing')
          .map(r => r.globalKey)
      );
      normalisedRows = allNormalised.filter(r => fixKeys.has(r.globalKey));
    } else {
      throw new ValidationError('Apply fixes not yet supported for product files');
    }

    if (normalisedRows.length === 0) {
      return res.json({ success: true, data: { message: 'Nothing to fix — no mismatch or missing rows', result: null } });
    }

    const fixJob = await jobHistoryService.createJob({
      name: `Service Creation — apply fixes (from job ${jobId})`,
      type: 'service-creation',
      orgUsername,
      meta: { fileType, filePath, orgUsername, parentJobId: jobId },
    });

    const upsertResult = await serviceCreationService.upsertPricingElementsToOrg(normalisedRows, orgUsername);
    await jobHistoryService.completeJob(fixJob.id, { action: 'apply-fixes', ...upsertResult }, true);

    // Invalidate cached comparison so next compare reflects fresh state
    comparisonCache.delete(jobId);

    res.json({ success: true, data: { fixJobId: fixJob.id, result: upsertResult } });
  })
);

// ── GET /template ──────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/service-creation/template:
 *   get:
 *     operationId: downloadServiceCreationTemplate
 *     summary: Download a CSV template file
 *     description: >
 *       Returns a CSV template file for either the product or price upload
 *       format. Useful for users building their input files.
 *     tags:
 *       - Service Creation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *           enum:
 *             - product
 *             - price
 *         description: Template type to download
 *     responses:
 *       200:
 *         description: CSV template file
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *       400:
 *         description: type must be "product" or "price"
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
 *         description: Template generation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get(
  '/template',
  authenticate,
  asyncHandler(async (req, res) => {
    const { type } = req.query;
    if (!type || !['product', 'price'].includes(type)) {
      throw new ValidationError('type must be "product" or "price"');
    }

    let csvContent;
    if (type === 'price') {
      csvContent = 'ItemNumberSKU,PriceList,PricingVariable,Amount,EffectiveStartDate\nCP100136,Amplifon Portfolio,One Time Std Price,5,2026-02-01\n';
    } else {
      csvContent = 'SKU,Product Name,Type,Description,Is Active,Country Code,Catalog\nEXAMPLE001,Example Product,HA,,true,AU,Main Catalog\n';
    }

    res.setHeader('Content-Disposition', `attachment; filename="${type}-template.csv"`);
    res.setHeader('Content-Type', 'text/csv');
    res.send(csvContent);
  })
);

// ── Staging area comparison ────────────────────────────────────────────────────

// In-memory cache for staging comparison results
const stagingComparisonCache = new Map();

/**
 * @swagger
 * /api/service-creation/staging-comparison:
 *   get:
 *     operationId: getStagingComparison
 *     summary: Compare GT_StagingArea__c records against Product2
 *     description: >
 *       Queries both GT_StagingArea__c and Product2 directly from the org
 *       and returns a diff showing which staging records are matched, missing,
 *       or mismatched against Product2. No file upload is required.
 *       Supports CSV or JSON download via the format parameter.
 *     tags:
 *       - Service Creation
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: orgUsername
 *         required: true
 *         schema:
 *           type: string
 *         description: SFDX username of the Salesforce org
 *       - in: query
 *         name: countryCode
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter staging records by GT_OrganizationCode__c (partial match)
 *         example: AU
 *       - in: query
 *         name: status
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter staging records by GT_RecordStatus__c
 *       - in: query
 *         name: productType
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter Product2 by vlocity_cmt__Type__c
 *       - in: query
 *         name: format
 *         required: false
 *         schema:
 *           type: string
 *           enum:
 *             - json
 *             - csv
 *         description: If set, triggers a file download instead of a JSON response
 *     responses:
 *       200:
 *         description: Comparison result or file download
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
 *                   description: Comparison result with rows and summary
 *           text/csv:
 *             schema:
 *               type: string
 *       400:
 *         description: orgUsername is required
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
 * GET /api/service-creation/staging-comparison
 *
 * Compare GT_StagingArea__c records against Product2 in the same org.
 * No file upload needed — queries the org directly.
 *
 * Query params:
 *   orgUsername  — SFDX username (required)
 *   countryCode  — filter staging by GT_OrganizationCode__c LIKE '%{countryCode}%' (optional)
 *   status       — filter staging by GT_RecordStatus__c (optional, default: all)
 *   productType  — filter Product2 by vlocity_cmt__Type__c (optional)
 *   format       — 'json' | 'csv' for download (optional)
 */
router.get(
  '/staging-comparison',
  authenticate,
  asyncHandler(async (req, res) => {
    const { orgUsername, countryCode, status, productType, format } = req.query;
    if (!orgUsername) throw new ValidationError('orgUsername is required');

    const cacheKey = `${orgUsername}::${countryCode || ''}::${status || ''}::${productType || ''}`;

    const result = await sourceComparisonService.compareStagingToProducts(orgUsername, {
      countryCode, status, productType,
    });

    stagingComparisonCache.set(cacheKey, result);

    if (format === 'csv') {
      const csv = sourceComparisonService.stagingComparisonToCsv(result);
      res.setHeader('Content-Disposition', `attachment; filename="staging-comparison-${orgUsername}.csv"`);
      res.setHeader('Content-Type', 'text/csv');
      return res.send(csv);
    }

    if (format === 'json') {
      res.setHeader('Content-Disposition', `attachment; filename="staging-comparison-${orgUsername}.json"`);
      res.setHeader('Content-Type', 'application/json');
      return res.send(JSON.stringify(result, null, 2));
    }

    res.json({ success: true, data: result });
  })
);

/**
 * @swagger
 * /api/service-creation/run-batch:
 *   post:
 *     operationId: runServiceCreationBatch
 *     summary: Trigger AMP_ServiceCreationSingleBatch via Execute Anonymous Apex
 *     description: >
 *       Executes the AMP_ServiceCreationSingleBatch Apex batch class in the
 *       specified org using Execute Anonymous Apex via the Salesforce CLI.
 *     tags:
 *       - Service Creation
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
 *     responses:
 *       200:
 *         description: Batch submitted successfully
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
 *                     message:
 *                       type: string
 *                       example: AMP_ServiceCreationSingleBatch submitted successfully.
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
 *         description: Apex execution failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * POST /run-batch
 * Run AMP_ServiceCreationSingleBatch via Execute Anonymous Apex.
 * Body: { username }
 */
router.post(
  '/run-batch',
  authenticate,
  asyncHandler(async (req, res) => {
    const { username } = req.body;
    if (!username) throw new ValidationError('username is required');
    const { executeBatch } = require('../services/catalogManagerService');
    const result = await executeBatch(username, 'AMP_ServiceCreationSingleBatch');
    if (result.success === false) {
      throw new Error(`Apex execution failed: ${result.compileProblem || result.exceptionMessage || JSON.stringify(result)}`);
    }
    logger.logOperation('Service creation batch triggered', { username });
    res.json({ success: true, data: { message: 'AMP_ServiceCreationSingleBatch submitted successfully.' } });
  })
);

/**
 * @swagger
 * /api/service-creation/create-rate-tables:
 *   post:
 *     operationId: createRateTables
 *     summary: Create GT_RateTable__c records for products missing one
 *     description: >
 *       Looks up the GT_RateCode__c ID for each item's orgCode + salesVatCode
 *       combination and upserts a GT_RateTable__c record linked to the product.
 *       Items whose rate code cannot be found are returned in the skipped list.
 *     tags:
 *       - Service Creation
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
 *               - items
 *             properties:
 *               username:
 *                 type: string
 *                 description: SFDX username of the target Salesforce org
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required:
 *                     - productId
 *                     - productName
 *                     - orgCode
 *                     - salesVatCode
 *                     - sku
 *                   properties:
 *                     productId:
 *                       type: string
 *                       description: Salesforce Product2 ID
 *                     productName:
 *                       type: string
 *                     orgCode:
 *                       type: string
 *                     salesVatCode:
 *                       type: string
 *                     sku:
 *                       type: string
 *     responses:
 *       200:
 *         description: Rate tables creation result
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
 *                     created:
 *                       type: integer
 *                     errors:
 *                       type: integer
 *                     errorDetails:
 *                       type: array
 *                       items:
 *                         type: string
 *                     skipped:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           sku:
 *                             type: string
 *                           reason:
 *                             type: string
 *       400:
 *         description: username or items array is required
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
 *         description: Rate table creation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * POST /create-rate-tables
 * Create GT_RateTable__c records for products missing one.
 * Body: { username, items: [{ productId, productName, orgCode, salesVatCode, sku }] }
 */
router.post(
  '/create-rate-tables',
  authenticate,
  asyncHandler(async (req, res) => {
    const { username, items } = req.body;
    if (!username) throw new ValidationError('username is required');
    if (!Array.isArray(items) || items.length === 0) throw new ValidationError('items array is required');

    const salesforceService = require('../services/salesforceService');
    const { sfUpsertBulk } = require('../services/catalogManagerService');

    await salesforceService.authenticateWithSfdx(username);

    // Group items by orgCode+vatCode to batch the GT_RateCode__c lookups
    const rateCodeCache = new Map();
    const today = new Date().toISOString().split('T')[0];
    const records = [];
    const skipped = [];

    for (const item of items) {
      const cacheKey = `${item.orgCode}::${item.salesVatCode}`;
      if (!rateCodeCache.has(cacheKey)) {
        const vatDecimal = parseFloat(item.salesVatCode);
        const soql = `SELECT Id FROM GT_RateCode__c WHERE GT_OrgCode__c = '${item.orgCode}' AND GT_VATCode__c = ${vatDecimal} LIMIT 1`;
        const result = await salesforceService.query(soql);
        rateCodeCache.set(cacheKey, result.records?.[0]?.Id || null);
      }
      const rateCodeId = rateCodeCache.get(cacheKey);
      if (!rateCodeId) {
        skipped.push({ sku: item.sku, reason: `No GT_RateCode__c found for orgCode=${item.orgCode} vatCode=${item.salesVatCode}` });
        continue;
      }
      records.push({
        Product__c: item.productId,
        GT_ProductName_Text__c: item.productName,
        GT_OrgCode__c: item.orgCode,
        GT_VATType__c: 'Ordinary VAT',
        GT_RateCode__c: rateCodeId,
        GT_StartDate__c: today,
        GT_UniqueKey__c: `${item.productId}_OrdinaryVAT`,
      });
    }

    let created = 0;
    let errors = 0;
    let errorDetails = [];

    if (records.length > 0) {
      const { results, errors: errs } = await sfUpsertBulk(username, 'GT_RateTable__c', 'GT_UniqueKey__c', records);
      created = results.length;
      errors = errs.length;
      errorDetails = errs.map(e => e.errors?.[0]?.message || JSON.stringify(e));
    }

    logger.logOperation('Create missing rate tables', { username, created, errors, skipped: skipped.length });
    res.json({ success: true, data: { created, errors, errorDetails, skipped } });
  })
);

/**
 * @swagger
 * /api/service-creation/staging-apply:
 *   post:
 *     operationId: applyStagingToProducts
 *     summary: Apply staging values to Product2 records
 *     description: >
 *       Bulk-upserts field updates from GT_StagingArea__c onto the
 *       corresponding Product2 records using the Salesforce Bulk API.
 *     tags:
 *       - Service Creation
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
 *               - updates
 *             properties:
 *               username:
 *                 type: string
 *                 description: SFDX username of the target Salesforce org
 *               updates:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required:
 *                     - productId
 *                     - sku
 *                     - data
 *                   properties:
 *                     productId:
 *                       type: string
 *                       description: Salesforce Product2 ID
 *                     sku:
 *                       type: string
 *                     data:
 *                       type: object
 *                       description: Field-value map to apply to the Product2 record
 *                       additionalProperties: true
 *     responses:
 *       200:
 *         description: Staging apply result
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
 *                     total:
 *                       type: integer
 *                     updated:
 *                       type: integer
 *                     errors:
 *                       type: integer
 *                     errorDetails:
 *                       type: array
 *                       items:
 *                         type: string
 *       400:
 *         description: username or updates array is required
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
 *         description: Staging apply failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * POST /staging-apply
 * Apply staging values to Product2 records via Salesforce REST API.
 * Body: { username, updates: [{ productId, sku, data: { GT_Lifecycle__c: 'value', ... } }] }
 */
router.post(
  '/staging-apply',
  authenticate,
  asyncHandler(async (req, res) => {
    const { username, updates } = req.body;
    if (!username) throw new ValidationError('username is required');
    if (!Array.isArray(updates) || updates.length === 0) throw new ValidationError('updates array is required');

    const { sfUpsertBulk } = require('../services/catalogManagerService');

    // Build records for bulk upsert using Id as the key
    const records = updates.map(u => ({ Id: u.productId, ...u.data }));
    const { results, errors } = await sfUpsertBulk(username, 'Product2', 'Id', records);

    // Map outcomes back to SKUs in original order
    let successIdx = 0;
    let errorIdx = 0;
    const skuResults = updates.map(u => {
      // sfUpsertBulk doesn't preserve order in results/errors arrays so we
      // check the flat totals and return per-record based on position in results
      return { sku: u.sku, productId: u.productId };
    });

    logger.logOperation('Staging → Product2 apply', {
      username, total: updates.length, updated: results.length, errors: errors.length,
    });

    res.json({
      success: true,
      data: {
        total: updates.length,
        updated: results.length,
        errors: errors.length,
        errorDetails: errors.map(e => e.errors?.[0]?.message || JSON.stringify(e)),
      },
    });
  })
);

module.exports = router;
