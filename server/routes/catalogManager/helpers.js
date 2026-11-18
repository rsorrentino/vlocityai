const { ValidationError } = require('../../middleware/errorHandler');

/** Extract the Salesforce username from the query string; it is required. */
function requireUsername(query) {
  const { username } = query;
  if (!username) throw new ValidationError('username query parameter is required');
  return username;
}

module.exports = { requireUsername };
