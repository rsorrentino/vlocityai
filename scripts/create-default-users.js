#!/usr/bin/env node
/**
 * Create the initial administrator account (if the database has no users).
 *
 *   ADMIN_USERNAME=admin ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='...' npm run create-users
 *
 * When ADMIN_PASSWORD is omitted a random password is generated and written to
 * <DATA_DIR>/initial-admin-password.txt. Additional users are created from the
 * User Management page.
 */
require('dotenv').config();

const databaseService = require('../server/services/databaseService');

async function main() {
  await databaseService.connect();
  const authService = require('../server/services/authService');
  const result = await authService.ensureAdminUser();
  if (!result.created) {
    console.log('Users already exist – nothing to do.');
  }
  await databaseService.disconnect();
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}

module.exports = { main };
