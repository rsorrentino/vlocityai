/**
 * Database backup and restore (admin only, via /api/backup).
 *
 * Backups are zip files in <DATA_DIR>/backups containing:
 *   manifest.json      metadata (dialect, schema, app version, migrations)
 *   database.sqlite    SQLite: consistent snapshot taken with VACUUM INTO
 *   database.sql       PostgreSQL: pg_dump of the app schema (--clean)
 *   jobs/              job definition files (optional)
 *
 * Restore replaces the database with the backup and then runs migrations, so
 * a backup taken by an older version is brought up to date.
 */
const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const { ValidationError } = require('../middleware/errorHandler');
const { runCommand } = require('../utils/processRunner');
const { getDataDir } = require('../utils/secrets');
const logger = require('../utils/logger');

const BACKUP_NAME = /^backup_[0-9TZ-]+\.zip$/;

function backupDir() {
  return path.join(getDataDir(), 'backups');
}

function jobsDir() {
  return path.join(process.cwd(), 'jobs');
}

function resolveBackupFile(filename) {
  if (typeof filename !== 'string' || !BACKUP_NAME.test(filename)) {
    throw new ValidationError('Invalid backup file name');
  }
  return path.join(backupDir(), filename);
}

/** Connection arguments for pg_dump/psql (password passed via PGPASSWORD). */
function pgConnection(sequelize) {
  const c = sequelize.config;
  const args = ['--host', c.host || 'localhost', '--port', String(c.port || 5432), '--username', c.username, '--dbname', c.database];
  const env = { ...process.env, PGPASSWORD: c.password || '' };
  if (sequelize.options.dialectOptions?.ssl) env.PGSSLMODE = 'require';
  return { args, env };
}

function schemaName() {
  return process.env.DB_SCHEMA || 'vlocity_datapack_manager';
}

/**
 * Copy a pg_dump file, removing top-level "SET <name> = ...;" lines whose
 * setting the target server does not know. Streams, so large dumps are fine.
 * @returns {Promise<string[]>} the settings that were dropped
 */
async function stripUnknownSettings(source, target, knownSettings) {
  const readline = require('readline');
  const dropped = new Set();
  const input = fs.createReadStream(source, { encoding: 'utf8' });
  const output = fs.createWriteStream(target, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    const m = /^SET\s+([a-z_.]+)\s*=/i.exec(line);
    if (m && !knownSettings.has(m[1].toLowerCase())) {
      dropped.add(m[1]);
      continue;
    }
    if (!output.write(`${line}\n`)) await new Promise((r) => output.once('drain', r));
  }
  await new Promise((resolve, reject) => output.end((err) => (err ? reject(err) : resolve())));
  return [...dropped];
}

async function zipDirectory(sourceDir, zipPath) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function unzipTo(zipPath, targetDir) {
  const unzipper = require('unzipper');
  const directory = await unzipper.Open.file(zipPath);
  await directory.extract({ path: targetDir });
}

/**
 * Create a backup.
 * @param {import('sequelize').Sequelize} sequelize
 * @param {{includeJobs?: boolean}} [opts]
 */
