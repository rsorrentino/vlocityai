'use strict';

/**
 * SQLite only. When PostgreSQL was configured but unreachable, older versions
 * fell back to SQLite while keeping the PostgreSQL schema on the models, so
 * tables were created as "vlocity_datapack_manager.users" etc. From now on
 * SQLite always uses plain table names; rename legacy tables in place so no
 * data is lost.
 */
const { SCHEMA, dialectOf } = require('../db/migrationHelpers');

const TABLES = ['users', 'jobs', 'org_analyses', 'orgs', 'system_statuses', 'sfdmu_configs', 'chat_conversations', 'chat_messages', 'audit_logs'];

async function sqliteTables(sequelize) {
  const [rows] = await sequelize.query("SELECT name FROM sqlite_master WHERE type = 'table'");
  return new Set(rows.map((r) => r.name));
}

module.exports = {
  async up(queryInterface) {
    if (dialectOf(queryInterface) !== 'sqlite') return;
    const { sequelize } = queryInterface;
    const prefix = `${SCHEMA()}.`;
    const existing = await sqliteTables(sequelize);

    for (const table of TABLES) {
      const legacy = prefix + table;
      if (!existing.has(legacy)) continue;
      if (existing.has(table)) {
        const [[{ count }]] = await sequelize.query(`SELECT COUNT(*) AS count FROM "${table}"`);
        if (Number(count) > 0) {
          // Both hold data – leave them for a manual decision rather than guess
          // eslint-disable-next-line no-console
          console.warn(`Migration: both "${legacy}" and "${table}" contain data; keeping "${table}" and leaving "${legacy}" untouched.`);
          continue;
        }
        await sequelize.query(`DROP TABLE "${table}"`);
      }
      await sequelize.query(`ALTER TABLE "${legacy}" RENAME TO "${table}"`);
    }
  },

  async down() {
    // Irreversible by design: the prefixed names were an accident.
  },
};
