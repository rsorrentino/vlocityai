#!/usr/bin/env node
/**
 * End-to-end smoke test: start the real server (SQLite, temp data dir),
 * then check health, the authentication gate and the admin login.
 * Pure Node – runs unchanged on Windows, macOS and Linux (used by CI).
 *
 *   node scripts/smoke-test.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.SMOKE_PORT || 3999);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = 'Smoke-Test-Pass-123';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vlocityai-smoke-'));

const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(PORT),
    DATA_DIR: dataDir,
    DATABASE_URL: `sqlite:${path.join(dataDir, 'smoke.db')}`,
    REDIS_URL: 'redis://127.0.0.1:1',
    REDIS_AUTOSTART: 'false',
    ADMIN_USERNAME: 'admin',
    ADMIN_EMAIL: 'admin@example.com',
    ADMIN_PASSWORD,
    JWT_SECRET: 'smoke-test-secret-0123456789abcdef0123456789',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let output = '';
server.stdout.on('data', (d) => { output += d; });
server.stderr.on('data', (d) => { output += d; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealthy(timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (server.exitCode !== null) throw new Error(`server exited early with code ${server.exitCode}`);
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.status === 200) return;
    } catch {
      /* not listening yet */
    }
    await sleep(500);
  }
  throw new Error('server did not become healthy in time');
}

function check(name, condition, detail = '') {
  if (!condition) throw new Error(`FAILED: ${name}${detail ? ` (${detail})` : ''}`);
  console.log(`  ok  ${name}`);
}

async function main() {
  console.log(`Smoke test on ${process.platform} / Node ${process.version}`);
  await waitForHealthy();
  check('GET /health is 200', true);

  const jobs = await fetch(`${BASE}/api/jobs`);
  check('GET /api/jobs without login is 401', jobs.status === 401, `got ${jobs.status}`);

  const logs = await fetch(`${BASE}/logs/jobs/x.log`);
  check('GET /logs without login is 401', logs.status === 401, `got ${logs.status}`);

  const oldDefault = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Admin123!' }),
  });
  check('old default password is rejected', oldDefault.status === 401, `got ${oldDefault.status}`);

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: ADMIN_PASSWORD }),
  });
  check('admin login is 200', login.status === 200, `got ${login.status}`);
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  check('login sets auth cookie', cookie.startsWith('auth_token='));

  const authed = await fetch(`${BASE}/api/jobs`, { headers: { Cookie: cookie } });
  check('GET /api/jobs with session is 200', authed.status === 200, `got ${authed.status}`);

  const adapters = await fetch(`${BASE}/api/chat/adapters`, { headers: { Cookie: cookie } });
  const body = await adapters.json();
  check('chat adapters include copilot', Array.isArray(body.adapters) && body.adapters.includes('copilot'));

  const inject = await fetch(`${BASE}/api/system/run-auth-command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ alias: 'x & echo pwned > pwned.txt' }),
  });
  check('shell metacharacters in alias are rejected', inject.status === 400, `got ${inject.status}`);
}

function stopServer() {
  if (server.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    server.kill('SIGTERM');
  }
}

main()
  .then(() => {
    console.log('Smoke test passed');
    stopServer();
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error(err.message);
    console.error('--- server output ---');
    console.error(output.slice(-5000));
    stopServer();
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => {
      try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* file still locked on Windows */ }
      process.exit();
    }, 1500);
  });
