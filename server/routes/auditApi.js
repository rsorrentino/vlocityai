const express = require('express');
const router = express.Router();
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const getAuditService = require('../services/auditService');
const logger = require('../utils/logger');

const auditService = getAuditService();

/**
 * @route GET /api/audit/logs
 * @desc Get audit logs with pagination and filtering
 * @access Private (Admin only)
 */
router.get('/logs', asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 25,
    action,
    status,
    severity,
    username,
    resourceType,
    startDate,
    endDate,
  } = req.query;

  if (!auditService.isEnabled) {
    return res.json({
      success: true,
      logs: [],
      total: 0,
      message: 'Audit logging is disabled',
    });
  }

  try {
    const { sequelize } = require('../services/databaseService');
    const isPostgres = sequelize.getDialect() === 'postgres';
    const tableRef = isPostgres ? 'vlocity_datapack_manager.audit_logs' : 'audit_logs';
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build WHERE clause dynamically (LIKE for SQLite, ILIKE for Postgres)
    const whereClause = [];
    const replacements = { limit: parseInt(limit), offset };

    if (action) {
      whereClause.push('action = :action');
      replacements.action = action;
    }
    if (status) {
      whereClause.push('status = :status');
      replacements.status = status;
    }
    if (severity) {
      whereClause.push('severity = :severity');
      replacements.severity = severity;
    }
    if (username) {
      whereClause.push(isPostgres ? 'username ILIKE :username' : 'username LIKE :username');
      replacements.username = `%${username}%`;
    }
    if (resourceType) {
      whereClause.push('resource_type = :resourceType');
      replacements.resourceType = resourceType;
    }
    if (startDate || endDate) {
      if (startDate) {
        whereClause.push('timestamp >= :startDate');
        replacements.startDate = new Date(startDate);
      }
      if (endDate) {
        whereClause.push('timestamp <= :endDate');
        replacements.endDate = new Date(endDate);
      }
    }

    const whereSQL = whereClause.length > 0 ? `WHERE ${whereClause.join(' AND ')}` : '';

    // Get total count
    const [countResult] = await sequelize.query(
      `SELECT COUNT(*) as count FROM ${tableRef} ${whereSQL}`,
      {
        replacements,
        type: sequelize.QueryTypes.SELECT,
      }
    );

    // Get paginated logs
    const logs = await sequelize.query(
      `SELECT * FROM ${tableRef}
       ${whereSQL}
       ORDER BY timestamp DESC
       LIMIT :limit OFFSET :offset`,
      {
        replacements,
        type: sequelize.QueryTypes.SELECT,
      }
    );

    const total = countResult?.count || 0;

    res.json({
      success: true,
      logs,
      total: parseInt(total),
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (error) {
    logger.error('Failed to fetch audit logs', { error: error.message });
    throw error;
  }
}));

/**
 * @route GET /api/audit/statistics
 * @desc Get audit statistics
 * @access Private (Admin only)
 */
router.get('/statistics', asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  if (!auditService.isEnabled) {
    return res.json({
      success: true,
      statistics: {},
      message: 'Audit logging is disabled',
    });
  }

  try {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    const statistics = await auditService.getAuditStatistics(start, end);

    res.json({
      success: true,
      statistics,
      period: { start, end },
    });
  } catch (error) {
    logger.error('Failed to fetch audit statistics', { error: error.message });
    throw error;
  }
}));

module.exports = router;

