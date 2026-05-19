// Load environment variables FIRST
require('dotenv').config();

// Initialize Sentry BEFORE other imports for proper error tracking
const Sentry = require('@sentry/node');
let ProfilingIntegration = null;
try {
  ({ ProfilingIntegration } = require('@sentry/profiling-node'));
} catch (e) {
  console.warn('Sentry profiling not available on this Node runtime; continuing without it.');
}

// Initialize Sentry if DSN is provided
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      ...(ProfilingIntegration ? { profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0, integrations: [new ProfilingIntegration()] } : {}),
    ignoreErrors: ['ValidationError', 'UnauthorizedError', 'NotFoundError'],
  });
  console.log('✅ Sentry error tracking initialized');
} else {
  console.log('ℹ️  Sentry DSN not configured - error tracking disabled');
}

const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const slowDown = require('express-slow-down');
const path = require('path');

const logger = require('./utils/logger');
const { errorHandler } = require('./middleware/errorHandler');
const { validateEnvironment } = require('./utils/configValidator');
const jobMonitor = require('./services/jobMonitor');
const databaseService = require('./services/databaseService');
const cacheService = require('./services/cacheService');
const systemStatusService = require('./services/systemStatusService');

// Enterprise Services
const getEnterpriseMonitoringService = require('./services/enterpriseMonitoringService');
const getAuditService = require('./services/auditService');
const getCircuitBreakerService = require('./services/circuitBreakerService');
const getEnterpriseJobQueueService = require('./services/enterpriseJobQueueService');

// Get service instances
const enterpriseMonitoringService = getEnterpriseMonitoringService();
const auditService = getAuditService();
const circuitBreakerService = getCircuitBreakerService();
const enterpriseJobQueueService = getEnterpriseJobQueueService();

// Enterprise Middleware
const {
  monitoringMiddleware,
  auditMiddleware,
  performanceMonitoringMiddleware,
  requestIdMiddleware,
  correlationIdMiddleware,
  userRateLimitMiddleware,
} = require('./middleware/enterpriseMiddleware');

// Import routes
const authRoutes = require('./routes/auth');
const orgRoutes = require('./routes/orgs');
const exportRoutes = require('./routes/exports');
const deployRoutes = require('./routes/deploys');
const jobRoutes = require('./routes/jobs');
const configRoutes = require('./routes/config');
const logsRoutes = require('./routes/logs');
const vlocityRoutes = require('./routes/vlocity');
const vlocityCommandsRoutes = require('./routes/vlocityCommands');
const yamlRoutes = require('./routes/yaml');
const systemRoutes = require('./routes/system');
const vlocityPricingRoutes = require('./routes/vlocityPricing');
const environmentsRoutes = require('./routes/environments');
const loggingRoutes = require('./routes/logging');
const tempFilesRoutes = require('./routes/tempFiles');
const vlocityVersionsRoutes = require('./routes/vlocityVersions');
const propertiesRoutes = require('./routes/properties');
const salesforceApiRoutes = require('./routes/salesforceApi');
const countriesRoutes = require('./routes/countries');
const vlocityPricingApiRoutes = require('./routes/vlocityPricingApi');
const vlocityPromotionsApiRoutes = require('./routes/vlocityPromotionsApi');
const enhancedVlocityPricingApiRoutes = require('./routes/enhancedVlocityPricingApi');
const validationApiRoutes = require('./routes/validationApi');
const validationFixApiRoutes = require('./routes/validationFixApi');
const exportDataRoutes = require('./routes/exportData');
const auditApiRoutes = require('./routes/auditApi');
const backupRestoreRoutes = require('./routes/backupRestore');
const performanceMonitoringRoutes = require('./routes/performanceMonitoring');
const envComparisonRoutes = require('./routes/envComparison');
const catalogManagerRoutes = require('./routes/catalogManager');
const sfdmuRoutes = require('./routes/sfdmu');
const exportAnalysisRoutes = require('./routes/exportAnalysis');
const exportHealthRoutes = require('./routes/exportHealth');
const notificationRoutes = require('./routes/notifications');
const pipelineRoutes = require('./routes/pipelines');
const serviceCreationRoutes = require('./routes/serviceCreation');
const chatRoutes = require('./routes/chat');

