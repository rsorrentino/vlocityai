const express = require('express');
const router = express.Router();
const path = require('path');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const { exportToCSV, exportToExcel, exportToPDF, saveExportFile } = require('../utils/exportUtils');
const logger = require('../utils/logger');

/**
 * @route POST /api/export/csv
 * @desc Export data to CSV format
 * @access Private
 */
router.post('/csv', asyncHandler(async (req, res) => {
  const { data, headers, filename } = req.body;

  if (!data || !Array.isArray(data)) {
    throw new ValidationError('Data array is required');
  }

  try {
    const csvContent = exportToCSV(data, headers, filename);
    const exportFilename = filename || `export_${Date.now()}`;
    const filepath = await saveExportFile(Buffer.from(csvContent, 'utf8'), exportFilename, 'csv');

    logger.info('CSV export created', { filename: exportFilename, rows: data.length });

    res.json({
      success: true,
      message: 'CSV export created successfully',
      filepath,
      filename: `${exportFilename}.csv`,
      downloadUrl: `/api/export/download/${path.basename(filepath)}`,
    });
  } catch (error) {
    logger.error('CSV export failed', { error: error.message });
    throw error;
  }
}));

/**
 * @route POST /api/export/excel
 * @desc Export data to Excel format
 * @access Private
 */
router.post('/excel', asyncHandler(async (req, res) => {
  const { data, headers, filename, sheetName } = req.body;

  if (!data || !Array.isArray(data)) {
    throw new ValidationError('Data array is required');
  }

  try {
    const excelBuffer = await exportToExcel(data, headers, filename, { sheetName });
    const exportFilename = filename || `export_${Date.now()}`;
    const filepath = await saveExportFile(excelBuffer, exportFilename, 'xlsx');

    logger.info('Excel export created', { filename: exportFilename, rows: data.length });

    res.json({
      success: true,
      message: 'Excel export created successfully',
      filepath,
      filename: `${exportFilename}.xlsx`,
      downloadUrl: `/api/export/download/${path.basename(filepath)}`,
    });
  } catch (error) {
    logger.error('Excel export failed', { error: error.message });
    throw error;
  }
}));

/**
 * @route POST /api/export/pdf
 * @desc Export data to PDF format
 * @access Private
 */
router.post('/pdf', asyncHandler(async (req, res) => {
  const { data, headers, filename, title, maxRows } = req.body;

  if (!data || !Array.isArray(data)) {
    throw new ValidationError('Data array is required');
  }

  try {
    const pdfBuffer = await exportToPDF(data, headers, filename, { title, maxRows });
    const exportFilename = filename || `export_${Date.now()}`;
    const filepath = await saveExportFile(pdfBuffer, exportFilename, 'pdf');

    logger.info('PDF export created', { filename: exportFilename, rows: data.length });

    res.json({
      success: true,
      message: 'PDF export created successfully',
      filepath,
      filename: `${exportFilename}.pdf`,
      downloadUrl: `/api/export/download/${path.basename(filepath)}`,
    });
  } catch (error) {
    logger.error('PDF export failed', { error: error.message });
    throw error;
  }
}));

/**
 * @route GET /api/export/download/:filename
 * @desc Download exported file
 * @access Private
 */
router.get('/download/:filename', asyncHandler(async (req, res) => {
  const { filename } = req.params;
  const fs = require('fs-extra');
  const exportDir = path.join(process.cwd(), 'exports');
  const filepath = path.join(exportDir, filename);

  // Security: Prevent directory traversal
  if (!filepath.startsWith(exportDir)) {
    throw new ValidationError('Invalid file path');
  }

  if (!(await fs.pathExists(filepath))) {
    throw new ValidationError('File not found');
  }

  res.download(filepath, filename, (err) => {
    if (err) {
      logger.error('File download failed', { filename, error: err.message });
    }
  });
}));

module.exports = router;

