#!/usr/bin/env node

/**
 * Migration script to add cli_type column to jobs table
 * This script adds the cli_type field (ENUM: 'vlocity' or 'sf') to the jobs table
 */

const { Sequelize } = require('sequelize');
const path = require('path');
const logger = require('../server/utils/logger');

// Database configuration
const databaseUrl = process.env.DATABASE_URL || 
  `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'password'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'vlocity_manager'}`;

const schema = process.env.DB_SCHEMA || 'vlocity_datapack_manager';

async function migrateCliType() {
  let sequelize;
  
  try {
    console.log('Starting cli_type column migration...');
    
    // Initialize Sequelize connection
    if (databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')) {
      sequelize = new Sequelize(databaseUrl, {
        dialect: 'postgres',
        define: {
          timestamps: true,
          underscored: true,
          freezeTableName: true,
          schema: schema
        },
        schema: schema
      });
    } else {
      throw new Error('This migration is designed for PostgreSQL only');
    }

    // Test connection
    await sequelize.authenticate();
    console.log('✅ Database connection established');

    // Check if the jobs table exists
    const [results] = await sequelize.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = '${schema}' 
        AND table_name = 'jobs'
      );
    `);

    if (!results[0].exists) {
      console.log('❌ Jobs table does not exist. Please run the main setup first.');
      return;
    }

    console.log('✅ Jobs table exists');

    // Check if cli_type column already exists
    const [columnCheck] = await sequelize.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_schema = '${schema}' 
        AND table_name = 'jobs' 
        AND column_name = 'cli_type'
      );
    `);

    if (columnCheck[0].exists) {
      console.log('✅ cli_type column already exists. Migration not needed.');
      return;
    }

    console.log('📝 Adding cli_type column to jobs table...');

    // Add cli_type column with ENUM type
    await sequelize.query(`
      DO $$ 
      BEGIN
        -- Create the enum type if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'jobs_cli_type_enum') THEN
          CREATE TYPE ${schema}.jobs_cli_type_enum AS ENUM ('vlocity', 'sf');
        END IF;
      END $$;
    `);

    // Add the column with default value
    await sequelize.query(`
      ALTER TABLE ${schema}.jobs 
      ADD COLUMN cli_type ${schema}.jobs_cli_type_enum NOT NULL DEFAULT 'vlocity';
    `);

    console.log('✅ cli_type column added successfully');
    console.log('✅ Migration completed successfully');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    logger.logError(error, { operation: 'migrateCliType' });
    process.exit(1);
  } finally {
    if (sequelize) {
      await sequelize.close();
      console.log('✅ Database connection closed');
    }
  }
}

// Run migration
if (require.main === module) {
  migrateCliType()
    .then(() => {
      console.log('Migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration error:', error);
      process.exit(1);
    });
}

module.exports = { migrateCliType };

