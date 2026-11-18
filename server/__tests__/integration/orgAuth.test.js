/**
 * Connecting Salesforce orgs through the API, with a fake `sf` CLI on PATH
 * (a .cmd shim on Windows). Salesforce's OAuth endpoints are mocked; the
 * hand-off to the CLI, the org import and the access rules are real.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

jest.setTimeout(60000);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orgauth-'));
const binDir = path.join(tmpDir, 'bin');
const callLog = path.join(tmpDir, 'sf-calls.json');
fs.mkdirSync(binDir);

// Fake Salesforce CLI: records calls (and the auth file it was given), answers like `sf --json`
const fakeSf = path.join(binDir, 'fake-sf.js');
fs.writeFileSync(fakeSf, `
const fs = require('fs');
const args = process.argv.slice(2);
const log = fs.existsSync(${JSON.stringify(callLog)}) ? JSON.parse(fs.readFileSync(${JSON.stringify(callLog)}, 'utf8')) : [];
const entry = { args };
const fileIdx = args.indexOf('--sfdx-url-file');
if (fileIdx >= 0) entry.authUrl = fs.readFileSync(args[fileIdx + 1], 'utf8');
const keyIdx = args.indexOf('--jwt-key-file');
if (keyIdx >= 0) entry.key = fs.readFileSync(args[keyIdx + 1], 'utf8');
log.push(entry);
fs.writeFileSync(${JSON.stringify(callLog)}, JSON.stringify(log));
const out = (o) => process.stdout.write(JSON.stringify(o));
if (args[0] === '--version') { process.stdout.write('@salesforce/cli/2.0.0'); process.exit(0); }
if (args[0] === 'org' && args[1] === 'login') {
  const user = args[2] === 'jwt' ? args[args.indexOf('--username') + 1] : 'dev@example.com.uat';
  out({ status: 0, result: { username: user, orgId: '00D000000000001', instanceUrl: 'https://acme--uat.sandbox.my.salesforce.com' } });
  process.exit(0);
}
if (args[0] === 'org' && args[1] === 'list') {
  out({ status: 0, result: { nonScratchOrgs: [
    { username: 'dev@example.com.uat', alias: 'acme-uat', instanceUrl: 'https://acme--uat.sandbox.my.salesforce.com', orgId: '00D000000000001', connectedStatus: 'Connected' },
    { username: 'ci@example.com', alias: 'ci', instanceUrl: 'https://acme.my.salesforce.com', orgId: '00D000000000002', connectedStatus: 'Connected' },
  ] } });
  process.exit(0);
}
out({ status: 1, message: 'unsupported fake command' });
process.exit(1);
`);
if (process.platform === 'win32') {
  fs.writeFileSync(path.join(binDir, 'sf.cmd'), `@echo off\r\n"${process.execPath}" "${fakeSf}" %*\r\n`);
} else {
  fs.writeFileSync(path.join(binDir, 'sf'), `#!/bin/sh\nexec "${process.execPath}" "${fakeSf}" "$@"\n`, { mode: 0o755 });
}

Object.assign(process.env, {
  DATA_DIR: tmpDir,
  DATABASE_URL: process.env.TEST_DATABASE_URL || 'sqlite::memory:',
  ENABLE_AUDIT_LOGGING: 'false',
  ADMIN_USERNAME: 'orgadmin',
  ADMIN_EMAIL: 'orgadmin@example.com',
  ADMIN_PASSWORD: 'Org-Admin-Pass-123',
  PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
  SF_CLI_COMMAND: '',
});
if (process.env.TEST_DATABASE_URL) process.env.DB_SCHEMA = `it_orgauth_${Date.now()}`;

// Mock only the calls to Salesforce's OAuth endpoints
jest.mock('../../services/salesforceOrgAuthService', () => {
  const actual = jest.requireActual('../../services/salesforceOrgAuthService');
  return {
    ...actual,
    startDeviceFlow: jest.fn(),
    pollDeviceFlow: jest.fn(),
  };
});

const orgAuth = require('../../services/salesforceOrgAuthService');
const app = require('../../index');
const databaseService = require('../../services/databaseService');
const authService = require('../../services/authService');
const { resetSfCliCache } = require('../../utils/sfCli');

const calls = () => (fs.existsSync(callLog) ? JSON.parse(fs.readFileSync(callLog, 'utf8')) : []);
let developer;
let functional;

beforeAll(async () => {
  resetSfCliCache();
  await databaseService.connect();
  await authService.ensureAdminUser();
  for (const role of ['developer', 'functional']) {
    await authService.createUser({
      username: `org_${role}`, email: `org_${role}@example.com`, password: 'Org-User-Pass-123', firstName: role, lastName: 'T', role,
    });
  }
  developer = request.agent(app);
  await developer.post('/api/auth/login').send({ username: 'org_developer', password: 'Org-User-Pass-123' });
  functional = request.agent(app);
  await functional.post('/api/auth/login').send({ username: 'org_functional', password: 'Org-User-Pass-123' });
});

afterAll(async () => {
  await databaseService.disconnect().catch(() => {});
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  if (fs.existsSync(callLog)) fs.unlinkSync(callLog);
});

describe('connecting orgs from the browser', () => {
  it('signs in with Salesforce (device flow) and imports the org', async () => {
    orgAuth.startDeviceFlow.mockResolvedValue({
      deviceCode: 'dc-1', userCode: 'WXYZ1234', verificationUri: 'https://test.salesforce.com/setup/connect',
      interval: 5, expiresIn: 600, loginUrl: 'https://test.salesforce.com',
    });
    orgAuth.pollDeviceFlow
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'complete', tokens: { refreshToken: '5AepRefresh', instanceUrl: 'https://acme--uat.sandbox.my.salesforce.com' } });

    const start = await developer.post('/api/org-auth/device/start').send({ loginUrl: 'https://test.salesforce.com', alias: 'acme-uat', label: 'ACME UAT', environment: 'uat' });
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ userCode: 'WXYZ1234', interval: 5 });
    expect(start.body.deviceCode).toBeUndefined();

    expect((await developer.post('/api/org-auth/device/poll')).body.status).toBe('pending');
    const done = await developer.post('/api/org-auth/device/poll');
    expect(done.body).toMatchObject({ status: 'complete', org: { username: 'dev@example.com.uat' } });

    const login = calls().find((c) => c.args[1] === 'login');
    expect(login.args).toEqual(expect.arrayContaining(['org', 'login', 'sfdx-url', '--alias', 'acme-uat', '--json']));
    expect(login.authUrl).toBe('force://PlatformCLI::5AepRefresh@acme--uat.sandbox.my.salesforce.com');

    const { Org } = require('../../models');
    const org = await Org.findOne({ where: { username: 'dev@example.com.uat' } });
    expect(org).toMatchObject({ label: 'ACME UAT', environment: 'uat', alias: 'acme-uat' });
  });

  it('deletes the temporary auth file after the CLI call', async () => {
    const res = await developer.post('/api/org-auth/sfdx-url').send({ authUrl: 'force://PlatformCLI::5AepX@acme.my.salesforce.com', alias: 'ci' });
    expect(res.status).toBe(200);
    const login = calls().find((c) => c.args[2] === 'sfdx-url');
    const file = login.args[login.args.indexOf('--sfdx-url-file') + 1];
    expect(fs.existsSync(file)).toBe(false);
  });

  it('connects with JWT', async () => {
    const res = await developer.post('/api/org-auth/jwt').send({
      clientId: '3MVG9connectedAppKey', username: 'ci@example.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\nMIIfake\n-----END PRIVATE KEY-----\n',
      loginUrl: 'https://login.salesforce.com', alias: 'ci',
    });
    expect(res.status).toBe(200);
    const login = calls().find((c) => c.args[2] === 'jwt');
    expect(login.args).toEqual(expect.arrayContaining(['--client-id', '3MVG9connectedAppKey', '--username', 'ci@example.com', '--instance-url', 'https://login.salesforce.com']));
    expect(login.key).toContain('BEGIN PRIVATE KEY');
  });

  it.each([
    ['/api/org-auth/sfdx-url', { authUrl: 'https://not-an-auth-url' }],
    ['/api/org-auth/sfdx-url', { authUrl: 'force://a::b@acme.my.salesforce.com', alias: 'bad alias; rm' }],
    ['/api/org-auth/device/start', { loginUrl: 'https://evil.example.com' }],
    ['/api/org-auth/jwt', { clientId: 'x', username: 'u@example.com', privateKey: 'nope' }],
  ])('rejects invalid input on %s', async (url, body) => {
    const res = await developer.post(url).send(body);
    expect(res.status).toBe(400);
    expect(calls().filter((c) => c.args[1] === 'login')).toEqual([]);
  });

  it('is not available to functional users', async () => {
    const res = await functional.post('/api/org-auth/sfdx-url').send({ authUrl: 'force://PlatformCLI::x@acme.my.salesforce.com' });
    expect(res.status).toBe(403);
  });
});
