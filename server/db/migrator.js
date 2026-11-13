/**
 * Database migrations (Umzug). Runs automatically on startup and from the CLI:
 *
 *   npm run db:migrate          apply pending migrations
 *   npm run db:migrate:status   list applied / pending
 *   npm run db:migrate:undo     revert the last migration
 *
 * Applied migrations are recorded in the SequelizeMeta table (the same table
 * and format sequelize-cli uses), in DB_SCHEMA on PostgreSQL.
 */
const fs = require('fs');
const path = require('path');
const { Sequelize } = require('sequelize');
const { Umzug, SequelizeStorage } = require('umzug');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

function listMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{14}-.+\.js$/.test(f))
    .sort();
}

/**
 * @param {import('sequelize').Sequelize} sequelize
 * @param {{logger?: {info:Function, warn:Function}}} [opts]
 */
function createMigrator(sequelize, { logger } = {}) {
  const isPostgres = sequelize.getDialect() === 'postgres';
  const queryInterface = sequelize.getQueryInterface();

  const migrations = listMigrationFiles().map((name) => {
    const file = path.join(MIGRATIONS_DIR, name);
    return {
      name,
      up: async () => require(file).up(queryInterface, Sequelize),
      down: async () => require(file).down(queryInterface, Sequelize),
    };
  });

  return new Umzug({
    migrations,
    context: queryInterface,
    storage: new SequelizeStorage({
      sequelize,
      tableName: 'SequelizeMeta',
      ...(isPostgres ? { schema: process.env.DB_SCHEMA || 'vlocity_datapack_manager' } : {}),
    }),
    logger: logger
      ? {
          info: (e) => logger.info(typeof e === 'string' ? e : `Migration ${e.event}: ${e.name || ''}`.trim()),
          warn: (e) => logger.warn(typeof e === 'string' ? e : JSON.stringify(e)),
          error: (e) => logger.warn(typeof e === 'string' ? e : JSON.stringify(e)),
          debug: () => {},
        }
      : undefined,
  });
}

/** Apply all pending migrations. @returns {Promise<string[]>} names applied */
async function runMigrations(sequelize, opts) {
  const migrator = createMigrator(sequelize, opts);
  const applied = await migrator.up();
  return applied.map((m) => m.name);
}

module.exports = { createMigrator, runMigrations, listMigrationFiles, MIGRATIONS_DIR };

// CLI: node server/db/migrator.js [up|down|status]
if (require.main === module) {
  require('dotenv').config();
  (async () => {
    const databaseService = require('../services/databaseService');
    await databaseService.connect({ skipMigrations: true });
    const migrator = createMigrator(databaseService.sequelize, { logger: console });
    const cmd = process.argv[2] || 'up';
    if (cmd === 'up') {
      const done = await migrator.up();
      console.log(done.length ? `Applied: ${done.map((m) => m.name).join(', ')}` : 'Database is up to date');
    } else if (cmd === 'down') {
      const undone = await migrator.down();
      console.log(undone.length ? `Reverted: ${undone.map((m) => m.name).join(', ')}` : 'Nothing to revert');
    } else if (cmd === 'status') {
      const executed = await migrator.executed();
      const pending = await migrator.pending();
      executed.forEach((m) => console.log(`  up       ${m.name}`));
      pending.forEach((m) => console.log(`  pending  ${m.name}`));
    } else {
      throw new Error(`Unknown command: ${cmd} (use up, down or status)`);
    }
    await databaseService.disconnect();
  })().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
