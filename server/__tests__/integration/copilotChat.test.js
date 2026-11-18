/**
 * End-to-end test of the GitHub Copilot adapter through the real app:
 *   Sign in with GitHub (device flow) -> encrypted token storage ->
 *   Copilot session exchange -> model listing -> chat message with a tool
 *   call that runs the `sf` CLI -> SSE answer.
 *
 * GitHub and the Copilot API are replaced by a local HTTP server; `sf` is a
 * fake CLI shim on PATH (a .cmd file on Windows), so the same test proves the
 * Windows/macOS/Linux process handling as well.
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const request = require('supertest');

jest.setTimeout(30000);

// ── Fake GitHub + Copilot API ────────────────────────────────────────────────
const calls = { chat: [], tokenAuth: [] };
let baseUrl;

function sse(res, events) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
  res.end('data: [DONE]\n\n');
}

const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const json = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const url = req.url.split('?')[0];

    if (req.method === 'POST' && url === '/login/device/code') {
      return json(200, { device_code: 'dev-1', user_code: 'WXYZ-0000', verification_uri: `${baseUrl}/login/device`, expires_in: 900, interval: 5 });
    }
    if (req.method === 'POST' && url === '/login/oauth/access_token') {
      return json(200, { access_token: 'gho_mock_user_token', token_type: 'bearer' });
    }
    if (req.method === 'GET' && url === '/user') {
      return json(200, { login: 'octocat' });
    }
    if (req.method === 'GET' && url === '/copilot_internal/v2/token') {
      calls.tokenAuth.push(req.headers.authorization);
      if (req.headers.authorization !== 'token gho_mock_user_token') return json(401, { message: 'Bad credentials' });
      return json(200, { token: 'copilot-session-token', expires_at: Math.floor(Date.now() / 1000) + 1800, endpoints: { api: `${baseUrl}/copilot` } });
    }
    if (req.method === 'GET' && url === '/copilot/models') {
      return json(200, { data: [{ id: 'gpt-4.1', name: 'GPT-4.1', model_picker_enabled: true, capabilities: { type: 'chat', supports: { tool_calls: true } } }] });
    }
    if (req.method === 'POST' && url === '/copilot/chat/completions') {
      const parsed = JSON.parse(body);
      calls.chat.push({ headers: req.headers, body: parsed });
      const hasToolResult = parsed.messages.some((m) => m.role === 'tool');
      if (!hasToolResult) {
        return sse(res, [
          { choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'list_catalogs', arguments: '' } }] } }] },
          { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{}' } }] } }] },
          { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
        ]);
      }
      return sse(res, [
        { choices: [{ index: 0, delta: { role: 'assistant', content: 'You have ' } }] },
        { choices: [{ index: 0, delta: { content: '2 catalogs.' } }] },
        { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      ]);
    }
    json(404, { message: `unexpected ${req.method} ${url}` });
  });
});

// ── Fake `sf` CLI on PATH ────────────────────────────────────────────────────
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-e2e-'));
const binDir = path.join(tmpDir, 'bin');
const argvLog = path.join(tmpDir, 'sf-argv.json');
fs.mkdirSync(binDir);
const fakeSf = path.join(binDir, 'fake-sf.js');
fs.writeFileSync(fakeSf, `
require('fs').writeFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify({ status: 0, result: { totalSize: 2, records: [
  { attributes: {}, Id: 'a01', Name: 'Hearing Aids' },
  { attributes: {}, Id: 'a02', Name: 'Accessories' } ] } }));
`);
if (process.platform === 'win32') {
  fs.writeFileSync(path.join(binDir, 'sf.cmd'), `@echo off\r\n"${process.execPath}" "${fakeSf}" %*\r\n`);
} else {
  fs.writeFileSync(path.join(binDir, 'sf'), `#!/bin/sh\nexec "${process.execPath}" "${fakeSf}" "$@"\n`, { mode: 0o755 });
}

let app;
let agent;
const savedEnv = { ...process.env };

beforeAll(async () => {
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${mock.address().port}`;

  Object.assign(process.env, {
    GITHUB_BASE_URL: baseUrl,
    GITHUB_API_URL: baseUrl,
    DATA_DIR: tmpDir,
    DATABASE_URL: process.env.TEST_DATABASE_URL || 'sqlite::memory:',
    ENABLE_AUDIT_LOGGING: 'false',
    ADMIN_USERNAME: 'copilotadmin',
    ADMIN_EMAIL: 'copilotadmin@example.com',
    ADMIN_PASSWORD: 'Copilot-E2E-Pass-1',
    AI_HTTP_PROXY: 'false',
    PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
  });
  if (process.env.TEST_DATABASE_URL) process.env.DB_SCHEMA = `it_${path.basename(__filename, '.test.js').replace(/\W/g, '_').toLowerCase()}_${Date.now()}`;
  delete process.env.GITHUB_COPILOT_TOKEN;
  delete process.env.COPILOT_USE_LOCAL_TOKEN;

  app = require('../../index');
  const databaseService = require('../../services/databaseService');
  await databaseService.connect();
  await require('../../services/authService').ensureAdminUser();

  agent = request.agent(app);
  const login = await agent.post('/api/auth/login').send({ username: 'copilotadmin', password: 'Copilot-E2E-Pass-1' });
  expect(login.status).toBe(200);
});

afterAll(async () => {
  await new Promise((resolve) => mock.close(resolve));
  await require('../../services/databaseService').disconnect().catch(() => {});
  process.env = savedEnv;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function parseSse(text) {
  return text
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice(6)));
}

describe('GitHub Copilot chat (end to end)', () => {
  it('starts as not connected', async () => {
    const res = await agent.get('/api/chat/copilot/status');
    expect(res.body).toEqual({ connected: false, source: null });
  });

  it('signs in with the GitHub device flow and stores the token encrypted', async () => {
    const start = await agent.post('/api/chat/copilot/device/start');
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ userCode: 'WXYZ-0000', interval: 5 });
    expect(start.body.deviceCode).toBeUndefined(); // never sent to the browser

    const poll = await agent.post('/api/chat/copilot/device/poll');
    expect(poll.body).toEqual({ status: 'complete', accountLogin: 'octocat' });

    const status = await agent.get('/api/chat/copilot/status');
    expect(status.body).toMatchObject({ connected: true, source: 'user', accountLogin: 'octocat', apiBase: `${baseUrl}/copilot` });

    const { sequelize } = require('../../services/databaseService');
    const { quotedTable } = require('../../db/migrationHelpers');
    const rows = await sequelize.query(`SELECT encrypted_token FROM ${quotedTable(sequelize.getQueryInterface(), 'ai_credentials')}`, {
      type: require('sequelize').QueryTypes.SELECT,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].encrypted_token).not.toContain('gho_mock_user_token');
  });

  it('lists the account’s models', async () => {
    const res = await agent.get('/api/chat/copilot/models');
    expect(res.body.models).toEqual([{ id: 'gpt-4.1', name: 'GPT-4.1', toolCalls: true }]);
  });

  it('answers a chat message, running a tool through the sf CLI', async () => {
    const conv = await agent.post('/api/chat/conversations').send({ adapter: 'copilot', orgUsername: 'me@example.org' });
    expect(conv.status).toBe(201);

    const res = await agent
      .post('/api/chat/message')
      .send({
        conversationId: conv.body.conversation.id,
        message: 'How many catalogs do we have?',
        adapter: 'copilot',
        orgUsername: 'me@example.org',
        adapterConfig: { model: 'gpt-4.1' },
      });

    expect(res.status).toBe(200);
    const events = parseSse(res.text);
    const errors = events.filter((e) => e.type === 'error');
    expect(errors).toEqual([]);

    expect(events.find((e) => e.type === 'tool_start')).toMatchObject({ tool: 'list_catalogs' });
    expect(events.find((e) => e.type === 'tool_end').result).toContain('Found 2 catalogs');
    expect(events.filter((e) => e.type === 'token').map((e) => e.content).join('')).toBe('You have 2 catalogs.');
    expect(events.at(-1)).toMatchObject({ type: 'done' });

    // The fake sf CLI received the org as a separate argv entry
    expect(JSON.parse(fs.readFileSync(argvLog, 'utf8'))).toEqual(expect.arrayContaining(['data', 'query', '--target-org', 'me@example.org', '--json']));

    // Copilot API received the session token and the required headers
    const first = calls.chat[0];
    expect(first.headers.authorization).toBe('Bearer copilot-session-token');
    expect(first.headers['copilot-integration-id']).toBe('vscode-chat');
    expect(first.headers['editor-version']).toMatch(/^vscode\//);
    expect(first.body.model).toBe('gpt-4.1');
    expect(first.body.tools.map((t) => t.function.name)).toContain('list_catalogs');

    // The tool result was sent back to the model
    const toolMsg = calls.chat[1].body.messages.find((m) => m.role === 'tool');
    expect(toolMsg).toMatchObject({ tool_call_id: 'call_1' });
    expect(toolMsg.content).toContain('Hearing Aids');

    // The session token was exchanged once and then cached
    expect(calls.tokenAuth.filter((a) => a === 'token gho_mock_user_token').length).toBeGreaterThanOrEqual(1);

    const saved = await agent.get(`/api/chat/conversations/${conv.body.conversation.id}`);
    const assistant = saved.body.conversation.messages.find((m) => m.role === 'assistant');
    expect(assistant.content).toBe('You have 2 catalogs.');
  });

  it('disconnects', async () => {
    await agent.delete('/api/chat/copilot').expect(200);
    const status = await agent.get('/api/chat/copilot/status');
    expect(status.body.connected).toBe(false);
  });
});
