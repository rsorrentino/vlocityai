const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const fs = require('fs-extra');
const path = require('path');

// Get recent logs
router.get('/recent', asyncHandler(async (req, res) => {
  const { limit = 100, level } = req.query;
  const logsDir = path.join(__dirname, '../../logs');
  const logFile = path.join(logsDir, 'vlocity-manager.log');
  
  let logs = [];
  
  if (await fs.pathExists(logFile)) {
    try {
      const content = await fs.readFile(logFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      // Parse log lines (assuming JSON format)
      logs = lines
        .map(line => {
          try {
            return JSON.parse(line);
          } catch (e) {
            // If not JSON, create a simple log entry
            return {
              timestamp: new Date().toISOString(),
              level: 'info',
              message: line,
            };
          }
        })
        .filter(log => !level || log.level === level)
        .slice(-parseInt(limit))
        .reverse(); // Most recent first
    } catch (error) {
      logger.logError(error, { operation: 'readRecentLogs' });
    }
  }
  
  res.json({
    logs,
    count: logs.length,
    timestamp: new Date().toISOString(),
  });
}));

// Get log level
router.get('/level', asyncHandler(async (req, res) => {
  res.json({
    level: logger.level,
    timestamp: new Date().toISOString(),
  });
}));

// Set log level
router.post('/level', asyncHandler(async (req, res) => {
  const { level } = req.body;
  
  if (!['error', 'warn', 'info', 'debug'].includes(level)) {
    return res.status(400).json({
      error: 'Invalid log level. Must be one of: error, warn, info, debug',
    });
  }
  
  logger.level = level;
  process.env.LOG_LEVEL = level;
  
  res.json({
    message: `Log level set to ${level}`,
    level,
    timestamp: new Date().toISOString(),
  });
}));

// Get log files
router.get('/files', asyncHandler(async (req, res) => {
  const logsDir = path.join(__dirname, '../../logs');
  const logs = [];

  if (await fs.pathExists(logsDir)) {
    const files = await fs.readdir(logsDir);
    for (const file of files) {
      const filePath = path.join(logsDir, file);
      const stats = await fs.stat(filePath);
      logs.push({
        name: file,
        path: filePath,
        size: stats.size,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
      });
    }
  }

  res.json({
    logs,
    count: logs.length,
    timestamp: new Date().toISOString(),
  });
}));

// Get all logs
router.get('/', asyncHandler(async (req, res) => {
  const logsDir = path.join(__dirname, '../../logs');
  const logs = [];

  if (await fs.pathExists(logsDir)) {
    const files = await fs.readdir(logsDir);
    for (const file of files) {
      const filePath = path.join(logsDir, file);
      const stats = await fs.stat(filePath);
      logs.push({
        name: file,
        path: filePath,
        size: stats.size,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
      });
    }
  }

  res.json({
    logs,
    count: logs.length,
    timestamp: new Date().toISOString(),
  });
}));

module.exports = router;
