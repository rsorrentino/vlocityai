/**
 * Migrations: fresh install, upgrade of a database created by the old
 * sequelize.sync(), and the legacy SQLite fallback with "schema.table" names.
 * Runs on SQLite; set TEST_POSTGRES_URL to also run against PostgreSQL.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Sequelize } = require('sequelize');
const { createMigrator, listMigrationFiles } = require('../../db/migrator');

jest.setTimeout(60000);

const EXPECTED_TABLES = [
  'users', 'jobs', 'org_analyses', 'orgs', 'system_statuses', 'sfdmu_configs',
  'audit_logs', 'chat_conversations', 'chat_messages', 'ai_credentials',
];

let tmpDir;
beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-'));
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function sqlite(name) {
  return new Sequelize({ dialect: 'sqlite', storage: path.join(tmpDir, `${name}.db`), logging: false });
}

async function sqliteTables(sequelize) {
  const [rows] = await sequelize.query("SELECT name FROM sqlite_master WHERE type='table'");
  return rows.map((r) => r.name);
}

describe('database migrations (SQLite)', () => {
  it('creates the full schema on an empty database and records every migration', async () => {
    const db = sqlite('fresh');
    const migrator = createMigrator(db);
    const applied = await migrator.up();
    expect(applied.map((m) => m.name)).toEqual(listMigrationFiles());

    const tables = await sqliteTables(db);
    expect(tables).toEqual(expect.arrayContaining([...EXPECTED_TABLES, 'SequelizeMeta']));

    // Second run is a no-op
    expect(await migrator.up()).toEqual([]);
    expect(await migrator.pending()).toEqual([]);
    await db.close();
  });

  it('upgrades a database created by the old sync() without losing data', async () => {
    const db = sqlite('legacy-sync');
    // Simulate an old install: plain tables, no SequelizeMeta, a column missing
    await db.query(`CREATE TABLE users (
      id VARCHAR(36) PRIMARY KEY, username VARCHAR(255) NOT NULL UNIQUE, email VARCHAR(255) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL, role TEXT NOT NULL DEFAULT 'functional', first_name VARCHAR(255) NOT NULL,
      last_name VARCHAR(255) NOT NULL, is_active TINYINT(1) DEFAULT 1, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL)`);
    await db.query(`INSERT INTO users (id, username, email, password, role, first_name, last_name, created_at, updated_at)
      VALUES ('u1', 'olduser', 'old@example.com', 'hash', 'developer', 'Old', 'User', '2025-01-01', '2025-01-01')`);
    await db.query(`CREATE TABLE chat_conversations (id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL,
      title VARCHAR(255) NOT NULL DEFAULT 'New conversation', org_username VARCHAR(255), adapter VARCHAR(255),
      created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL)`);

    await createMigrator(db).up();

    const [[user]] = await db.query("SELECT username, role, login_attempts, permissions FROM users WHERE id = 'u1'");
    expect(user.username).toBe('olduser');
    expect(user.role).toBe('developer');
    expect(user).toHaveProperty('login_attempts'); // column added by the baseline
    expect(await sqliteTables(db)).toEqual(expect.arrayContaining(EXPECTED_TABLES));
    await db.close();
  });

  it('renames legacy "schema.table" tables from the old SQLite fallback', async () => {
    const db = sqlite('legacy-prefixed');
    await db.query(`CREATE TABLE "vlocity_datapack_manager.orgs" (
      id VARCHAR(36) PRIMARY KEY, username VARCHAR(255) NOT NULL UNIQUE, alias VARCHAR(255),
      created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL)`);
    await db.query(`INSERT INTO "vlocity_datapack_manager.orgs" (id, username, alias, created_at, updated_at)
      VALUES ('o1', 'me@example.com.dev', 'dev', '2025-01-01', '2025-01-01')`);

    await createMigrator(db).up();

    const tables = await sqliteTables(db);
    expect(tables).toContain('orgs');
    expect(tables).not.toContain('vlocity_datapack_manager.orgs');
    const [[org]] = await db.query("SELECT username, alias, is_sandbox FROM orgs WHERE id = 'o1'");
    expect(org).toMatchObject({ username: 'me@example.com.dev', alias: 'dev' });
    await db.close();
  });

  it('can revert and re-apply the latest migration', async () => {
    const db = sqlite('down-up');
    const migrator = createMigrator(db);
    await migrator.up();
    const [last] = await migrator.down();
    expect(last.name).toBe(listMigrationFiles().at(-1));
    expect(await sqliteTables(db)).not.toContain('ai_credentials');
    await migrator.up();
    expect(await sqliteTables(db)).toContain('ai_credentials');
    await db.close();
  });

  it('application models work against the migrated schema', async () => {
    const storage = path.join(tmpDir, 'app.db');
    const saved = { DATABASE_URL: process.env.DATABASE_URL };
    process.env.DATABASE_URL = `sqlite:${storage}`;
    const databaseService = require('../../services/databaseService');
    try {
      await databaseService.connect();
      const { User, Job, Org } = require('../../models');
      const user = await User.create({
        username: 'm1', email: 'm1@example.com', password: 'x', firstName: 'M', lastName: 'One', role: 'developer',
      });
      await Org.create({ username: 'org@example.com', alias: 'o' });
      await Job.create({ name: 'j', type: 'export', configuration: { queries: [] }, userId: user.id });
      expect(await Job.count()).toBe(1);
    } finally {
      await databaseService.disconnect();
      process.env.DATABASE_URL = saved.DATABASE_URL;
    }
  });
});

const pgUrl = process.env.TEST_POSTGRES_URL;
(pgUrl ? describe : describe.skip)('database migrations (PostgreSQL)', () => {
  it('creates the schema, is idempotent and records migrations in DB_SCHEMA', async () => {
    const schema = `mig_test_${Date.now()}`;
    const savedSchema = process.env.DB_SCHEMA;
    process.env.DB_SCHEMA = schema;
    const db = new Sequelize(pgUrl, { logging: false });
    try {
      await db.query(`CREATE SCHEMA "${schema}"`);
      const migrator = createMigrator(db);
      await migrator.up();
      expect(await migrator.up()).toEqual([]);
      const rows = await db.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = '${schema}'`,
        { type: Sequelize.QueryTypes.SELECT }
      );
      // The pg driver may return rows as arrays or objects depending on the runtime
      const names = rows.map((r) => (Array.isArray(r) ? r[0] : r.table_name));
      expect(names).toEqual(expect.arrayContaining([...EXPECTED_TABLES, 'SequelizeMeta']));
    } finally {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await db.close();
      process.env.DB_SCHEMA = savedSchema;
    }
  });
});
