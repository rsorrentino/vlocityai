const promClient = require('prom-client');
const logger = require('../utils/logger');

class MetricsService {
  constructor() {
    this.isEnabled = process.env.ENABLE_METRICS === 'true';
    this.registry = new promClient.Registry();
    
    if (this.isEnabled) {
      this.initializeMetrics();
    }
  }

  initializeMetrics() {
    try {
      // Default metrics
      promClient.collectDefaultMetrics({
        register: this.registry,
        prefix: 'vlocity_manager_',
        gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
      });

      // Custom metrics
      this.httpRequestsTotal = new promClient.Counter({
        name: 'vlocity_manager_http_requests_total',
        help: 'Total number of HTTP requests',
        labelNames: ['method', 'route', 'status_code'],
        registers: [this.registry],
      });

      this.httpRequestDuration = new promClient.Histogram({
        name: 'vlocity_manager_http_request_duration_seconds',
        help: 'Duration of HTTP requests in seconds',
        labelNames: ['method', 'route', 'status_code'],
        buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
        registers: [this.registry],
      });

      this.jobsTotal = new promClient.Counter({
        name: 'vlocity_manager_jobs_total',
        help: 'Total number of jobs processed',
        labelNames: ['type', 'status'],
        registers: [this.registry],
      });

      this.jobDuration = new promClient.Histogram({
        name: 'vlocity_manager_job_duration_seconds',
        help: 'Duration of jobs in seconds',
        labelNames: ['type'],
        buckets: [1, 5, 10, 30, 60, 300, 600, 1800],
        registers: [this.registry],
      });

      this.activeConnections = new promClient.Gauge({
        name: 'vlocity_manager_active_connections',
        help: 'Number of active WebSocket connections',
        registers: [this.registry],
      });

      this.databaseConnections = new promClient.Gauge({
        name: 'vlocity_manager_database_connections',
        help: 'Database connection status',
        labelNames: ['type'],
        registers: [this.registry],
      });

      this.cacheOperations = new promClient.Counter({
        name: 'vlocity_manager_cache_operations_total',
        help: 'Total number of cache operations',
        labelNames: ['operation', 'result'],
        registers: [this.registry],
      });

      logger.info('Metrics service initialized');
    } catch (error) {
      logger.logError(error, { operation: 'Initialize metrics' });
      this.isEnabled = false;
    }
  }

  recordHttpRequest(method, route, statusCode, duration) {
    if (!this.isEnabled) return;

    try {
      this.httpRequestsTotal.inc({ method, route, status_code: statusCode });
      this.httpRequestDuration.observe({ method, route, status_code: statusCode }, duration / 1000);
    } catch (error) {
      logger.logError(error, { operation: 'Record HTTP request' });
    }
  }

  recordJob(type, status, duration = null) {
    if (!this.isEnabled) return;

    try {
      this.jobsTotal.inc({ type, status });
      
      if (duration !== null) {
        this.jobDuration.observe({ type }, duration / 1000);
      }
    } catch (error) {
      logger.logError(error, { operation: 'Record job' });
    }
  }

  setActiveConnections(count) {
    if (!this.isEnabled) return;

    try {
      this.activeConnections.set(count);
    } catch (error) {
      logger.logError(error, { operation: 'Set active connections' });
    }
  }

  setDatabaseConnection(type, connected) {
    if (!this.isEnabled) return;

    try {
      this.databaseConnections.set({ type }, connected ? 1 : 0);
    } catch (error) {
      logger.logError(error, { operation: 'Set database connection' });
    }
  }

  recordCacheOperation(operation, result) {
    if (!this.isEnabled) return;

    try {
      this.cacheOperations.inc({ operation, result });
    } catch (error) {
      logger.logError(error, { operation: 'Record cache operation' });
    }
  }

  async getMetrics() {
    if (!this.isEnabled) {
      return '# Metrics disabled';
    }

    try {
      return await this.registry.metrics();
    } catch (error) {
      logger.logError(error, { operation: 'Get metrics' });
      return '# Error retrieving metrics';
    }
  }

  getRegistry() {
    return this.registry;
  }

  isMetricsEnabled() {
    return this.isEnabled;
  }

  /**
   * Track operation performance
   * @param {string} operation - Operation name
   * @param {number} startTime - Start time (ms)
   * @param {number} endTime - End time (ms)
   * @param {Object} metadata - Additional metadata
   * @returns {Object} Metric data
   */
  trackOperation(operation, startTime, endTime, metadata = {}) {
    const duration = endTime - startTime;
    
    const metric = {
      operation,
      duration,
      durationFormatted: this.formatDuration(duration),
      timestamp: new Date().toISOString(),
      ...metadata
    };

    // Log slow operations
    if (duration > 60000) { // > 1 minute
      logger.warn('Slow operation detected', metric);
    }

    // Record in metrics if enabled
    if (this.isEnabled && this.jobDuration) {
      this.jobDuration.observe({ type: operation }, duration / 1000);
    }

    return metric;
  }

  /**
   * Format duration in human-readable format
   * @param {number} ms - Milliseconds
   * @returns {string} Formatted duration
   */
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${remainingSeconds}s`;
  }

  /**
   * Get average operation time
   * @param {string} operation - Operation name
   * @returns {Promise<number>} Average duration in ms
   */
  async getAverageOperationTime(operation) {
    if (!this.isEnabled) {
      return 0;
    }

    try {
      // Get metrics from registry
      const metrics = await this.registry.getMetricsAsJSON();
      const jobMetric = metrics.find(m => m.name === 'vlocity_manager_job_duration_seconds');
      
      if (jobMetric && jobMetric.values) {
        const operationMetrics = jobMetric.values.filter(v => 
          v.labels && v.labels.type === operation
        );
        
        if (operationMetrics.length > 0) {
          const sum = operationMetrics.reduce((acc, v) => acc + v.value, 0);
          return (sum / operationMetrics.length) * 1000; // Convert to ms
        }
      }
      
      return 0;
    } catch (error) {
      logger.error('Failed to get average operation time', { operation, error: error.message });
      return 0;
    }
  }
}

module.exports = new MetricsService();
