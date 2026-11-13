/**
 * Database backup & restore (admin only – enforced here and by accessPolicy).
 * Implementation: server/services/backupService.js
 */
const express = require('express');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const { authenticate, adminOnly } = require('../middleware/auth');
const databaseService = require('../services/databaseService');
const backupService = require('../services/backupService');

const router = express.Router();
router.use(authenticate, adminOnly);

/**
 * @route POST /api/backup/create
 * @desc Create a database backup (zip in DATA_DIR/backups)
 */
router.post('/create', asyncHandler(async (req, res) => {
  const { includeJobs = true } = req.body || {};
  const backup = await backupService.createBackup(databaseService.sequelize, { includeJobs: Boolean(includeJobs) });
  res.json({
    success: true,
    message: 'Backup created successfully',
    backup: { ...backup, downloadUrl: `/api/backup/download/${backup.name}` },
  });
}));

/**
 * @route GET /api/backup/list
 */
router.get('/list', asyncHandler(async (req, res) => {
  res.json({ success: true, backups: await backupService.listBackups() });
}));

/**
 * @route GET /api/backup/download/:filename
 */
router.get('/download/:filename', asyncHandler(async (req, res) => {
  const file = backupService.resolveBackupFile(req.params.filename);
  const fs = require('fs-extra');
  if (!(await fs.pathExists(file))) throw new ValidationError('Backup file not found');
  res.download(file, req.params.filename);
}));

/**
 * @route POST /api/backup/restore
 * @desc Replace the database with a backup, then run migrations
 */
router.post('/restore', asyncHandler(async (req, res) => {
  const { filename } = req.body || {};
  if (!filename) throw new ValidationError('Backup filename is required');
  const result = await backupService.restoreBackup(databaseService, filename);
  res.json({ success: true, message: 'Backup restored successfully', ...result });
}));

/**
 * @route DELETE /api/backup/:filename
 */
router.delete('/:filename', asyncHandler(async (req, res) => {
  await backupService.deleteBackup(req.params.filename);
  res.json({ success: true });
}));

module.exports = router;
