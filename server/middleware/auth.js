const authService = require('../services/authService');
const { UnauthorizedError } = require('./errorHandler');
const logger = require('../utils/logger');

// Authentication middleware
const authenticate = async (req, res, next) => {
  try {
    // Prefer httpOnly cookie; fall back to Authorization header for API clients
    let token = req.cookies?.auth_token;
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      throw new UnauthorizedError('No token provided');
    }

    const decoded = authService.verifyToken(token);
    
    // Attach user info to request
    req.user = decoded;
    req.userId = decoded.userId;
    
    next();
  } catch (error) {
    // 401s are expected (browser checks auth on every load) — log at warn, not error
    if (error.name === 'UnauthorizedError') {
      logger.warn('Authentication required', { message: error.message, url: req.url, method: req.method, ip: req.ip });
    } else {
      logger.logError(error, { operation: 'Authentication middleware' });
    }
    next(error);
  }
};

// Authorization middleware
const authorize = (...roles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      if (!roles.includes(req.user.role)) {
        throw new UnauthorizedError('Insufficient permissions');
      }

      next();
    } catch (error) {
      logger.logError(error, { operation: 'Authorization middleware', user: req.user?.username });
      next(error);
    }
  };
};

// Permission-based authorization middleware
const requirePermission = (resource, action) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const hasPermission = await authService.checkPermission(req.userId, resource, action);
      
      if (!hasPermission) {
        throw new UnauthorizedError(`Permission denied: ${action} on ${resource}`);
      }

      next();
    } catch (error) {
      logger.logError(error, { 
        operation: 'Permission check', 
        user: req.user?.username, 
        resource, 
        action 
      });
      next(error);
    }
  };
};

// Admin only middleware
const adminOnly = authorize('admin');

// Developer or Admin middleware
const developerOrAdmin = authorize('developer', 'admin');

// Optional authentication middleware (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const user = await authService.verifyToken(token);
      req.user = user;
    }
    
    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};

module.exports = {
  authenticate,
  authorize,
  requirePermission,
  adminOnly,
  developerOrAdmin,
  optionalAuth
};
