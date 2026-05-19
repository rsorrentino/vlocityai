require('dotenv').config({ path: './.env' });
const { sequelize } = require('../server/models');
const logger = require('../server/utils/logger');

async function migrateJobAbortStatus() {
  logger.info('Starting job abort status migration...');

  try {
    await sequelize.authenticate();
    logger.info('✅ Database connection established');

    const schemaName = process.env.DB_SCHEMA || 'vlocity_datapack_manager';

    // Check if the jobs table exists
    const [results] = await sequelize.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = '${schemaName}'
        AND table_name = 'jobs'
      );
    `);

    if (!results[0].exists) {
      logger.warn(`Jobs table does not exist in schema ${schemaName}. Skipping migration.`);
      return;
    }
    logger.info('✅ Jobs table exists');

    // Check current enum values
    const [enumValues] = await sequelize.query(`
      SELECT enumlabel 
      FROM pg_enum 
      WHERE enumtypid = (
        SELECT oid 
        FROM pg_type 
        WHERE typname = 'enum_jobs_status'
      )
      ORDER BY enumsortorder;
    `);

    const currentValues = enumValues.map(row => row.enumlabel);
    logger.info(`Current enum values: ${currentValues.join(', ')}`);

    if (currentValues.includes('aborted')) {
      logger.info('✅ "aborted" status already exists in enum. Skipping migration.');
      return;
    }

    // Add 'aborted' to the enum
    logger.info('Adding "aborted" status to enum...');
    await sequelize.query(`
      ALTER TYPE "${schemaName}"."enum_jobs_status" 
      ADD VALUE 'aborted';
    `);
    logger.info('✅ Added "aborted" status to enum');

    // Verify the migration
    const [updatedEnumValues] = await sequelize.query(`
      SELECT enumlabel 
      FROM pg_enum 
      WHERE enumtypid = (
        SELECT oid 
        FROM pg_type 
        WHERE typname = 'enum_jobs_status'
      )
      ORDER BY enumsortorder;
    `);

    const updatedValues = updatedEnumValues.map(row => row.enumlabel);
    logger.info(`Updated enum values: ${updatedValues.join(', ')}`);

    logger.info('✅ Job abort status migration completed successfully');

  } catch (error) {
    logger.error('❌ Job abort status migration failed:', error);
  } finally {
    await sequelize.close();
    logger.info('Database connection closed');
    logger.info('Migration completed');
  }
}

migrateJobAbortStatus();