const app = express();
const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3001;

// Sentry request handler must be the first middleware on the app
if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.requestHandler());
  // TracingHandler creates a trace for every incoming request
  app.use(Sentry.Handlers.tracingHandler());
}

// Validate environment configuration
try {
  validateEnvironment();
} catch (error) {
  logger.logError(error);
  // In production, fail fast. In development, continue with warnings.
  if (process.env.NODE_ENV === 'production') {
    throw error;
  }
  logger.warn('Continuing with validation errors in development mode');
}

// Trust proxy for rate limiting
app.set('trust proxy', 1);

// Compression middleware
app.use(compression());

// Input validation and sanitization (early in middleware chain)
try {
  const { sanitizeBody, sanitizeQuery } = require('./middleware/inputValidation');
  app.use(sanitizeBody);
  app.use(sanitizeQuery);
} catch (error) {
  logger.warn('Input validation middleware not available', { error: error.message });
}

// Security middleware
// Configure helmet for local network access (relaxed for development)
const isProduction = process.env.NODE_ENV === 'production';
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", ...(isProduction ? [] : ["'unsafe-inline'"])], // Allow inline scripts in dev only
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  // Disable HSTS (HTTPS enforcement) for local development
  hsts: isProduction ? {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  } : false,
  // Relax Cross-Origin-Opener-Policy for local network access
  crossOriginOpenerPolicy: isProduction ? { policy: "same-origin" } : false,
  // Relax Cross-Origin-Embedder-Policy for local network access
  crossOriginEmbedderPolicy: isProduction ? true : false,
  // Allow cross-origin resource sharing
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// Slow down middleware for additional protection
app.use(slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 50, // allow 50 requests per 15 minutes, then...
  delayMs: () => 500 // begin adding 500ms of delay per request above 50 (v2 format)
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});
app.use(limiter);

// CORS configuration
// Allow access from other machines on the network
const corsOrigins = process.env.CORS_ORIGIN 
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
  : process.env.NODE_ENV === 'production' 
    ? ['https://yourdomain.com'] 
    : true; // In development, allow all origins for network access

app.use(cors({
  origin: corsOrigins,
  credentials: true,
}));

// Enterprise Middleware (must be early in the middleware chain)
app.use(requestIdMiddleware);
app.use(correlationIdMiddleware);
app.use(monitoringMiddleware);
app.use(auditMiddleware);
app.use(performanceMonitoringMiddleware);

// User rate limiting (after authentication middleware would be added)
// app.use('/api', userRateLimitMiddleware(100, 900000)); // 100 requests per 15 minutes

// Logging middleware
app.use(morgan('combined', {
  stream: {
    write: (message) => logger.info(message.trim())
  }
}));

// Body parsing middleware
// Set reasonable limits for JSON and URL-encoded bodies
// 10mb should handle large job configurations and YAML files
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Static files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/logs', express.static(path.join(__dirname, '../logs')));

// Swagger API Documentation
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');

// Swagger UI requires 'unsafe-eval' — disable CSP only for this route
app.use('/api-docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Vlocity DataPack Manager API',
  customfavIcon: '/favicon.ico',
}));

// Swagger JSON endpoint
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

logger.info('📚 Swagger API documentation available at /api-docs');

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: process.env.npm_package_version || '1.0.0',
    enterprise: {
      monitoring: enterpriseMonitoringService.isEnabled,
      audit: auditService.isEnabled,
      jobQueue: enterpriseJobQueueService.isEnabled,
    }
  });
});

