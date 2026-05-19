/**
 * Enterprise Monitoring Service
 * Provides comprehensive APM, distributed tracing, and advanced metrics
 */

const promClient = require('prom-client');
const logger = require('../utils/logger');

class EnterpriseMonitoringService {
  constructor() {
    this.isEnabled = process.env.ENABLE_ENTERPRISE_MONITORING === 'true';
    this.registry = new promClient.Registry();
    this.metrics = {};
    this.traces = new Map(); // In-memory trace storage (use Jaeger/OpenTelemetry in production)
    this.spanCounter = 0;
    
    if (this.isEnabled) {
      this.initializeMetrics();
      this.startBackgroundTasks();
    }
  }

  initializeMetrics() {
    try {
      // Default metrics with custom prefix
      promClient.collectDefaultMetrics({
        register: this.registry,
        prefix: 'vlocity_enterprise_',
        gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
      });

      // Business Metrics
      this.metrics.jobsByType = new promClient.Counter({
        name: 'vlocity_enterprise_jobs_by_type_total',
        help: 'Total jobs executed by type',
        labelNames: ['type', 'status', 'environment'],
        registers: [this.registry],
      });

      this.metrics.jobDurationByType = new promClient.Histogram({
        name: 'vlocity_enterprise_job_duration_seconds',
        help: 'Job execution duration by type',
        labelNames: ['type', 'status'],
        buckets: [1, 5, 10, 30, 60, 300, 600, 1800, 3600],
        registers: [this.registry],
      });

      this.metrics.dataPackSize = new promClient.Histogram({
        name: 'vlocity_enterprise_datapack_size_bytes',
        help: 'DataPack file sizes',
        labelNames: ['type', 'operation'],
        buckets: [1024, 10240, 102400, 1048576, 10485760, 104857600],
        registers: [this.registry],
      });

      // Performance Metrics
      this.metrics.apiLatency = new promClient.Histogram({
        name: 'vlocity_enterprise_api_latency_seconds',
        help: 'API endpoint latency',
        labelNames: ['method', 'route', 'status_code', 'user_role'],
        buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
        registers: [this.registry],
      });

      this.metrics.databaseQueryDuration = new promClient.Histogram({
        name: 'vlocity_enterprise_db_query_duration_seconds',
        help: 'Database query duration',
        labelNames: ['operation', 'table', 'status'],
        buckets: [0.001, 0.01, 0.1, 0.5, 1, 2, 5],
        registers: [this.registry],
      });

      this.metrics.cacheOperations = new promClient.Counter({
        name: 'vlocity_enterprise_cache_operations_total',
        help: 'Cache operations (hits/misses)',
        labelNames: ['operation', 'status'],
        registers: [this.registry],
      });

      // System Health Metrics
      this.metrics.activeConnections = new promClient.Gauge({
        name: 'vlocity_enterprise_active_connections',
        help: 'Active WebSocket connections',
        labelNames: ['type'],
        registers: [this.registry],
      });

      this.metrics.queueSize = new promClient.Gauge({
        name: 'vlocity_enterprise_queue_size',
        help: 'Job queue size',
        labelNames: ['type', 'priority'],
        registers: [this.registry],
      });

      this.metrics.resourceUsage = new promClient.Gauge({
        name: 'vlocity_enterprise_resource_usage',
        help: 'Resource usage (CPU, memory, disk)',
        labelNames: ['resource', 'type'],
        registers: [this.registry],
      });

      // Error Metrics
      this.metrics.errorsByType = new promClient.Counter({
        name: 'vlocity_enterprise_errors_by_type_total',
        help: 'Errors by type and severity',
        labelNames: ['type', 'severity', 'component'],
        registers: [this.registry],
      });

      // Business Intelligence Metrics
      this.metrics.userActivity = new promClient.Counter({
        name: 'vlocity_enterprise_user_activity_total',
        help: 'User activity tracking',
        labelNames: ['user_id', 'action', 'resource'],
        registers: [this.registry],
      });

      this.metrics.tenantUsage = new promClient.Gauge({
        name: 'vlocity_enterprise_tenant_usage',
        help: 'Per-tenant resource usage',
        labelNames: ['tenant_id', 'resource_type'],
        registers: [this.registry],
      });

      logger.info('Enterprise monitoring service initialized');
    } catch (error) {
      logger.logError(error, { operation: 'initializeMetrics' });
    }
  }

