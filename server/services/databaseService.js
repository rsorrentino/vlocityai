const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

class DatabaseService {
  constructor() {
    this.sequelize = null;
    this.isConnected = false;
    this.usingSQLiteFallback = false;
  }

  async connect() {
    try {
      // Use PostgreSQL if DATABASE_URL is provided, otherwise use SQLite directly
      const databaseUrl = process.env.DATABASE_URL || 
        `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'password'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'vlocity_manager'}`;

      const isPostgres = databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://');

      if (isPostgres) {
        const schemaName = process.env.DB_SCHEMA || 'vlocity_datapack_manager';
        logger.info(`🔗 Connecting to PostgreSQL database with schema: ${schemaName}...`);
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
            schema: schemaName
          },
          schema: schemaName
        });

        try {
          await this.connectWithRetry();
        } catch (pgError) {
          logger.warn(`⚠️  PostgreSQL unavailable (${pgError.message}). Falling back to internal SQLite database...`);
          await this._initSQLite();
        }
      } else {
        await this._initSQLite();
      }

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
   * Initialize and connect to the internal SQLite database.
   * This is used as the primary database when no PostgreSQL URL is configured,
   * and as a fallback when PostgreSQL is unavailable.
   */
  async _initSQLite() {
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, 'vlocity_manager.db');
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
    this.usingSQLiteFallback = true;
    logger.info(`🔗 Connecting to SQLite database at ${dbPath}...`);
    await this.connectWithRetry(3, 200);
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
      const models = require('../models');

      // Rebind all Sequelize model classes to the active connection so that:
      //   1. ORM queries (User.findOne, etc.) go through this connection.
      //   2. sequelize.sync() knows which tables to create.
      //
      // Models are defined on a temporary connection in models/index.js at
      // module-load time (before databaseService.connect() is called). The
      // rebind below updates each model's internal _sequelize reference and
      // registers it with this instance's ModelManager, ensuring consistent
      // behaviour regardless of whether we are using PostgreSQL or the SQLite
      // fallback.
      const modelClasses = [
        models.User,
        models.Job,
        models.OrgAnalysis,
        models.Org,
        models.SystemStatus,
        models.SfdmuConfig,
      ];

      for (const model of modelClasses) {
        if (model && model._sequelize !== this.sequelize) {
          model._sequelize = this.sequelize;
          this.sequelize.modelManager.addModel(model);
        }
      }

      // Keep the exported sequelize reference in sync so callers that
      // destructure it (e.g. `const { sequelize } = require('../models')`)
      // after this point receive the active instance.
      models.sequelize = this.sequelize;

      // Sync all models — creates missing tables without altering or dropping
      // existing ones.  This is particularly important for the SQLite fallback
      // where no prior migrations have been run.
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
      database: this.sequelize ? this.sequelize.options.database : 'unknown',
      usingSQLiteFallback: this.usingSQLiteFallback,
    };
  }
}

module.exports = new DatabaseService();
