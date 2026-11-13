const { Sequelize } = require('sequelize');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

/**
 * Where the SQLite database lives:
 *   DATABASE_URL=sqlite::memory:        -> in-memory (tests)
 *   DATABASE_URL=sqlite:/path/to/app.db -> that file
 *   otherwise                           -> <DATA_DIR>/vlocity_manager.db
 * Paths are resolved with path.resolve so they work on Windows, Linux and macOS.
 */
function resolveSqliteStorage() {
  const url = process.env.DATABASE_URL || '';
  if (/^sqlite:(\/\/)?:memory:?$/i.test(url)) return ':memory:';
  const match = url.match(/^sqlite:(?:\/\/)?(.+)$/i);
  if (match && match[1] && match[1] !== ':memory:') return path.resolve(match[1]);
  const { getDataDir } = require('../utils/secrets');
  return path.join(getDataDir(), 'vlocity_manager.db');
}

class DatabaseService {
  constructor() {
    this.sequelize = null;
    this.isConnected = false;
    this.usingSQLiteFallback = false;
  }

  async connect({ skipMigrations = false } = {}) {
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
          await this._initSQLite(true); // true = this is a fallback, not the primary database
        }
      } else {
        await this._initSQLite(false); // false = SQLite is the intended primary database
      }

      this.isConnected = true;

      const dbType = this.sequelize.getDialect();
      logger.info(`✅ ${dbType.toUpperCase()} database connected successfully`);
      
      // Create schema if it doesn't exist (PostgreSQL only)
      if (dbType === 'postgres') {
        await this.createSchemaIfNotExists();
      }
      
      // Sync models (create tables if they don't exist)
      await this.syncModels({ skipMigrations });
      
      return this.sequelize;
    } catch (error) {
      logger.logError(error, { operation: 'Database connection' });
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Initialize and connect to the internal SQLite database.
   * @param {boolean} isFallback - true when called as a fallback after PostgreSQL failed,
   *   false when SQLite is the primary/intended database (no postgres URL configured).
   */
  async _initSQLite(isFallback = false) {
    const dbPath = resolveSqliteStorage();
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
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
    this.usingSQLiteFallback = isFallback;
    logger.info(`🔗 Connecting to SQLite database at ${dbPath}...`);
    // SQLite is a local file; a short retry window is sufficient.
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

  /**
   * Bind the models to the active connection and bring the schema up to date
   * by running migrations (server/migrations). Replaces sequelize.sync(),
   * which could create tables but never upgrade them.
   */
  async syncModels({ skipMigrations = false } = {}) {
    try {
      const models = require('../models');
      const isSqlite = this.sequelize.getDialect() === 'sqlite';

      // Models are defined at module-load time on a temporary connection (see
      // models/index.js). Rebind them to the active instance. On SQLite drop
      // the PostgreSQL schema so tables use plain names (older fallback
      // databases used "schema.table" names; a migration renames them).
      const modelClasses = [
        models.User,
        models.Job,
        models.OrgAnalysis,
        models.Org,
        models.SystemStatus,
        models.SfdmuConfig,
      ];
      for (const model of modelClasses) {
        if (!model) continue;
        if (isSqlite) {
          model._schema = undefined;
          model.options.schema = undefined;
        }
        if (model.sequelize !== this.sequelize) {
          // Sequelize 6 keeps the instance as a plain writable property
          model.sequelize = this.sequelize;
          this.sequelize.modelManager.addModel(model);
        }
      }
      models.sequelize = this.sequelize;

      if (!skipMigrations) {
        const { runMigrations } = require('../db/migrator');
        const applied = await runMigrations(this.sequelize, { logger });
        if (applied.length) {
          logger.info(`✅ Applied ${applied.length} database migration(s): ${applied.join(', ')}`);
        } else {
          logger.info('✅ Database schema is up to date');
        }
      }
    } catch (error) {
      logger.logError(error, { operation: 'Database migration' });
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
