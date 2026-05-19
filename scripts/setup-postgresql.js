#!/usr/bin/env node

/**
 * PostgreSQL Database Setup Script
 * This script helps create the PostgreSQL database and user for the application
 * Uses the same database connection pattern as create-default-users.js
 */

const { Sequelize } = require('sequelize');
const databaseService = require('../server/services/databaseService');
const logger = require('../server/utils/logger');
require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL || 'sqlite:./data/vlocity_manager.db';

async function setupPostgreSQLDatabase() {
  try {
    logger.info('🗄️ Setting up PostgreSQL database for Vlocity DataPack Manager...');
    
    // Check if we're using PostgreSQL
    if (!DATABASE_URL.startsWith('postgresql://') && !DATABASE_URL.startsWith('postgres://')) {
      logger.warn('⚠️ Not using PostgreSQL database URL');
      logger.info('Current DATABASE_URL:', DATABASE_URL);
      logger.info('To use PostgreSQL, set DATABASE_URL=postgresql://postgres:password@localhost:5432/vlocity_manager');
      return;
    }
    
    // Extract database name from URL
    const urlParts = DATABASE_URL.split('/');
    const dbName = urlParts[urlParts.length - 1];
    const baseUrl = urlParts.slice(0, -1).join('/') + '/postgres';
    
    logger.info(`📊 Target database: ${dbName}`);
    
    // First, connect to the default 'postgres' database to create our target database
    let adminSequelize;
    try {
      adminSequelize = new Sequelize(baseUrl, {
        logging: false
      });
      
      await adminSequelize.authenticate();
      logger.info('✅ Connected to PostgreSQL admin database');
      
      // Check if target database exists
      const [databases] = await adminSequelize.query(`
        SELECT datname FROM pg_database WHERE datname = '${dbName}';
      `);
      
      if (databases.length === 0) {
        logger.info(`🔨 Creating database "${dbName}"...`);
        await adminSequelize.query(`CREATE DATABASE "${dbName}";`);
        logger.info(`✅ Database "${dbName}" created successfully`);
      } else {
        logger.info(`ℹ️ Database "${dbName}" already exists`);
      }
      
    } catch (error) {
      logger.error(`❌ Failed to create database: ${error.message}`);
      throw error;
    } finally {
      if (adminSequelize) {
        await adminSequelize.close();
      }
    }
    
    // Now connect to our target database using databaseService
    await databaseService.connect();
    logger.info('✅ Connected to PostgreSQL database via databaseService');
    
    // Get the schema name
    const schemaName = process.env.DB_SCHEMA || 'vlocity_datapack_manager';
    
    // Get the query interface for schema operations
    const sequelize = databaseService.getConnection();
    const queryInterface = sequelize.getQueryInterface();
    
    // Create schema if it doesn't exist
    try {
      await queryInterface.createSchema(schemaName, {});
      logger.info(`✅ Schema "${schemaName}" created successfully`);
    } catch (error) {
      if (error.message.includes('already exists')) {
        logger.info(`ℹ️ Schema "${schemaName}" already exists`);
      } else {
        logger.error(`❌ Failed to create schema: ${error.message}`);
        throw error;
      }
    }
    
    // Sync models using the databaseService (this will create tables in the schema)
    logger.info('🔄 Syncing database models...');
    await databaseService.syncModels();
    logger.info('✅ Database models synchronized successfully');
    
    // Test creating a system status record using the models from databaseService
    const { SystemStatus } = require('../server/models');
    const testStatus = await SystemStatus.create({
      component: 'setup-test',
      status: 'healthy',
      message: 'PostgreSQL setup completed successfully'
    });
    
    logger.info(`✅ Test record created with ID: ${testStatus.id}`);
    
    // Clean up test record
    await testStatus.destroy();
    logger.info('✅ Test record cleaned up');
    
    // Get database info and verify tables were created
    const [results] = await sequelize.query('SELECT current_database(), current_schema();');
    if (results && results.length > 0) {
      logger.info('✅ Database setup verification:');
      logger.info(`   Database: ${results[0].current_database}`);
      logger.info(`   Schema: ${results[0].current_schema}`);
    }
    
    // Check if tables were created in the schema
    const [tables] = await sequelize.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = '${schemaName}' 
      ORDER BY table_name;
    `);
    
    if (tables && tables.length > 0) {
      logger.info(`✅ Tables created in schema "${schemaName}":`);
      tables.forEach(table => {
        logger.info(`   - ${table.table_name}`);
      });
    } else {
      logger.warn(`⚠️ No tables found in schema "${schemaName}"`);
    }
    
    logger.info('');
    logger.info('🎉 PostgreSQL database setup completed successfully!');
    logger.info('You can now run: npm run test-schema');
    logger.info('');
    logger.info('Connection details:');
    logger.info(`   URL: ${DATABASE_URL}`);
    logger.info(`   Schema: ${schemaName}`);
    
  } catch (error) {
    logger.error(`❌ Setup failed: ${error.message}`);
    
    // Provide helpful error messages
    if (error.message.includes('does not exist')) {
      logger.info('');
      logger.info('💡 Troubleshooting:');
      logger.info('1. Make sure PostgreSQL is installed and running');
      logger.info('2. Create the database manually:');
      logger.info('   psql -U postgres -c "CREATE DATABASE vlocity_manager;"');
      logger.info('3. Or run: npm run install-postgresql-windows');
      logger.info('4. Or use SQLite by setting DATABASE_URL=sqlite://data/vlocity_manager.db');
    }
    
    throw error;
  } finally {
    // Close connection using databaseService
    await databaseService.disconnect();
    logger.info('🔌 Database connection closed');
  }
}

// Run setup if this script is executed directly
if (require.main === module) {
  setupPostgreSQLDatabase()
    .then(() => {
      logger.info('Setup script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error(`Setup script failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = { setupPostgreSQLDatabase };
