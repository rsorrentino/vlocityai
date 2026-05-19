const { body, param, query, validationResult } = require('express-validator');
const { ValidationError } = require('./errorHandler');

/**
 * Input validation middleware
 * Provides comprehensive input validation and sanitization
 */

// Common validation rules
const commonRules = {
  id: param('id').isUUID().withMessage('Invalid ID format'),
  page: query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  limit: query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000'),
  username: body('username')
    .trim()
    .isLength({ min: 3, max: 50 })
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username must be 3-50 characters, alphanumeric and underscores only'),
  email: body('email')
    .trim()
    .isEmail()
    .normalizeEmail()
    .withMessage('Invalid email format'),
  password: body('password')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must be at least 8 characters with uppercase, lowercase, number and special character'),
  role: body('role')
    .isIn(['admin', 'developer', 'functional'])
    .withMessage('Invalid role'),
  jobName: body('name')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Job name is required and must be less than 255 characters'),
  orgUsername: body('username')
    .trim()
    .isLength({ min: 1 })
    .withMessage('Organization username is required'),
};

/**
 * Validate request
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(err => ({
      field: err.param,
      message: err.msg,
      value: err.value,
    }));
    throw new ValidationError('Validation failed', errorMessages);
  }
  next();
};

/**
 * Sanitize string input
 */
const sanitizeString = (str) => {
  if (typeof str !== 'string') return str;
  return str
    .trim()
    .replace(/[<>]/g, '') // Remove potential HTML tags
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, ''); // Remove event handlers
};

/**
 * Sanitize object recursively
 */
const sanitizeObject = (obj) => {
  if (typeof obj !== 'object' || obj === null) {
    return typeof obj === 'string' ? sanitizeString(obj) : obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    sanitized[key] = sanitizeObject(value);
  }
  return sanitized;
};

/**
 * Sanitize request body
 */
const sanitizeBody = (req, res, next) => {
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  next();
};

/**
 * Sanitize query parameters
 */
const sanitizeQuery = (req, res, next) => {
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }
  next();
};

module.exports = {
  commonRules,
  validate,
  sanitizeBody,
  sanitizeQuery,
  sanitizeString,
  sanitizeObject,
};

