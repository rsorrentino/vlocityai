require('dotenv').config({ path: './.env' });
const { sequelize } = require('../server/models');
const logger = require('../server/utils/logger');

async function migrateSfdmuJobType() {
  logger.info('Starting sfdmu job type migration...');

  try {
    await sequelize.authenticate();
    logger.info('✅ Database connection established');

    const schemaName = process.env.DB_SCHEMA || 'vlocity_datapack_manager';
    const dialect = sequelize.getDialect();

    if (dialect !== 'postgres') {
      logger.info(`Dialect is ${dialect} (not PostgreSQL) — enum migration not needed for SQLite.`);
      return;
    }

    // Check current enum values
    const [enumValues] = await sequelize.query(`
      SELECT enumlabel
      FROM pg_enum
      WHERE enumtypid = (
        SELECT oid
        FROM pg_type
        WHERE typname = 'enum_jobs_type'
          AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = '${schemaName}')
      )
      ORDER BY enumsortorder;
    `);

    const currentValues = enumValues.map(row => row.enumlabel);
    logger.info(`Current enum_jobs_type values: ${currentValues.join(', ')}`);

    if (currentValues.includes('sfdmu')) {
      logger.info('✅ "sfdmu" type already exists in enum. Skipping migration.');
      return;
    }

    // Add 'sfdmu' to the enum
    logger.info('Adding "sfdmu" to enum_jobs_type...');
    await sequelize.query(`
      ALTER TYPE "${schemaName}"."enum_jobs_type"
      ADD VALUE 'sfdmu';
    `);
    logger.info('✅ Added "sfdmu" to enum_jobs_type');

    // Verify
    const [updatedValues] = await sequelize.query(`
      SELECT enumlabel
      FROM pg_enum
      WHERE enumtypid = (
        SELECT oid
        FROM pg_type
        WHERE typname = 'enum_jobs_type'
          AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = '${schemaName}')
      )
      ORDER BY enumsortorder;
    `);
    logger.info(`Updated enum_jobs_type values: ${updatedValues.map(r => r.enumlabel).join(', ')}`);
    logger.info('✅ SFDMU job type migration completed successfully');

  } catch (error) {
    logger.error('❌ SFDMU job type migration failed:', error);
  } finally {
    await sequelize.close();
    logger.info('Database connection closed');
  }
}

migrateSfdmuJobType();
