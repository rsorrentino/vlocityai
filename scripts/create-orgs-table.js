/**
 * Migration: create the `orgs` table for DB-backed org management.
 * Run once after upgrading from the .properties-file-based org list.
 *
 *   npm run migrate-create-orgs
 */
require('dotenv').config({ path: './.env' });
const { sequelize } = require('../server/models');
const logger = require('../server/utils/logger');

async function createOrgsTable() {
  logger.info('Starting orgs table migration…');

  try {
    await sequelize.authenticate();
    logger.info('✅ Database connection established');

    const schema = process.env.DB_SCHEMA || 'vlocity_datapack_manager';
    const dialect = sequelize.getDialect();

    if (dialect === 'sqlite') {
      // SQLite: sync({ force: false }) handles it; import Org model to ensure table exists
      const { Org } = require('../server/models');
      await Org.sync({ force: false });
      logger.info('✅ orgs table created (SQLite)');
      return;
    }

    // PostgreSQL ─────────────────────────────────────────────────────────────

    // 1. Create the ENUM type for last_test_result (if it doesn't exist)
    await sequelize.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'enum_orgs_last_test_result'
            AND n.nspname = '${schema}'
        ) THEN
          CREATE TYPE "${schema}"."enum_orgs_last_test_result"
            AS ENUM ('success', 'failure', 'unknown');
        END IF;
      END
      $$;
    `);
    logger.info('✅ ENUM type enum_orgs_last_test_result ready');

    // 2. Create the orgs table (idempotent)
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS "${schema}"."orgs" (
        "id"                UUID          NOT NULL DEFAULT gen_random_uuid(),
        "username"          VARCHAR(255)  NOT NULL,
        "alias"             VARCHAR(255),
        "label"             VARCHAR(255),
        "instance_url"      VARCHAR(255),
        "org_id"            VARCHAR(255),
        "is_sandbox"        BOOLEAN       NOT NULL DEFAULT false,
        "is_dev_hub"        BOOLEAN       NOT NULL DEFAULT false,
        "environment"       VARCHAR(255),
        "notes"             TEXT,
        "last_tested_at"    TIMESTAMP WITH TIME ZONE,
        "last_test_result"  "${schema}"."enum_orgs_last_test_result" DEFAULT 'unknown',
        "last_test_message" VARCHAR(255),
        "connected_status"  VARCHAR(255),
        "created_at"        TIMESTAMP WITH TIME ZONE NOT NULL,
        "updated_at"        TIMESTAMP WITH TIME ZONE NOT NULL,
        PRIMARY KEY ("id"),
        CONSTRAINT "orgs_username_key" UNIQUE ("username")
      );
    `);
    logger.info('✅ orgs table created (or already exists)');

    logger.info('✅ Orgs table migration completed successfully');
  } catch (error) {
    logger.error('❌ Orgs table migration failed:', error.message);
    process.exit(1);
  } finally {
    await sequelize.close();
    logger.info('Database connection closed');
  }
}

createOrgsTable();
