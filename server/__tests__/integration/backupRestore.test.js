/**
 * Backup and restore through the API: create a backup, change data, restore,
 * and check the data is back. Uses a SQLite file (or TEST_DATABASE_URL for
 * PostgreSQL, which needs pg_dump/psql on PATH).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vlocityai-backup-'));
Object.assign(process.env, {
  DATA_DIR: dataDir,
  DATABASE_URL: process.env.TEST_DATABASE_URL || `sqlite:${path.join(dataDir, 'app.db')}`,
  ENABLE_AUDIT_LOGGING: 'false',
  ADMIN_USERNAME: 'backupadmin',
  ADMIN_EMAIL: 'backupadmin@example.com',
  ADMIN_PASSWORD: 'Backup-Admin-Pass-1',
});
if (process.env.TEST_DATABASE_URL) process.env.DB_SCHEMA = `it_backup_${Date.now()}`;

jest.setTimeout(120000);

const app = require('../../index');
const databaseService = require('../../services/databaseService');
const authService = require('../../services/authService');

let admin;

beforeAll(async () => {
  await databaseService.connect();
  await authService.ensureAdminUser();
  admin = request.agent(app);
  const res = await admin.post('/api/auth/login').send({ username: 'backupadmin', password: process.env.ADMIN_PASSWORD });
  expect(res.status).toBe(200);
});

afterAll(async () => {
  if (process.env.TEST_DATABASE_URL) {
    await databaseService.sequelize.query(`DROP SCHEMA IF EXISTS "${process.env.DB_SCHEMA}" CASCADE`).catch(() => {});
  }
  await databaseService.disconnect().catch(() => {});
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const orgNames = async () => {
  const { Org } = require('../../models');
  return (await Org.findAll({ order: [['username', 'ASC']] })).map((o) => o.username);
};

describe('backup and restore', () => {
  let backupName;

  it('creates a backup', async () => {
    const { Org } = require('../../models');
    await Org.create({ username: 'kept@example.com' });

    const res = await admin.post('/api/backup/create').send({});
    expect(res.status).toBe(200);
    backupName = res.body.backup.name;
    expect(backupName).toMatch(/^backup_.+\.zip$/);
    expect(res.body.backup.size).toBeGreaterThan(0);

    const list = await admin.get('/api/backup/list');
    expect(list.body.backups.map((b) => b.name)).toContain(backupName);
  });

  it('downloads the backup', async () => {
    const res = await admin.get(`/api/backup/download/${backupName}`).buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.body.slice(0, 2).toString()).toBe('PK'); // zip signature
  });

  it('restores the database to the backup state', async () => {
    const { Org } = require('../../models');
    await Org.destroy({ where: { username: 'kept@example.com' } });
    await Org.create({ username: 'added-after-backup@example.com' });
    expect(await orgNames()).toEqual(['added-after-backup@example.com']);

    const res = await admin.post('/api/backup/restore').send({ filename: backupName });
    expect(res.status).toBe(200);

    expect(await orgNames()).toEqual(['kept@example.com']);

    // The app keeps working on the restored database (same session)
    const jobs = await admin.get('/api/jobs');
    expect(jobs.status).toBe(200);
  });

  it.each(['../app.db', 'backup_x.zip/../../etc', 'notes.txt'])('rejects unsafe file name %p', async (filename) => {
    const res = await admin.post('/api/backup/restore').send({ filename });
    expect(res.status).toBe(400);
  });

  it('is admin-only', async () => {
    await authService.createUser({
      username: 'backupdev', email: 'backupdev@example.com', password: 'Backup-Dev-Pass-12', firstName: 'D', lastName: 'V', role: 'developer',
    });
    const dev = request.agent(app);
    await dev.post('/api/auth/login').send({ username: 'backupdev', password: 'Backup-Dev-Pass-12' });
    expect((await dev.post('/api/backup/create').send({})).status).toBe(403);
  });
});
