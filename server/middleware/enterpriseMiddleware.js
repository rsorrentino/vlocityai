/**
 * Enterprise Middleware
 * Integrates enterprise services (monitoring, audit, circuit breaker) into Express
 */

const getEnterpriseMonitoringService = require('../services/enterpriseMonitoringService');
const getAuditService = require('../services/auditService');
const getCircuitBreakerService = require('../services/circuitBreakerService');
const logger = require('../utils/logger');

// Get service instances
const enterpriseMonitoringService = getEnterpriseMonitoringService();
const auditService = getAuditService();
const circuitBreakerService = getCircuitBreakerService();

/**
 * Request monitoring middleware
 */
function monitoringMiddleware(req, res, next) {
  const startTime = Date.now();
  let trace = null;

  // Start trace if monitoring is enabled
  if (enterpriseMonitoringService && enterpriseMonitoringService.isEnabled) {
    try {
      trace = enterpriseMonitoringService.startTrace(`${req.method} ${req.path}`, {
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
    } catch (error) {
      logger.logError(error, { operation: 'monitoringMiddleware.startTrace' });
    }
  }

  // Attach trace to request
  req.trace = trace;

  // Monitor response
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const userRole = req.user?.role || 'anonymous';

    // Record API metrics if monitoring is enabled
    if (enterpriseMonitoringService && enterpriseMonitoringService.isEnabled) {
      try {
        enterpriseMonitoringService.recordApiCall(
          req.method,
          req.path,
          res.statusCode,
          duration,
          userRole
        );

        // Finish trace
        if (trace && trace.traceId) {
          enterpriseMonitoringService.finishTrace(
            trace.traceId,
            res.statusCode >= 400 ? 'error' : 'ok'
          );
        }
      } catch (error) {
        logger.logError(error, { operation: 'monitoringMiddleware.finish' });
      }
    }
  });

  next();
}

/**
 * Audit logging middleware
 */
function auditMiddleware(req, res, next) {
  // Skip audit for health checks and metrics
  if (req.path === '/health' || req.path === '/metrics' || req.path.startsWith('/api/system/status')) {
    return next();
  }

  // Skip if audit service is not enabled
  if (!auditService || !auditService.isEnabled) {
    return next();
  }

  const startTime = Date.now();

  // Log request
  res.on('finish', async () => {
    try {
      const userId = req.user?.id;
      const username = req.user?.username;
      const action = `${req.method.toLowerCase()}_${req.path.replace(/\//g, '_')}`;
      const resourceType = req.path.split('/')[2] || 'unknown';
      const resourceId = req.params.id || req.params.jobId || null;
      const tenantId = req.user?.tenantId || req.headers['x-tenant-id'] || null;

      await auditService.logDataAccess({
        userId,
        username,
        action,
        resourceType,
        resourceId,
        tenantId,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        requestId: req.id || req.headers['x-request-id'],
        sessionId: req.sessionID,
        status: res.statusCode < 400 ? 'success' : 'failed',
        metadata: {
          method: req.method,
          path: req.path,
          query: req.query,
          duration: Date.now() - startTime,
          statusCode: res.statusCode,
        },
      });
    } catch (error) {
      logger.logError(error, { operation: 'auditMiddleware' });
    }
  });

  next();
}

/**
 * Circuit breaker middleware
 */
function circuitBreakerMiddleware(serviceName, config = {}) {
  return async (req, res, next) => {
    try {
      const circuit = circuitBreakerService.getCircuit(serviceName, config);

      // Execute request through circuit breaker
      await circuitBreakerService.execute(
        serviceName,
        async () => {
          // Store original handlers
          const originalSend = res.send.bind(res);
          const originalJson = res.json.bind(res);
          const originalEnd = res.end.bind(res);

          // Wrap response methods to catch errors
          res.send = function(data) {
            if (res.statusCode >= 500) {
              throw new Error(`Service error: ${res.statusCode}`);
            }
            return originalSend(data);
          };

          res.json = function(data) {
            if (res.statusCode >= 500) {
              throw new Error(`Service error: ${res.statusCode}`);
            }
            return originalJson(data);
          };

          res.end = function(data) {
            if (res.statusCode >= 500) {
              throw new Error(`Service error: ${res.statusCode}`);
            }
            return originalEnd(data);
          };

          // Continue to next middleware
          next();
        },
        { config }
      );
    } catch (error) {
      if (error.name === 'CircuitBreakerOpenError') {
        res.status(503).json({
          error: 'Service temporarily unavailable',
          message: error.message,
          retryAfter: 30,
        });
      } else {
        next(error);
      }
    }
  };
}

/**
 * Performance monitoring middleware
 */
function performanceMonitoringMiddleware(req, res, next) {
  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    const duration = Number(process.hrtime.bigint() - startTime) / 1000000; // Convert to milliseconds

    // Log slow requests
    if (duration > 1000) {
      logger.warn('Slow request detected', {
        method: req.method,
        path: req.path,
        duration: `${duration.toFixed(2)}ms`,
        statusCode: res.statusCode,
      });
    }

    // Update resource usage if monitoring is enabled
    if (enterpriseMonitoringService && enterpriseMonitoringService.isEnabled) {
      try {
        enterpriseMonitoringService.updateResourceUsage('api', 'request_duration', duration);
      } catch (error) {
        logger.logError(error, { operation: 'performanceMonitoringMiddleware' });
      }
    }
  });

  next();
}

/**
 * Rate limiting per user/tenant
 */
function userRateLimitMiddleware(maxRequests = 100, windowMs = 60000) {
  const userRequests = new Map();

  setInterval(() => {
    // Clean up old entries
    const now = Date.now();
    for (const [key, value] of userRequests.entries()) {
      if (now - value.resetTime > windowMs) {
        userRequests.delete(key);
      }
    }
  }, windowMs);

  return (req, res, next) => {
    const userId = req.user?.id || req.ip;
    const key = `user_${userId}`;

    const userData = userRequests.get(key) || {
      count: 0,
      resetTime: Date.now(),
    };

    if (Date.now() - userData.resetTime > windowMs) {
      userData.count = 0;
      userData.resetTime = Date.now();
    }

    userData.count++;

    if (userData.count > maxRequests) {
      return res.status(429).json({
        error: 'Too many requests',
        message: `Rate limit exceeded: ${maxRequests} requests per ${windowMs / 1000} seconds`,
        retryAfter: Math.ceil((userData.resetTime + windowMs - Date.now()) / 1000),
      });
    }

    userRequests.set(key, userData);
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - userData.count));
    res.setHeader('X-RateLimit-Reset', new Date(userData.resetTime + windowMs).toISOString());

    next();
  };
}

/**
 * Request ID middleware
 */
function requestIdMiddleware(req, res, next) {
  req.id = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  res.setHeader('X-Request-ID', req.id);
  next();
}

/**
 * Correlation ID middleware
 */
function correlationIdMiddleware(req, res, next) {
  req.correlationId = req.headers['x-correlation-id'] || req.id;
  res.setHeader('X-Correlation-ID', req.correlationId);
  next();
}

module.exports = {
  monitoringMiddleware,
  auditMiddleware,
  circuitBreakerMiddleware,
  performanceMonitoringMiddleware,
  userRateLimitMiddleware,
  requestIdMiddleware,
  correlationIdMiddleware,
};

