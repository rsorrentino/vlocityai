const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticate, adminOnly } = require('../middleware/auth');
const getEnterpriseMonitoringService = require('../services/enterpriseMonitoringService');
const logger = require('../utils/logger');

const monitoringService = getEnterpriseMonitoringService();

/**
 * @route GET /api/performance/metrics
 * @desc Get performance metrics
 * @access Private (Admin only)
 */
router.get('/metrics', authenticate, adminOnly, asyncHandler(async (req, res) => {
  const { startDate, endDate, interval = '1h' } = req.query;

  try {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    const metrics = await monitoringService.getMetrics();
    const performanceData = await monitoringService.getPerformanceData(start, end, interval);

    res.json({
      success: true,
      metrics: {
        current: metrics,
        historical: performanceData,
      },
      period: { start, end, interval },
    });
  } catch (error) {
    logger.error('Failed to fetch performance metrics', { error: error.message });
    throw error;
  }
}));

/**
 * @route GET /api/performance/health
 * @desc Get system health status
 * @access Private (Admin only)
 */
router.get('/health', authenticate, adminOnly, asyncHandler(async (req, res) => {
  try {
    const health = await monitoringService.getSystemHealth();

    res.json({
      success: true,
      health,
    });
  } catch (error) {
    logger.error('Failed to fetch system health', { error: error.message });
    throw error;
  }
}));

/**
 * @route GET /api/performance/alerts
 * @desc Get performance alerts
 * @access Private (Admin only)
 */
router.get('/alerts', authenticate, adminOnly, asyncHandler(async (req, res) => {
  try {
    const alerts = await monitoringService.getAlerts();

    res.json({
      success: true,
      alerts,
    });
  } catch (error) {
    logger.error('Failed to fetch alerts', { error: error.message });
    throw error;
  }
}));

module.exports = router;

