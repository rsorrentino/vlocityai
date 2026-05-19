const express = require('express');
const router = express.Router();
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const { authenticate, adminOnly } = require('../middleware/auth');
const databaseService = require('../services/databaseService');
const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');
const archiver = require('archiver');

/**
 * @route POST /api/backup/create
 * @desc Create database backup
 * @access Private (Admin only)
 */
router.post('/create', authenticate, adminOnly, asyncHandler(async (req, res) => {
  const { includeJobs = true, includeAuditLogs = true } = req.body;

  try {
    const { sequelize } = databaseService;
    const backupDir = path.join(process.cwd(), 'backups');
    await fs.ensureDir(backupDir);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `backup_${timestamp}`;
    const backupPath = path.join(backupDir, backupName);

    // Create backup directory
    await fs.ensureDir(backupPath);

    // Backup database
    if (sequelize.getDialect() === 'postgres') {
      // PostgreSQL backup using pg_dump
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const dbUrl = process.env.DATABASE_URL;
      const dbName = dbUrl.match(/\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
      
      if (dbName) {
        const backupFile = path.join(backupPath, 'database.sql');
        await execAsync(`pg_dump "${dbUrl}" > "${backupFile}"`);
      }
    } else {
      // SQLite backup
      const dbPath = sequelize.config.storage;
      if (dbPath && await fs.pathExists(dbPath)) {
        await fs.copy(dbPath, path.join(backupPath, 'database.sqlite'));
      }
    }

    // Backup jobs if requested
    if (includeJobs) {
      const jobsDir = path.join(process.cwd(), 'jobs');
      if (await fs.pathExists(jobsDir)) {
        await fs.copy(jobsDir, path.join(backupPath, 'jobs'));
      }
    }

    // Backup audit logs if requested
    if (includeAuditLogs) {
      const { getAuditService } = require('../services/auditService');
      const auditService = getAuditService();
      if (auditService.isEnabled) {
        // Export audit logs to JSON
        const logs = await sequelize.query(
          'SELECT * FROM vlocity_datapack_manager.audit_logs ORDER BY timestamp DESC',
          { type: sequelize.QueryTypes.SELECT }
        );
        await fs.writeJson(path.join(backupPath, 'audit_logs.json'), logs, { spaces: 2 });
      }
    }

    // Create backup manifest
    const manifest = {
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      includes: {
        database: true,
        jobs: includeJobs,
        auditLogs: includeAuditLogs,
      },
    };
    await fs.writeJson(path.join(backupPath, 'manifest.json'), manifest, { spaces: 2 });

    // Create zip archive
    const zipPath = `${backupPath}.zip`;
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve());
      archive.on('error', reject);

      archive.pipe(output);
      archive.directory(backupPath, false);
      archive.finalize();
    });

    // Remove uncompressed backup
    await fs.remove(backupPath);

    logger.info('Backup created', { backupName, zipPath });

    res.json({
      success: true,
      message: 'Backup created successfully',
      backup: {
        name: backupName,
        path: zipPath,
        size: (await fs.stat(zipPath)).size,
        downloadUrl: `/api/backup/download/${path.basename(zipPath)}`,
      },
    });
  } catch (error) {
    logger.error('Backup failed', { error: error.message });
    throw error;
  }
}));

/**
 * @route GET /api/backup/list
 * @desc List available backups
 * @access Private (Admin only)
 */
router.get('/list', authenticate, adminOnly, asyncHandler(async (req, res) => {
  try {
    const backupDir = path.join(process.cwd(), 'backups');
    await fs.ensureDir(backupDir);

    const files = await fs.readdir(backupDir);
    const backups = [];

    for (const file of files) {
      if (file.endsWith('.zip')) {
        const filePath = path.join(backupDir, file);
        const stats = await fs.stat(filePath);
        backups.push({
          name: file,
          size: stats.size,
          createdAt: stats.birthtime,
          downloadUrl: `/api/backup/download/${file}`,
        });
      }
    }

    backups.sort((a, b) => b.createdAt - a.createdAt);

    res.json({
      success: true,
      backups,
    });
  } catch (error) {
    logger.error('Failed to list backups', { error: error.message });
    throw error;
  }
}));

/**
 * @route GET /api/backup/download/:filename
 * @desc Download backup file
 * @access Private (Admin only)
 */
router.get('/download/:filename', authenticate, adminOnly, asyncHandler(async (req, res) => {
  const { filename } = req.params;
  const backupDir = path.join(process.cwd(), 'backups');
  const filePath = path.join(backupDir, filename);

  // Security: Prevent directory traversal
  if (!filePath.startsWith(backupDir)) {
    throw new ValidationError('Invalid file path');
  }

  if (!(await fs.pathExists(filePath))) {
    throw new ValidationError('Backup file not found');
  }

  res.download(filePath, filename, (err) => {
    if (err) {
      logger.error('Backup download failed', { filename, error: err.message });
    }
  });
}));

/**
 * @route POST /api/backup/restore
 * @desc Restore from backup
 * @access Private (Admin only)
 */
router.post('/restore', authenticate, adminOnly, asyncHandler(async (req, res) => {
  const { filename } = req.body;

  if (!filename) {
    throw new ValidationError('Backup filename is required');
  }

  try {
    const backupDir = path.join(process.cwd(), 'backups');
    const filePath = path.join(backupDir, filename);

    // Security: Prevent directory traversal
    if (!filePath.startsWith(backupDir)) {
      throw new ValidationError('Invalid file path');
    }

    if (!(await fs.pathExists(filePath))) {
      throw new ValidationError('Backup file not found');
    }

    // Extract backup
    const extractPath = path.join(backupDir, `restore_${Date.now()}`);
    await fs.ensureDir(extractPath);

    const unzipper = require('unzipper');
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(unzipper.Extract({ path: extractPath }))
        .on('close', resolve)
        .on('error', reject);
    });

    // Read manifest
    const manifestPath = path.join(extractPath, 'manifest.json');
    if (!(await fs.pathExists(manifestPath))) {
      throw new ValidationError('Invalid backup: manifest not found');
    }

    const manifest = await fs.readJson(manifestPath);

    // Restore database
    const { sequelize } = databaseService;
    if (sequelize.getDialect() === 'postgres') {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const dbUrl = process.env.DATABASE_URL;
      const sqlFile = path.join(extractPath, 'database.sql');
      
      if (await fs.pathExists(sqlFile)) {
        await execAsync(`psql "${dbUrl}" < "${sqlFile}"`);
      }
    } else {
      // SQLite restore
      const dbPath = sequelize.config.storage;
      const backupDb = path.join(extractPath, 'database.sqlite');
      if (await fs.pathExists(backupDb)) {
        await fs.copy(backupDb, dbPath);
      }
    }

    // Restore jobs if included
    if (manifest.includes.jobs) {
      const jobsBackup = path.join(extractPath, 'jobs');
      if (await fs.pathExists(jobsBackup)) {
        const jobsDir = path.join(process.cwd(), 'jobs');
        await fs.copy(jobsBackup, jobsDir);
      }
    }

    // Cleanup
    await fs.remove(extractPath);

    logger.info('Backup restored', { filename });

    res.json({
      success: true,
      message: 'Backup restored successfully',
    });
  } catch (error) {
    logger.error('Restore failed', { error: error.message });
    throw error;
  }
}));

module.exports = router;