// Metrics endpoint for Prometheus
app.get('/metrics', async (req, res) => {
  if (enterpriseMonitoringService.isEnabled) {
    try {
      const metrics = await enterpriseMonitoringService.getMetrics();
      res.set('Content-Type', 'text/plain');
      res.send(metrics);
    } catch (error) {
      logger.logError(error, { operation: 'metrics_endpoint' });
      res.status(500).send('# Error generating metrics\n');
    }
  } else {
    res.status(404).send('# Metrics not enabled\n');
  }
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/orgs', orgRoutes);
app.use('/api/exports', exportRoutes);
app.use('/api/deploys', deployRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/config', configRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/vlocity', vlocityRoutes);
app.use('/api/vlocity-commands', vlocityCommandsRoutes);
app.use('/api/yaml', yamlRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/vlocity/pricing', vlocityPricingRoutes);
app.use('/api/environments', environmentsRoutes);
app.use('/api/logging', loggingRoutes);
app.use('/api/temp-files', tempFilesRoutes);
app.use('/api/vlocity/versions', vlocityVersionsRoutes);
app.use('/api/properties', propertiesRoutes);
app.use('/api/salesforce', salesforceApiRoutes);
app.use('/api/countries', countriesRoutes);
app.use('/api/vlocity/pricing-api', vlocityPricingApiRoutes);
app.use('/api/vlocity/enhanced-pricing', enhancedVlocityPricingApiRoutes);
app.use('/api/vlocity/promotions', vlocityPromotionsApiRoutes);
app.use('/api/validation', validationApiRoutes);
app.use('/api/export', exportDataRoutes);
app.use('/api/audit', auditApiRoutes);
app.use('/api/backup', backupRestoreRoutes);
app.use('/api/performance', performanceMonitoringRoutes);
app.use('/api/env-comparison', envComparisonRoutes);
app.use('/api/catalog', catalogManagerRoutes);
app.use('/api/sfdmu', sfdmuRoutes);
app.use('/api/exports', exportAnalysisRoutes);
app.use('/api/export-health', exportHealthRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/pipelines', pipelineRoutes);
app.use('/api/service-creation', serviceCreationRoutes);
app.use('/api/chat', chatRoutes);

// Sentry error handler (must be before other error middleware)
if (process.env.SENTRY_DSN) {
  app.use(Sentry.Handlers.errorHandler());
}

// Error handling middleware (must come after API routes)
app.use('/api/*', errorHandler);

// Serve React app (catch-all must come AFTER all API routes and Swagger)
// Serve static files with proper headers for cross-origin access
const staticOptions = {
  index: false, // Don't serve index.html automatically
  setHeaders: (res, filePath) => {
    // Set CORS headers for static assets
    res.setHeader('Access-Control-Allow-Origin', corsOrigins === true ? '*' : (Array.isArray(corsOrigins) ? corsOrigins[0] : '*'));
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    // Set proper content types
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    } else if (filePath.endsWith('.json')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    } else if (filePath.endsWith('.ico')) {
      res.setHeader('Content-Type', 'image/x-icon');
    }
  }
};

if (process.env.NODE_ENV === 'production') {
  // Serve static files, but exclude server routes
  app.use(express.static(path.join(__dirname, '../client/build'), staticOptions));
  
  // Catch-all for React Router - Exclude API and Swagger routes
  app.get('*', (req, res, next) => {
    // Don't handle API routes, Swagger, or static assets
    if (req.path.startsWith('/api/') || 
        req.path.startsWith('/api-docs') || 
        req.path.startsWith('/uploads/') || 
        req.path.startsWith('/logs/') ||
        req.path === '/health') {
      return next();
    }
    res.sendFile(path.join(__dirname, '../client/build/index.html'));
  });
} else {
  const frontendPort = parseInt(process.env.CLIENT_PORT, 10);

  // If CLIENT_PORT is provided (dev-full mode), frontend should be served by react-scripts.
  // Otherwise, keep legacy behavior and serve client/build from backend in development.
  if (!Number.isNaN(frontendPort)) {
    app.get('*', (req, res, next) => {
      // Don't handle API routes, Swagger, uploads/logs, or health checks
      if (req.path.startsWith('/api/') || 
          req.path.startsWith('/api-docs') || 
          req.path.startsWith('/uploads/') || 
          req.path.startsWith('/logs/') ||
          req.path === '/health') {
        return next();
      }

      return res.redirect(`http://localhost:${frontendPort}${req.originalUrl}`);
    });
  } else {
    app.use(express.static(path.join(__dirname, '../client/build'), staticOptions));

    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || 
          req.path.startsWith('/api-docs') || 
          req.path.startsWith('/uploads/') || 
          req.path.startsWith('/logs/') ||
          req.path === '/health') {
        return next();
      }
      res.sendFile(path.join(__dirname, '../client/build/index.html'));
    });
  }
}

