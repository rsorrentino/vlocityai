/**
 * Role-based access control against the real app (in-memory SQLite).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vlocityai-rbac-'));
Object.assign(process.env, {
  DATA_DIR: dataDir,
  DATABASE_URL: process.env.TEST_DATABASE_URL || 'sqlite::memory:',
  ENABLE_AUDIT_LOGGING: 'false',
  ADMIN_USERNAME: 'rbacadmin',
  ADMIN_EMAIL: 'rbacadmin@example.com',
  ADMIN_PASSWORD: 'Rbac-Admin-Pass-1',
});

if (process.env.TEST_DATABASE_URL) process.env.DB_SCHEMA = `it_${path.basename(__filename, '.test.js').replace(/\W/g, '_').toLowerCase()}_${Date.now()}`;

jest.setTimeout(30000);

const app = require('../../index');
const databaseService = require('../../services/databaseService');
const authService = require('../../services/authService');
const { clearAccessCache } = require('../../middleware/accessPolicy');

const PASSWORD = 'Rbac-User-Pass-123';
const agents = {};

async function loginAs(username, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ username, password });
  expect(res.status).toBe(200);
  return agent;
}

beforeAll(async () => {
  await databaseService.connect();
  await authService.ensureAdminUser();
  for (const role of ['developer', 'functional']) {
    await authService.createUser({
      username: `rbac_${role}`,
      email: `rbac_${role}@example.com`,
      password: PASSWORD,
      firstName: role,
      lastName: 'Tester',
      role,
    });
  }
  agents.admin = await loginAs('rbacadmin', process.env.ADMIN_PASSWORD);
  agents.developer = await loginAs('rbac_developer');
  agents.functional = await loginAs('rbac_functional');
});

afterAll(async () => {
  await databaseService.disconnect().catch(() => {});
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('role-based access control', () => {
  it.each([
    ['functional', 'get', '/api/jobs'],
    ['functional', 'get', '/api/orgs'],
    ['developer', 'get', '/api/config/settings'],
    ['admin', 'get', '/api/audit/logs'],
  ])('%s may %s %s', async (role, method, url) => {
    const res = await agents[role][method](url);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });

  it.each([
    ['functional', 'post', '/api/exports/create-job'],
    ['functional', 'post', '/api/vlocity-commands/packExport/execute'],
    ['functional', 'post', '/api/orgs/sync'],
    ['functional', 'post', '/api/catalog/products'],
    ['functional', 'get', '/api/config/settings'],
    ['developer', 'get', '/api/audit/logs'],
    ['developer', 'post', '/api/backup/create'],
    ['developer', 'post', '/api/config/settings'],
    ['developer', 'delete', '/api/jobs/does-not-exist'],
  ])('%s is denied %s %s', async (role, method, url) => {
    const res = await agents[role][method](url).send({});
    expect(res.status).toBe(403);
  });

  it('developers reach the developer tools (validation, not authorization, rejects the empty body)', async () => {
    const res = await agents.developer.post('/api/system/run-auth-command').send({});
    expect(res.status).toBe(400);
  });

  it('a user cannot promote themselves through their profile', async () => {
    const res = await agents.functional.put('/api/auth/profile').send({ role: 'admin', isActive: true, firstName: 'Still' });
    expect(res.status).toBe(200);
    const me = await agents.functional.get('/api/auth/me');
    const user = me.body.data?.user || me.body.data || me.body.user;
    expect(user.role).toBe('functional');
    expect(user.firstName).toBe('Still');

    const stillDenied = await agents.functional.get('/api/audit/logs');
    expect(stillDenied.status).toBe(403);
  });

  it('the last active admin cannot be demoted or deleted', async () => {
    const { User } = require('../../models');
    const admin = await User.findOne({ where: { username: 'rbacadmin' } });
    await expect(authService.updateUser(admin.id, { role: 'developer' }, { privileged: true }))
      .rejects.toThrow(/last active administrator/);
    await expect(authService.deleteUser(admin.id)).rejects.toThrow(/last active administrator/);
  });

  it('role changes apply to existing sessions', async () => {
    const { User } = require('../../models');
    const dev = await User.findOne({ where: { username: 'rbac_developer' } });

    await authService.updateUser(dev.id, { role: 'functional' }, { privileged: true });
    const demoted = await agents.developer.post('/api/exports/create-job').send({});
    expect(demoted.status).toBe(403);

    await authService.updateUser(dev.id, { role: 'developer' }, { privileged: true });
    clearAccessCache();
  });

  it('deactivated users are signed out immediately', async () => {
    const { User } = require('../../models');
    const user = await User.findOne({ where: { username: 'rbac_functional' } });
    await authService.updateUser(user.id, { isActive: false }, { privileged: true });

    const res = await agents.functional.get('/api/jobs');
    expect(res.status).toBe(401);
  });
});
