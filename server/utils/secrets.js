/**
 * Application secrets.
 *
 * JWT_SECRET
 *   - production: must be provided via the environment (>= 32 chars) or the
 *     process refuses to start.
 *   - development: if not provided, a random secret is generated once and
 *     persisted to <DATA_DIR>/.jwt-secret so sessions survive restarts.
 *   - test: a fixed value.
 *
 * Encryption key (used to encrypt per-user AI provider tokens at rest) is
 * derived from APP_ENCRYPTION_KEY when set, otherwise from the JWT secret.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MIN_SECRET_LENGTH = 32;

function getDataDir() {
  return process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, '../../data');
}

let cachedJwtSecret = null;

function readOrCreateSecretFile(fileName) {
  const dir = getDataDir();
  const file = path.join(dir, fileName);
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= MIN_SECRET_LENGTH) return existing;
  } catch {
    /* create below */
  }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(dir, { recursive: true });
  // mode is honoured on POSIX and ignored on Windows (NTFS ACLs apply instead)
  fs.writeFileSync(file, secret, { encoding: 'utf8', mode: 0o600 });
  return secret;
}

/**
 * @returns {string} the JWT signing secret
 */
function getJwtSecret() {
  if (cachedJwtSecret) return cachedJwtSecret;

  const fromEnv = process.env.JWT_SECRET;
  const env = process.env.NODE_ENV || 'development';

  if (fromEnv) {
    if (fromEnv.length < MIN_SECRET_LENGTH && env === 'production') {
      throw new Error(`CRITICAL: JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production`);
    }
    cachedJwtSecret = fromEnv;
    return cachedJwtSecret;
  }

  if (env === 'production') {
    throw new Error('CRITICAL: JWT_SECRET environment variable must be set in production');
  }
  if (env === 'test') {
    cachedJwtSecret = 'test-secret-key-for-testing-only-0123456789';
    return cachedJwtSecret;
  }

  cachedJwtSecret = readOrCreateSecretFile('.jwt-secret');
  return cachedJwtSecret;
}

/**
 * 32-byte key for AES-256-GCM encryption of stored credentials.
 * @returns {Buffer}
 */
function getEncryptionKey() {
  const material = process.env.APP_ENCRYPTION_KEY || getJwtSecret();
  return crypto.createHash('sha256').update(`vlocityai:credentials:${material}`).digest();
}

/**
 * Encrypt a UTF-8 string. Output: base64(iv | tag | ciphertext).
 * @param {string} plaintext
 */
function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

/**
 * Decrypt a value produced by encrypt().
 * @param {string} payload
 */
function decrypt(payload) {
  const buf = Buffer.from(String(payload), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Reset caches (tests only). */
function _resetForTests() {
  cachedJwtSecret = null;
}

module.exports = {
  getJwtSecret,
  getEncryptionKey,
  encrypt,
  decrypt,
  getDataDir,
  _resetForTests,
};
