const { Sequelize } = require('sequelize');
const path = require('path');
const logger = require('../utils/logger');

class DatabaseService {
  constructor() {
    this.sequelize = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      // Use PostgreSQL if DATABASE_URL is provided, otherwise fallback to SQLite
      const databaseUrl = process.env.DATABASE_URL || 
        `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'password'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'vlocity_manager'}`;

      // Check if it's a PostgreSQL URL or SQLite fallback
      if (databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')) {
        this.sequelize = new Sequelize(databaseUrl, {
          dialect: 'postgres',
          logging: (msg) => logger.debug(msg),
          pool: {
            max: 10,
            min: 0,
            acquire: 30000,
            idle: 10000
          },
          define: {
            timestamps: true,
            underscored: true,
            freezeTableName: true,
            schema: process.env.DB_SCHEMA || 'vlocity_datapack_manager'
          },
          schema: process.env.DB_SCHEMA || 'vlocity_datapack_manager'
        });
        const schemaName = process.env.DB_SCHEMA || 'vlocity_datapack_manager';
        logger.info(`🔗 Connecting to PostgreSQL database with schema: ${schemaName}...`);
      } else {
        // Fallback to SQLite
        const dbPath = path.join(__dirname, '../../data/vlocity_manager.db');
        this.sequelize = new Sequelize({
          dialect: 'sqlite',
          storage: dbPath,
          logging: (msg) => logger.debug(msg),
          define: {
            timestamps: true,
            underscored: true,
            freezeTableName: true
          }
        });
        logger.info('🔗 Connecting to SQLite database...');
      }

      // Test the connection with retry logic
      await this.connectWithRetry();
      this.isConnected = true;
      
      const dbType = this.sequelize.getDialect();
      logger.info(`✅ ${dbType.toUpperCase()} database connected successfully`);
      
      // Create schema if it doesn't exist (PostgreSQL only)
      if (dbType === 'postgres') {
        await this.createSchemaIfNotExists();
      }
      
      // Sync models (create tables if they don't exist)
      await this.syncModels();
      
      return this.sequelize;
    } catch (error) {
      logger.logError(error, { operation: 'Database connection' });
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Attempt database connection with exponential backoff retry
   * @param {number} maxAttempts - Maximum retry attempts (default: 5)
   * @param {number} initialDelay - Initial delay in ms (default: 1000)
   */
  async connectWithRetry(maxAttempts = 5, initialDelay = 1000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.sequelize.authenticate();
        if (attempt > 1) {
          logger.info(`✅ Database connection succeeded on attempt ${attempt}`);
        }
        return; // Success
      } catch (error) {
        if (attempt === maxAttempts) {
          logger.error(`❌ Database connection failed after ${maxAttempts} attempts`);
          throw error;
        }

        const delay = initialDelay * Math.pow(2, attempt - 1); // Exponential backoff
        logger.warn(`⚠️ Database connection attempt ${attempt} failed. Retrying in ${delay}ms...`, {
          error: error.message
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  async createSchemaIfNotExists() {
    try {
      const schemaName = process.env.DB_SCHEMA || 'vlocity_datapack_manager';
      const queryInterface = this.sequelize.getQueryInterface();
      await queryInterface.createSchema(schemaName, {});
      logger.info(`✅ Schema ${schemaName} created or already exists`);
    } catch (error) {
      // Schema might already exist, which is fine
      if (error.message.includes('already exists')) {
        const schemaName = process.env.DB_SCHEMA || 'vlocity_datapack_manager';
        logger.info(`ℹ️ Schema ${schemaName} already exists`);
      } else {
        logger.logError(error, { operation: 'Schema creation' });
        throw error;
      }
    }
  }

  async syncModels() {
    try {
      // Import models (importing all ensures they are registered on this sequelize instance)
      const { User, Job, OrgAnalysis, Org, SystemStatus, SfdmuConfig } = require('../models');

      // Sync all models - only creates missing tables, never alters or drops existing ones
      await this.sequelize.sync({ alter: false });

      logger.info('✅ Database models synchronized');
    } catch (error) {
      logger.logError(error, { operation: 'Model synchronization' });
      throw error;
    }
  }

  async disconnect() {
    try {
      if (this.sequelize) {
        await this.sequelize.close();
        this.isConnected = false;
        const dbType = this.sequelize.getDialect();
        logger.info(`✅ ${dbType.toUpperCase()} database disconnected`);
      }
    } catch (error) {
      logger.logError(error, { operation: 'Database disconnection' });
      throw error;
    }
  }

  getConnection() {
    return this.sequelize;
  }

  isDatabaseConnected() {
    return this.isConnected;
  }

  getConnectionStatus() {
    return {
      connected: this.isConnected,
      dialect: this.sequelize ? this.sequelize.getDialect() : 'unknown',
      host: this.sequelize ? this.sequelize.options.host : 'unknown',
      database: this.sequelize ? this.sequelize.options.database : 'unknown'
    };
  }
}

module.exports = new DatabaseService();
