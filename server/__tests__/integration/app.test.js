/**
 * Integration tests against the real Express app (in-memory SQLite).
 * Covers the MVP security baseline: authentication gate, admin bootstrap,
 * protected static folders and input validation on CLI-backed endpoints.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vlocityai-it-'));
process.env.DATA_DIR = dataDir;
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'sqlite::memory:';
process.env.ENABLE_AUDIT_LOGGING = 'false';
process.env.ADMIN_USERNAME = 'itadmin';
process.env.ADMIN_EMAIL = 'itadmin@example.com';
process.env.ADMIN_PASSWORD = 'Integration-Test-Pass-1';

if (process.env.TEST_DATABASE_URL) process.env.DB_SCHEMA = `it_${path.basename(__filename, '.test.js').replace(/\W/g, '_').toLowerCase()}_${Date.now()}`;

jest.setTimeout(30000);

const app = require('../../index');
const databaseService = require('../../services/databaseService');
const authService = require('../../services/authService');

async function login(username = 'itadmin', password = process.env.ADMIN_PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ username, password });
  return { agent, res };
}

describe('App integration', () => {
  beforeAll(async () => {
    await databaseService.connect();
    await authService.ensureAdminUser();
  });

  afterAll(async () => {
    await databaseService.disconnect().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  describe('public endpoints', () => {
    it('GET /health is public', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
    });

    it('GET /api/auth/status is public', async () => {
      const res = await request(app).get('/api/auth/status');
      expect(res.status).toBe(200);
    });
  });

  describe('authentication gate', () => {
    it.each([
      ['get', '/api/jobs'],
      ['get', '/api/orgs'],
      ['get', '/api/properties'],
      ['get', '/api/vlocity-commands'],
      ['get', '/api/catalog/catalogs'],
      ['get', '/api/chat/conversations'],
      ['get', '/api/chat/copilot/status'],
      ['post', '/api/system/run-auth-command'],
      ['post', '/api/backup/create'],
      ['get', '/logs/jobs/anything.log'],
      ['get', '/uploads/anything'],
    ])('%s %s requires a session', async (method, url) => {
      const res = await request(app)[method](url).send({});
      expect(res.status).toBe(401);
    });

    it('rejects a forged token', async () => {
      const res = await request(app).get('/api/jobs').set('Authorization', 'Bearer not-a-real-token');
      expect(res.status).toBe(401);
    });
  });

  describe('admin bootstrap and login', () => {
    it('creates the admin from ADMIN_* variables only once', async () => {
      const again = await authService.ensureAdminUser();
      expect(again.created).toBe(false);
    });

    it('does not create the old published default accounts', async () => {
      for (const [username, password] of [['admin', 'Admin123!'], ['developer', 'Dev123!'], ['functional', 'Func123!']]) {
        const res = await request(app).post('/api/auth/login').send({ username, password });
        expect(res.status).toBe(401);
      }
    });

    it('logs in and sets an httpOnly cookie', async () => {
      const { agent, res } = await login();
      expect(res.status).toBe(200);
      const cookie = res.headers['set-cookie'].join(';');
      expect(cookie).toMatch(/auth_token=/);
      expect(cookie).toMatch(/HttpOnly/i);

      const me = await agent.get('/api/auth/me');
      expect(me.status).toBe(200);
    });

    it('rejects a wrong password', async () => {
      const { res } = await login('itadmin', 'wrong-password');
      expect(res.status).toBe(401);
    });
  });

  describe('CLI-backed endpoint validation', () => {
    it('rejects shell metacharacters in the org alias', async () => {
      const { agent } = await login();
      const marker = path.join(dataDir, 'pwned');
      const res = await agent
        .post('/api/system/run-auth-command')
        .send({ alias: `x; touch ${marker}` });
      expect(res.status).toBe(400);
      expect(fs.existsSync(marker)).toBe(false);
    });

    it('rejects a non-https instance URL', async () => {
      const { agent } = await login();
      const res = await agent
        .post('/api/system/run-auth-command')
        .send({ alias: 'my-org', instanceUrl: 'http://example.com' });
      expect(res.status).toBe(400);
    });
  });

  describe('chat adapters', () => {
    it('lists the supported adapters including GitHub Copilot', async () => {
      const { agent } = await login();
      const res = await agent.get('/api/chat/adapters');
      expect(res.status).toBe(200);
      expect(res.body.adapters).toEqual(expect.arrayContaining(['anthropic', 'copilot', 'github-models', 'openai', 'ollama']));
    });

    it('reports Copilot as not connected when no token is available', async () => {
      const saved = { ...process.env };
      delete process.env.GITHUB_COPILOT_TOKEN;
      delete process.env.GITHUB_TOKEN;
      delete process.env.COPILOT_USE_LOCAL_TOKEN;
      try {
        const { agent } = await login();
        const res = await agent.get('/api/chat/copilot/status');
        expect(res.status).toBe(200);
        expect(res.body.connected).toBe(false);
      } finally {
        Object.assign(process.env, saved);
      }
    });
  });
});
