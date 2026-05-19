const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs-extra');
const { asyncHandler, NotFoundError } = require('../middleware/errorHandler');
const buildLogParser = require('../services/buildLogParser');
const logger = require('../utils/logger');

const JOB_LOGS_DIR = path.join(__dirname, '../../logs/jobs');

/**
 * @swagger
 * /api/exports/{jobId}/build-analysis:
 *   get:
 *     operationId: getExportBuildAnalysis
 *     summary: Get build analysis for an export job
 *     description: >
 *       Returns a structured analysis of the Vlocity build artifacts produced by the specified export job.
 *       Parses the build log YAML and error log files stored on disk and aggregates counts by DataPack type.
 *       Supports two response formats: `json` (default, inline or downloadable) and `csv` (file download).
 *       At least one build artifact (build log or error log) must exist for the job.
 *     tags:
 *       - Export Analysis
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the export job whose build artifacts should be analysed
 *         example: job_20260315_abc123
 *       - in: query
 *         name: format
 *         required: false
 *         schema:
 *           type: string
 *           enum: [json, csv]
 *           default: json
 *         description: Response format — `json` returns a JSON body, `csv` streams a CSV file attachment
 *         example: json
 *       - in: query
 *         name: download
 *         required: false
 *         schema:
 *           type: string
 *           enum: ['true', 'false']
 *           default: 'false'
 *         description: When `true` and format is `json`, forces a file download via Content-Disposition header
 *         example: 'false'
 *     responses:
 *       200:
 *         description: Build analysis returned successfully
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
 *                 analysis:
 *                   type: object
 *                   description: Parsed build analysis result
 *                   properties:
 *                     summary:
 *                       type: object
 *                       description: Overall export totals
 *                       properties:
 *                         total:
 *                           type: integer
 *                           example: 450
 *                         success:
 *                           type: integer
 *                           example: 420
 *                         error:
 *                           type: integer
 *                           example: 10
 *                         remaining:
 *                           type: integer
 *                           example: 20
 *                         ignored:
 *                           type: integer
 *                           example: 0
 *                     byType:
 *                       type: array
 *                       description: Per-DataPack-type breakdown
 *                       items:
 *                         type: object
 *                         properties:
 *                           type:
 *                             type: string
 *                             example: Product2
 *                           success:
 *                             type: integer
 *                             example: 200
 *                           error:
 *                             type: integer
 *                             example: 5
 *                           remaining:
 *                             type: integer
 *                             example: 0
 *                           ignored:
 *                             type: integer
 *                             example: 0
 *                           status:
 *                             type: string
 *                             enum: [ok, warning, error]
 *                             example: ok
 *                     errors:
 *                       type: array
 *                       description: List of individual error entries from the error log
 *                       items:
 *                         type: object
 *                         properties:
 *                           line:
 *                             type: string
 *                           type:
 *                             type: string
 *           text/csv:
 *             schema:
 *               type: string
 *               description: CSV file with columns Type, Exported, Errors, Remaining, Ignored, Status
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: No build artifacts found for the given job ID
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
router.get('/:jobId/build-analysis', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const format = (req.query.format || 'json').toLowerCase();

  const buildLogPath = path.join(JOB_LOGS_DIR, `${jobId}-build-log.yaml`);
  const errorLogPath = path.join(JOB_LOGS_DIR, `${jobId}-build-errors.log`);

  // At least one artifact must exist
  const [buildLogExists, errorLogExists] = await Promise.all([
    fs.pathExists(buildLogPath),
    fs.pathExists(errorLogPath)
  ]);

  if (!buildLogExists && !errorLogExists) {
    throw new NotFoundError(`No build artifacts found for job ${jobId}. The job may not have completed yet or artifacts were not preserved.`);
  }

  const analysis = await buildLogParser.analyze(
    buildLogExists ? buildLogPath : null,
    errorLogExists ? errorLogPath : null
  );

  logger.info('Build analysis served', { jobId, format, types: analysis.byType?.length });

  if (format === 'csv') {
    const csvLines = [
      'Type,Exported,Errors,Remaining,Ignored,Status',
      ...(analysis.byType || []).map(row =>
        [row.type, row.success, row.error, row.remaining, row.ignored, row.status].join(',')
      )
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="export-analysis-${jobId}.csv"`);
    return res.send(csvLines.join('\n'));
  }

  // Default: JSON download
  if (req.query.download === 'true') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="export-analysis-${jobId}.json"`);
  }

  res.json({ success: true, jobId, analysis });
}));

module.exports = router;