  /**
   * Start a distributed trace
   */
  startTrace(operationName, context = {}) {
    if (!this.isEnabled) return null;

    const traceId = this.generateTraceId();
    const spanId = this.generateSpanId();
    const startTime = Date.now();

    const trace = {
      traceId,
      spanId,
      operationName,
      startTime,
      context,
      spans: [],
      tags: {},
    };

    this.traces.set(traceId, trace);
    return trace;
  }

  /**
   * Start a child span
   */
  startSpan(traceId, operationName, tags = {}) {
    if (!this.isEnabled || !traceId) return null;

    const trace = this.traces.get(traceId);
    if (!trace) return null;

    const spanId = this.generateSpanId();
    const span = {
      spanId,
      operationName,
      startTime: Date.now(),
      tags,
      parentSpanId: trace.spanId,
    };

    trace.spans.push(span);
    return span;
  }

  /**
   * Finish a span
   */
  finishSpan(traceId, spanId, status = 'ok', error = null) {
    if (!this.isEnabled || !traceId || !spanId) return;

    const trace = this.traces.get(traceId);
    if (!trace) return;

    const span = trace.spans.find(s => s.spanId === spanId);
    if (span) {
      span.endTime = Date.now();
      span.duration = span.endTime - span.startTime;
      span.status = status;
      if (error) {
        span.error = {
          message: error.message,
          stack: error.stack,
        };
      }
    }
  }

  /**
   * Finish a trace
   */
  finishTrace(traceId, status = 'ok') {
    if (!this.isEnabled || !traceId) return;

    const trace = this.traces.get(traceId);
    if (!trace) return;

    trace.endTime = Date.now();
    trace.duration = trace.endTime - trace.startTime;
    trace.status = status;

    // In production, send to Jaeger/OpenTelemetry collector
    // For now, log significant traces
    if (trace.duration > 5000 || status !== 'ok') {
      logger.info('Trace completed', {
        traceId,
        operationName: trace.operationName,
        duration: trace.duration,
        status,
        spanCount: trace.spans.length,
      });
    }

    // Clean up old traces (keep last 1000)
    if (this.traces.size > 1000) {
      const oldestTrace = Array.from(this.traces.entries())[0];
      this.traces.delete(oldestTrace[0]);
    }
  }

  /**
   * Record job metrics
   */
  recordJob(jobType, status, duration, environment = 'unknown') {
    if (!this.isEnabled) return;

    this.metrics.jobsByType.inc({
      type: jobType,
      status,
      environment,
    });

    if (duration !== undefined) {
      this.metrics.jobDurationByType.observe(
        { type: jobType, status },
        duration / 1000 // Convert to seconds
      );
    }
  }

  /**
   * Record API metrics
   */
  recordApiCall(method, route, statusCode, duration, userRole = 'unknown') {
    if (!this.isEnabled) return;

    this.metrics.apiLatency.observe(
      {
        method,
        route,
        status_code: statusCode,
        user_role: userRole,
      },
      duration / 1000 // Convert to seconds
    );
  }

  /**
   * Record database query metrics
   */
  recordDatabaseQuery(operation, table, duration, status = 'success') {
    if (!this.isEnabled) return;

    this.metrics.databaseQueryDuration.observe(
      { operation, table, status },
      duration / 1000
    );
  }

  /**
   * Record cache operation
   */
  recordCacheOperation(operation, status) {
    if (!this.isEnabled) return;

    this.metrics.cacheOperations.inc({ operation, status });
  }

  /**
   * Record error
   */
  recordError(errorType, severity, component) {
    if (!this.isEnabled) return;

    this.metrics.errorsByType.inc({
      type: errorType,
      severity,
      component,
    });
  }

  /**
   * Update active connections
   */
  updateActiveConnections(type, count) {
    if (!this.isEnabled) return;

    this.metrics.activeConnections.set({ type }, count);
  }

