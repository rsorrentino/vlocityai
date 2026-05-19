/**
 * Form validation utilities
 * Provides reusable validation functions for common form fields
 */

/**
 * Validate job name
 * @param {string} name - Job name to validate
 * @returns {string|null} - Error message or null if valid
 */
export const validateJobName = (name) => {
  if (!name || !name.trim()) {
    return 'Job name is required';
  }
  if (name.length < 3) {
    return 'Job name must be at least 3 characters';
  }
  if (name.length > 100) {
    return 'Job name must be less than 100 characters';
  }
  if (!/^[a-zA-Z0-9\s\-_]+$/.test(name)) {
    return 'Job name can only contain letters, numbers, spaces, hyphens, and underscores';
  }
  return null;
};

/**
 * Validate project path
 * @param {string} path - Project path to validate
 * @returns {string|null} - Error message or null if valid
 */
export const validateProjectPath = (path) => {
  if (!path || !path.trim()) {
    return 'Project path is required';
  }
  if (!/^\.\/[\w\-/]+$/.test(path)) {
    return 'Project path must be a valid relative path starting with ./ (e.g., ./export/my-export)';
  }
  return null;
};

/**
 * Validate SOQL query
 * @param {string} query - SOQL query to validate
 * @returns {string|null} - Error message or null if valid
 */
export const validateSOQL = (query) => {
  if (!query || !query.trim()) {
    return 'Query is required';
  }
  const upperQuery = query.trim().toUpperCase();
  if (!upperQuery.startsWith('SELECT')) {
    return 'Query must start with SELECT';
  }
  if (!upperQuery.includes('FROM')) {
    return 'Query must include FROM clause';
  }
  return null;
};

/**
 * Validate email address
 * @param {string} email - Email to validate
 * @returns {string|null} - Error message or null if valid
 */
export const validateEmail = (email) => {
  if (!email || !email.trim()) {
    return 'Email is required';
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return 'Please enter a valid email address';
  }
  return null;
};

/**
 * Validate username
 * @param {string} username - Username to validate
 * @returns {string|null} - Error message or null if valid
 */
export const validateUsername = (username) => {
  if (!username || !username.trim()) {
    return 'Username is required';
  }
  if (username.length < 3) {
    return 'Username must be at least 3 characters';
  }
  if (username.length > 50) {
    return 'Username must be less than 50 characters';
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return 'Username can only contain letters, numbers, dots, hyphens, and underscores';
  }
  return null;
};

/**
 * Validate password
 * @param {string} password - Password to validate
 * @returns {string|null} - Error message or null if valid
 */
export const validatePassword = (password) => {
  if (!password) {
    return 'Password is required';
  }
  if (password.length < 8) {
    return 'Password must be at least 8 characters';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must contain at least one lowercase letter';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least one number';
  }
  if (!/[!@#$%^&*]/.test(password)) {
    return 'Password must contain at least one special character (!@#$%^&*)';
  }
  return null;
};

/**
 * Validate required field
 * @param {any} value - Value to validate
 * @param {string} fieldName - Name of the field for error message
 * @returns {string|null} - Error message or null if valid
 */
export const validateRequired = (value, fieldName = 'This field') => {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
    return `${fieldName} is required`;
  }
  return null;
};

/**
 * Validate number range
 * @param {number} value - Number to validate
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @param {string} fieldName - Name of the field for error message
 * @returns {string|null} - Error message or null if valid
 */
export const validateNumberRange = (value, min, max, fieldName = 'Value') => {
  if (isNaN(value)) {
    return `${fieldName} must be a number`;
  }
  if (value < min) {
    return `${fieldName} must be at least ${min}`;
  }
  if (value > max) {
    return `${fieldName} must be at most ${max}`;
  }
  return null;
};

/**
 * Validate job configuration object
 * @param {Object} job - Job configuration to validate
 * @returns {Object} - Object with field names as keys and error messages as values
 */
export const validateJobConfig = (job) => {
  const errors = {};

  // Validate name
  const nameError = validateJobName(job.name);
  if (nameError) errors.name = nameError;

  // Validate project path
  const pathError = validateProjectPath(job.projectPath);
  if (pathError) errors.projectPath = pathError;

  // Validate queries (if present)
  if (job.queries && Array.isArray(job.queries)) {
    job.queries.forEach((query, index) => {
      const queryText = query.query || query.soql_query || '';
      const queryError = validateSOQL(queryText);
      if (queryError) {
        errors[`query_${index}`] = queryError;
      }
    });
  }

  return errors;
};

/**
 * Check if validation errors object has any errors
 * @param {Object} errors - Validation errors object
 * @returns {boolean} - True if there are errors, false otherwise
 */
export const hasErrors = (errors) => {
  return Object.keys(errors).length > 0;
};