async function createBackup(sequelize, { includeJobs = true } = {}) {
  const dir = backupDir();
  await fs.ensureDir(dir);
  const name = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const work = path.join(dir, `${name}.tmp`);
  await fs.ensureDir(work);

  try {
    const dialect = sequelize.getDialect();
    if (dialect === 'sqlite') {
      // VACUUM INTO writes a consistent copy while the database stays online
      const target = path.join(work, 'database.sqlite').replace(/'/g, "''");
      await sequelize.query(`VACUUM INTO '${target}'`);
    } else if (dialect === 'postgres') {
      const { args, env } = pgConnection(sequelize);
      await runCommand(
        'pg_dump',
        [...args, '--schema', schemaName(), '--clean', '--if-exists', '--no-owner', '--no-privileges', '--file', path.join(work, 'database.sql')],
        { env, timeout: 30 * 60 * 1000, rejectOnError: true }
      );
    } else {
      throw new ValidationError(`Backups are not supported for ${dialect}`);
    }

    if (includeJobs && (await fs.pathExists(jobsDir()))) {
      await fs.copy(jobsDir(), path.join(work, 'jobs'));
    }

    const { listMigrationFiles } = require('../db/migrator');
    await fs.writeJson(path.join(work, 'manifest.json'), {
      createdAt: new Date().toISOString(),
      appVersion: require('../../package.json').version,
      dialect,
      schema: dialect === 'postgres' ? schemaName() : null,
      migrations: listMigrationFiles(),
      includes: { database: true, jobs: includeJobs },
    }, { spaces: 2 });

    const zipPath = path.join(dir, `${name}.zip`);
    await zipDirectory(work, zipPath);
    const { size } = await fs.stat(zipPath);
    logger.info('Backup created', { file: path.basename(zipPath), size });
    return { name: path.basename(zipPath), size };
  } finally {
    await fs.remove(work);
  }
}

async function listBackups() {
  const dir = backupDir();
  await fs.ensureDir(dir);
  const files = (await fs.readdir(dir)).filter((f) => BACKUP_NAME.test(f));
  const backups = await Promise.all(files.map(async (name) => {
    const { size, mtime } = await fs.stat(path.join(dir, name));
    return { name, size, createdAt: mtime, downloadUrl: `/api/backup/download/${name}` };
  }));
  return backups.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Restore a backup. The databaseService connection is closed and reopened
 * (which also runs pending migrations).
 * @param {object} databaseService
 * @param {string} filename
 */
async function restoreBackup(databaseService, filename) {
  const zipPath = resolveBackupFile(filename);
  if (!(await fs.pathExists(zipPath))) throw new ValidationError('Backup file not found');

  const work = path.join(backupDir(), `restore_${Date.now()}`);
  await fs.ensureDir(work);
  try {
    await unzipTo(zipPath, work);
    const manifestPath = path.join(work, 'manifest.json');
    if (!(await fs.pathExists(manifestPath))) throw new ValidationError('Invalid backup: manifest.json missing');
    const manifest = await fs.readJson(manifestPath);

    const sequelize = databaseService.sequelize;
    const dialect = sequelize.getDialect();
    if (manifest.dialect && manifest.dialect !== dialect) {
      throw new ValidationError(`Backup is for ${manifest.dialect}, the server is using ${dialect}`);
    }

    if (dialect === 'sqlite') {
      const source = path.join(work, 'database.sqlite');
      if (!(await fs.pathExists(source))) throw new ValidationError('Invalid backup: database.sqlite missing');
      const target = sequelize.options.storage || sequelize.config.storage;
      if (!target || target === ':memory:') throw new ValidationError('Cannot restore into an in-memory database');
      // Close the connection first: the file must not be open (Windows locks it)
      await databaseService.disconnect();
      await fs.copy(source, target, { overwrite: true });
    } else {
      const sqlFile = path.join(work, 'database.sql');
      if (!(await fs.pathExists(sqlFile))) throw new ValidationError('Invalid backup: database.sql missing');
      const { args, env } = pgConnection(sequelize);
      // A dump written by a newer pg_dump can contain SET statements for
      // settings this server does not have (e.g. transaction_timeout from
      // PostgreSQL 17+ on a 16 server). Drop those so the restore can run.
      const known = await sequelize.query('SELECT name FROM pg_settings', { type: sequelize.QueryTypes.SELECT });
      const safeFile = path.join(work, 'database.restore.sql');
      const dropped = await stripUnknownSettings(sqlFile, safeFile, new Set(known.map((r) => (Array.isArray(r) ? r[0] : r.name))));
      if (dropped.length) logger.info('Ignoring settings unknown to this PostgreSQL server', { settings: dropped });
      await runCommand('psql', [...args, '--set', 'ON_ERROR_STOP=1', '--single-transaction', '--file', safeFile], {
        env, timeout: 30 * 60 * 1000, rejectOnError: true,
      });
      await databaseService.disconnect();
    }

    // Reconnect – runs migrations so older backups are upgraded
    await databaseService.connect();

    if (manifest.includes?.jobs && (await fs.pathExists(path.join(work, 'jobs')))) {
      await fs.copy(path.join(work, 'jobs'), jobsDir(), { overwrite: true });
    }

    logger.info('Backup restored', { file: filename });
    return { restored: filename, createdAt: manifest.createdAt };
  } finally {
    await fs.remove(work);
  }
}

async function deleteBackup(filename) {
  const file = resolveBackupFile(filename);
  if (!(await fs.pathExists(file))) throw new ValidationError('Backup file not found');
  await fs.remove(file);
}

module.exports = { createBackup, listBackups, restoreBackup, deleteBackup, resolveBackupFile, backupDir, stripUnknownSettings };
