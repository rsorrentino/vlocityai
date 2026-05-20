require('dotenv').config();
const path = require('path');

const config = {
  development: {
    dialect: 'sqlite',
    storage: path.join(__dirname, '../../data/vlocity_manager.db'),
    logging: console.log,
  },
  test: {
    dialect: 'sqlite',
    storage: ':memory:',
    logging: false,
  },
  production: {
    url: process.env.DATABASE_URL,
    dialect: 'postgres',
    dialectOptions: {
      ssl: process.env.DB_SSL === 'true' ? {
        require: true,
        rejectUnauthorized: false
      } : false
    },
    schema: process.env.DB_SCHEMA || 'vlocity_datapack_manager',
    logging: false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  },
  // Internal SQLite fallback used when PostgreSQL is configured but unavailable
  sqlite_fallback: {
    dialect: 'sqlite',
    storage: path.join(__dirname, '../../data/vlocity_manager.db'),
    logging: false,
  },
};

module.exports = config;
