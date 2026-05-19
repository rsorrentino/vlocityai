const express = require('express');
const router = express.Router();
const path = require('path');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const exportHealthService = require('../services/exportHealthService');
const buildLogParser = require('../services/buildLogParser');
const logger = require('../utils/logger');

const JOB_LOGS_DIR = path.join(__dirname, '../../logs/jobs');
const DEFAULT_EXPORT_PATH = path.join(process.cwd(), 'export');

/**
 * @swagger
 * /api/export-health/scan:
 *   get:
 *     operationId: scanExportHealth
 *     summary: Scan the export directory for a health report
 *     description: >
 *       Analyses the Vlocity export output directory and produces a health report covering DataPack type
 *       coverage, cross-reference integrity, and any structural anomalies.
 *       Optionally, a `jobId` can be supplied to enrich the report with build-log analysis from that job.
 *     tags:
 *       - Export Health
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: exportPath
 *         required: false
 *         schema:
 *           type: string
 *         description: Absolute or relative path to the export directory to scan. Defaults to `<cwd>/export`.
 *         example: /var/app/export
 *       - in: query
 *         name: jobId
 *         required: false
 *         schema:
 *           type: string
 *         description: Optional export job ID used to load and merge build-log analysis into the health report
 *         example: job_20260315_abc123
 *     responses:
 *       200:
 *         description: Health report generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 report:
 *                   $ref: '#/components/schemas/ExportHealthReport'
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
router.get('/scan', asyncHandler(async (req, res) => {
  const exportPath = req.query.exportPath || DEFAULT_EXPORT_PATH;
  const jobId = req.query.jobId || null;

  let buildAnalysis = null;
  if (jobId) {
    const buildLogPath = path.join(JOB_LOGS_DIR, `${jobId}-build-log.yaml`);
    const errorLogPath = path.join(JOB_LOGS_DIR, `${jobId}-build-errors.log`);
    buildAnalysis = await buildLogParser.analyze(buildLogPath, errorLogPath).catch(() => null);
  }

  logger.info('Export health scan requested', { exportPath, jobId });
  const report = await exportHealthService.analyzeExportDirectory(exportPath, buildAnalysis);

  res.json({ success: true, report });
}));

/**
 * @swagger
 * /api/export-health/report/{jobId}:
 *   get:
 *     operationId: getExportHealthReport
 *     summary: Get a combined export health report for a job
 *     description: >
 *       Produces a combined report that merges the build-log analysis for the given job with a
 *       full directory health scan of the export path. Supports `json` (default, streamed as a
 *       file attachment) and `csv` format outputs.
 *     tags:
 *       - Export Health
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the export job whose build artifacts and export directory will be reported on
 *         example: job_20260315_abc123
 *       - in: query
 *         name: format
 *         required: false
 *         schema:
 *           type: string
 *           enum: [json, csv]
 *           default: json
 *         description: Output format — `json` returns a downloadable JSON attachment, `csv` returns a CSV attachment
 *         example: json
 *       - in: query
 *         name: exportPath
 *         required: false
 *         schema:
 *           type: string
 *         description: Path to the export directory to include in the scan. Defaults to `<cwd>/export`.
 *         example: /var/app/export
 *     responses:
 *       200:
 *         description: Combined health report returned as a file download
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 jobId:
 *                   type: string
 *                   example: job_20260315_abc123
 *                 buildAnalysis:
 *                   description: Build-log analysis result (null if no artifacts found)
 *                   nullable: true
 *                   type: object
 *                   properties:
 *                     summary:
 *                       type: object
 *                     byType:
 *                       type: array
 *                       items:
 *                         type: object
 *                     errors:
 *                       type: array
 *                       items:
 *                         type: object
 *                 healthReport:
 *                   $ref: '#/components/schemas/ExportHealthReport'
 *           text/csv:
 *             schema:
 *               type: string
 *               description: CSV file with columns Type, Count, Status, IsExpectedType, CrossRefIssues
 *       400:
 *         description: Invalid format parameter — must be "json" or "csv"
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
 *         description: Export directory or job artifacts not found
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
router.get('/report/:jobId', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const format = (req.query.format || 'json').toLowerCase();
  const exportPath = req.query.exportPath || DEFAULT_EXPORT_PATH;

  if (!['json', 'csv'].includes(format)) {
    throw new ValidationError('format must be "json" or "csv"');
  }

  const buildLogPath = path.join(JOB_LOGS_DIR, `${jobId}-build-log.yaml`);
  const errorLogPath = path.join(JOB_LOGS_DIR, `${jobId}-build-errors.log`);

  const [buildAnalysis, healthReport] = await Promise.all([
    buildLogParser.analyze(buildLogPath, errorLogPath).catch(() => null),
    exportHealthService.analyzeExportDirectory(exportPath, null)
  ]);

  if (format === 'csv') {
    const rows = [
      ['Type', 'Count', 'Status', 'IsExpectedType', 'CrossRefIssues'].join(','),
      ...(healthReport.coverage || []).map(row => {
        const issues = (healthReport.crossRefIssues || []).filter(i => i.source.startsWith(row.type + '/')).length;
        return [row.type, row.count, row.status, row.isExpectedType, issues].join(',');
      })
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="export-health-${jobId}.csv"`);
    return res.send(rows.join('\n'));
  }

  res.setHeader('Content-Disposition', `attachment; filename="export-health-${jobId}.json"`);
  res.json({ success: true, jobId, buildAnalysis, healthReport });
}));

module.exports = router;