// Initialize services
const initializeServices = async () => {
  try {
    // Connect to database
    await databaseService.connect();
    
    // Connect to Redis cache
    await cacheService.connect();
    
    // Start system status monitoring
    await systemStatusService.start();
    
    // Initialize Enterprise Services
    try {
      // Initialize audit service (creates tables if needed)
      await auditService.initializeDatabase();
      logger.info('✅ Enterprise Audit Service initialized');
    } catch (error) {
      logger.warn('⚠️ Enterprise Audit Service initialization failed (continuing):', error.message);
    }
    
    // Enterprise monitoring is auto-initialized when imported
    if (enterpriseMonitoringService.isEnabled) {
      logger.info('✅ Enterprise Monitoring Service enabled');
    }
    
    // Enterprise job queue is auto-initialized when imported
    if (enterpriseJobQueueService.isEnabled) {
      logger.info('✅ Enterprise Job Queue Service enabled');
    }
    
    logger.info('✅ All services initialized successfully');
  } catch (error) {
    logger.logError(error, { operation: 'Service initialization' });
    // Continue startup even if some services fail
  }
};

// Start server with automatic port fallback when the desired port is already in use.
let server;
const startServer = (port) => {
  const candidatePort = Number(port) || DEFAULT_PORT;
  const httpServer = app.listen(candidatePort);

  httpServer.on('listening', async () => {
    process.env.PORT = String(candidatePort);
    server = httpServer;

    logger.info(`🚀 Vlocity DataPack Manager server running on port ${candidatePort}`);
    logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`🔗 Health check: http://localhost:${candidatePort}/health`);
    logger.info(`📚 API Documentation: http://localhost:${candidatePort}/api-docs`);

    // Initialize services
    await initializeServices();

    // Wait a moment for database to be fully ready
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Create default users
    const authService = require('./services/authService');
    await authService.createDefaultUsers();

    // Migrate orgs from environments.properties on first startup
    const orgService = require('./services/orgService');
    const propertiesFilePath = require('path').join(__dirname, '../environments.properties');
    await orgService.migrateFromProperties(propertiesFilePath)
      .catch(err => logger.warn('Org migration from properties skipped', { error: err.message }));

    // Initialize WebSocket job monitoring
    jobMonitor.initialize(server);
    logger.info(`🔌 WebSocket job monitoring enabled at ws://localhost:${candidatePort}/ws/jobs`);
  });

  httpServer.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      const nextPort = candidatePort + 1;
      logger.warn(`Port ${candidatePort} is already in use. Retrying on port ${nextPort}...`);
      startServer(nextPort);
      return;
    }

    logger.logError(error, { operation: 'HTTP server startup' });
    process.exit(1);
  });
};

startServer(DEFAULT_PORT);

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received, shutting down gracefully`);
  
  try {
    if (!server) {
      logger.info('Server was not started yet; exiting');
      process.exit(0);
    }

    // Stop accepting new connections
    server.close(async () => {
      logger.info('HTTP server closed');
      
      // Stop services
      await systemStatusService.stop();
      await cacheService.disconnect();
      await databaseService.disconnect();
      
      logger.info('All services stopped');
      process.exit(0);
    });
    
    // Force close after 30 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
    
  } catch (error) {
    logger.logError(error, { operation: 'Graceful shutdown' });
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;