  /**
   * Update queue size
   */
  updateQueueSize(type, priority, size) {
    if (!this.isEnabled) return;

    this.metrics.queueSize.set({ type, priority }, size);
  }

  /**
   * Update resource usage
   */
  updateResourceUsage(resource, type, value) {
    if (!this.isEnabled) return;

    this.metrics.resourceUsage.set({ resource, type }, value);
  }

  /**
   * Record user activity
   */
  recordUserActivity(userId, action, resource) {
    if (!this.isEnabled) return;

    this.metrics.userActivity.inc({
      user_id: userId,
      action,
      resource,
    });
  }

  /**
   * Update tenant usage
   */
  updateTenantUsage(tenantId, resourceType, value) {
    if (!this.isEnabled) return;

    this.metrics.tenantUsage.set({ tenant_id: tenantId, resource_type: resourceType }, value);
  }

  /**
   * Get metrics registry
   */
  getRegistry() {
    return this.registry;
  }

  /**
   * Get all metrics as Prometheus format
   */
  async getMetrics() {
    if (!this.isEnabled) return '';
    return this.registry.metrics();
  }

  /**
   * Get trace by ID
   */
  getTrace(traceId) {
    return this.traces.get(traceId);
  }

  /**
   * Get recent traces
   */
  getRecentTraces(limit = 100) {
    return Array.from(this.traces.values())
      .sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
      .slice(0, limit);
  }

  /**
   * Start background monitoring tasks
   */
  startBackgroundTasks() {
    // Update system metrics every 30 seconds
    setInterval(() => {
      this.updateSystemMetrics();
    }, 30000);

    // Clean up old traces every 5 minutes
    setInterval(() => {
      this.cleanupOldTraces();
    }, 300000);
  }

  /**
   * Update system metrics
   */
  updateSystemMetrics() {
    try {
      const usage = process.cpuUsage();
      const memUsage = process.memoryUsage();

      // CPU usage (approximate)
      const cpuPercent = (usage.user + usage.system) / 1000000; // Convert to seconds
      this.updateResourceUsage('cpu', 'process', cpuPercent);

      // Memory usage
      this.updateResourceUsage('memory', 'heap_used', memUsage.heapUsed);
      this.updateResourceUsage('memory', 'heap_total', memUsage.heapTotal);
      this.updateResourceUsage('memory', 'rss', memUsage.rss);
      this.updateResourceUsage('memory', 'external', memUsage.external);
    } catch (error) {
      logger.logError(error, { operation: 'updateSystemMetrics' });
    }
  }

  /**
   * Clean up old traces
   */
  cleanupOldTraces() {
    const maxAge = 3600000; // 1 hour
    const now = Date.now();

    for (const [traceId, trace] of this.traces.entries()) {
      if (trace.endTime && (now - trace.endTime) > maxAge) {
        this.traces.delete(traceId);
      }
    }
  }

  /**
   * Generate trace ID
   */
  generateTraceId() {
    return `trace_${Date.now()}_${++this.spanCounter}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate span ID
   */
  generateSpanId() {
    return `span_${Date.now()}_${++this.spanCounter}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create performance benchmark
   */
  async benchmark(operationName, operation) {
    const trace = this.startTrace(operationName);
    const startTime = Date.now();

    try {
      const result = await operation();
      const duration = Date.now() - startTime;

      this.finishTrace(trace.traceId, 'ok');
      this.recordJob(operationName, 'success', duration);

      return { result, duration, traceId: trace.traceId };
    } catch (error) {
      const duration = Date.now() - startTime;

      this.finishTrace(trace.traceId, 'error');
      this.recordJob(operationName, 'error', duration);
      this.recordError(error.constructor.name, 'error', operationName);

      throw error;
    }
  }
}

// Singleton instance
let instance = null;

module.exports = function getEnterpriseMonitoringService() {
  if (!instance) {
    instance = new EnterpriseMonitoringService();
  }
  return instance;
};

module.exports.EnterpriseMonitoringService = EnterpriseMonitoringService;

