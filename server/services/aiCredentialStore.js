/**
 * Per-user AI provider credentials (e.g. the GitHub OAuth token obtained via
 * "Sign in with GitHub" for Copilot). Tokens are encrypted at rest with
 * AES-256-GCM (see utils/secrets.js). Works with PostgreSQL and the SQLite
 * fallback – only portable SQL is used.
 */
const { DataTypes, QueryTypes } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const { encrypt, decrypt } = require('../utils/secrets');
const logger = require('../utils/logger');

const TABLE = 'ai_credentials';
const schema = process.env.DB_SCHEMA || 'vlocity_datapack_manager';

let ensurePromise = null;
let ensuredFor = null;

function getDb() {
  const { sequelize } = require('./databaseService');
  if (!sequelize) throw new Error('Database connection is not ready');
  return sequelize;
}

function tableRef(db) {
  return db.getDialect() === 'postgres' ? `"${schema}"."${TABLE}"` : `"${TABLE}"`;
}

async function ensureTable() {
  const db = getDb();
  if (ensurePromise && ensuredFor === db) return ensurePromise;
  ensuredFor = db;
  ensurePromise = (async () => {
    const qi = db.getQueryInterface();
    const table = db.getDialect() === 'postgres' ? { tableName: TABLE, schema } : { tableName: TABLE };
    try {
      await qi.describeTable(table);
    } catch {
      await qi.createTable(table, {
        id: { type: DataTypes.STRING(36), primaryKey: true, allowNull: false },
        user_id: { type: DataTypes.STRING(64), allowNull: false },
        provider: { type: DataTypes.STRING(32), allowNull: false },
        encrypted_token: { type: DataTypes.TEXT, allowNull: false },
        account_login: { type: DataTypes.STRING(255), allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false },
        updated_at: { type: DataTypes.DATE, allowNull: false },
      });
      await qi.addIndex(table, ['user_id', 'provider'], {
        unique: true,
        name: 'idx_ai_credentials_user_provider',
      });
    }
  })().catch((err) => {
    ensurePromise = null;
    throw err;
  });
  return ensurePromise;
}

/**
 * Store (replace) a credential for a user/provider.
 */
async function saveCredential(userId, provider, token, accountLogin = null) {
  await ensureTable();
  const db = getDb();
  const now = new Date();
  await db.transaction(async (transaction) => {
    await db.query(`DELETE FROM ${tableRef(db)} WHERE user_id = :userId AND provider = :provider`, {
      replacements: { userId: String(userId), provider },
      transaction,
    });
    await db.query(
      `INSERT INTO ${tableRef(db)} (id, user_id, provider, encrypted_token, account_login, created_at, updated_at)
       VALUES (:id, :userId, :provider, :token, :login, :now, :now)`,
      {
        replacements: {
          id: uuidv4(),
          userId: String(userId),
          provider,
          token: encrypt(token),
          login: accountLogin,
          now,
        },
        transaction,
      }
    );
  });
}

/**
 * @returns {Promise<{token:string, accountLogin:string|null, updatedAt:Date}|null>}
 */
async function getCredential(userId, provider) {
  if (!userId) return null;
  await ensureTable();
  const db = getDb();
  const rows = await db.query(
    `SELECT encrypted_token, account_login, updated_at FROM ${tableRef(db)} WHERE user_id = :userId AND provider = :provider`,
    { replacements: { userId: String(userId), provider }, type: QueryTypes.SELECT }
  );
  if (!rows.length) return null;
  try {
    return {
      token: decrypt(rows[0].encrypted_token),
      accountLogin: rows[0].account_login || null,
      updatedAt: rows[0].updated_at,
    };
  } catch (error) {
    // Encryption key changed (e.g. new JWT_SECRET) – treat as disconnected
    logger.warn('Stored AI credential could not be decrypted; user must sign in again', { provider });
    return null;
  }
}

async function deleteCredential(userId, provider) {
  await ensureTable();
  const db = getDb();
  await db.query(`DELETE FROM ${tableRef(db)} WHERE user_id = :userId AND provider = :provider`, {
    replacements: { userId: String(userId), provider },
  });
}

function _reset() {
  ensurePromise = null;
  ensuredFor = null;
}

module.exports = { saveCredential, getCredential, deleteCredential, ensureTable, _reset };
