/**
 * AI chat: write actions need explicit confirmation, usage/cost tracking,
 * audit logging and the Copilot token-expiry retry – end to end through the
 * real app. Copilot, GitHub and Salesforce REST are a local mock; `sf` is a
 * fake CLI on PATH (a .cmd shim on Windows).
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const request = require('supertest');

jest.setTimeout(60000);

const state = { patches: [], chatBodies: [], tokenExchanges: 0, failNextChatWith401: false };
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
    const json = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    const url = req.url.split('?')[0];

    // GitHub: Copilot session token
    if (url === '/copilot_internal/v2/token') {
      state.tokenExchanges += 1;
      return json(200, { token: `session-${state.tokenExchanges}`, expires_at: Math.floor(Date.now() / 1000) + 1800, endpoints: { api: `${baseUrl}/copilot` } });
    }
    // Copilot chat
    if (url === '/copilot/chat/completions') {
      if (state.failNextChatWith401) {
        state.failNextChatWith401 = false;
        return json(401, { error: { message: 'token expired' } });
      }
      const parsed = JSON.parse(body);
      state.chatBodies.push({ auth: req.headers.authorization, body: parsed });
      const last = parsed.messages[parsed.messages.length - 1];
      const wantsChange = parsed.messages.some((m) => m.role === 'user' && /rename/i.test(m.content || ''));
      if (wantsChange && last.role === 'user') {
        return sse(res, [{ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_w', type: 'function', function: {
          name: 'propose_record_update',
          arguments: JSON.stringify({ sobject: 'Product2', record_id: '01t000000000001AAA', fields: { Name: 'Hearing Aid Pro' }, reason: 'User asked to rename' }),
        } }] } }] }]);
      }
      return sse(res, [{ choices: [{ index: 0, delta: { content: last.role === 'tool' ? 'The change is waiting for your approval.' : 'Hello!' } }] }]);
    }
    // Salesforce REST
    if (url === '/services/data/v62.0/sobjects/Product2/01t000000000001AAA') {
      if (req.headers.authorization !== 'Bearer sf-access-token') return json(401, [{ message: 'Session expired' }]);
      if (req.method === 'GET') return json(200, { Id: '01t000000000001AAA', Name: 'Hearing Aid' });
      if (req.method === 'PATCH') {
        state.patches.push(JSON.parse(body));
        res.writeHead(204);
        return res.end();
      }
    }
    json(404, { message: `unexpected ${req.method} ${url}` });
  });
});

// Fake `sf`: version + org display (access token for the REST calls)
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aichat-'));
const binDir = path.join(tmpDir, 'bin');
fs.mkdirSync(binDir);
const fakeSf = path.join(binDir, 'fake-sf.js');
fs.writeFileSync(fakeSf, `
const args = process.argv.slice(2);
if (args[0] === '--version') { process.stdout.write('@salesforce/cli/2.0.0'); process.exit(0); }
if (args[0] === 'org' && args[1] === 'display') {
  process.stdout.write(JSON.stringify({ status: 0, result: { accessToken: 'sf-access-token', instanceUrl: process.env.FAKE_SF_INSTANCE_URL, username: 'me@example.org', id: '00D' } }));
  process.exit(0);
}
process.stdout.write(JSON.stringify({ status: 1, message: 'unsupported' }));
process.exit(1);
`);
if (process.platform === 'win32') {
  fs.writeFileSync(path.join(binDir, 'sf.cmd'), `@echo off\r\n"${process.execPath}" "${fakeSf}" %*\r\n`);
} else {
  fs.writeFileSync(path.join(binDir, 'sf'), `#!/bin/sh\nexec "${process.execPath}" "${fakeSf}" "$@"\n`, { mode: 0o755 });
}

let app;
let developer;
let functional;
const savedEnv = { ...process.env };

function parseSse(text) {
  return text.split('\n\n').map((c) => c.trim()).filter((c) => c.startsWith('data: ')).map((c) => JSON.parse(c.slice(6)));
}

async function chat(agent, conversationId, message) {
  const res = await agent.post('/api/chat/message').send({
    conversationId, message, adapter: 'copilot', orgUsername: 'me@example.org', adapterConfig: { apiKey: 'gho_test_token', model: 'gpt-4.1' },
  });
  expect(res.status).toBe(200);
  return parseSse(res.text);
}

beforeAll(async () => {
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${mock.address().port}`;
  Object.assign(process.env, {
    GITHUB_API_URL: baseUrl,
    GITHUB_BASE_URL: baseUrl,
    FAKE_SF_INSTANCE_URL: baseUrl,
    DATA_DIR: tmpDir,
    DATABASE_URL: process.env.TEST_DATABASE_URL || 'sqlite::memory:',
    ENABLE_AUDIT_LOGGING: 'true',
    ADMIN_USERNAME: 'aiadmin',
    ADMIN_EMAIL: 'aiadmin@example.com',
    ADMIN_PASSWORD: 'Ai-Admin-Pass-123',
    AI_HTTP_PROXY: 'false',
    PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
  });
  if (process.env.TEST_DATABASE_URL) process.env.DB_SCHEMA = `it_aichat_${Date.now()}`;

  app = require('../../index');
  const databaseService = require('../../services/databaseService');
  await databaseService.connect();
  const authService = require('../../services/authService');
  await authService.ensureAdminUser();
  await require('../../services/auditService')().initializeDatabase();
  for (const role of ['developer', 'functional']) {
    await authService.createUser({ username: `ai_${role}`, email: `ai_${role}@example.com`, password: 'Ai-User-Pass-1234', firstName: role, lastName: 'T', role });
  }
  developer = request.agent(app);
  await developer.post('/api/auth/login').send({ username: 'ai_developer', password: 'Ai-User-Pass-1234' });
  functional = request.agent(app);
  await functional.post('/api/auth/login').send({ username: 'ai_functional', password: 'Ai-User-Pass-1234' });
});

afterAll(async () => {
  await new Promise((resolve) => mock.close(resolve));
  await require('../../services/databaseService').disconnect().catch(() => {});
  process.env = savedEnv;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('AI-proposed changes need confirmation', () => {
  let conversationId;
  let actionId;

  it('proposes a change without touching Salesforce', async () => {
    const conv = await developer.post('/api/chat/conversations').send({ adapter: 'copilot', orgUsername: 'me@example.org' });
    conversationId = conv.body.conversation.id;

    const events = await chat(developer, conversationId, 'Please rename the Hearing Aid product to Hearing Aid Pro');
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    const proposal = events.find((e) => e.type === 'confirmation_required');
    expect(proposal.action).toMatchObject({ status: 'pending', tool: 'propose_record_update' });
    expect(proposal.action.args).toMatchObject({
      sobject: 'Product2', recordId: '01t000000000001AAA', fields: { Name: 'Hearing Aid Pro' }, before: { Name: 'Hearing Aid' }, recordName: 'Hearing Aid',
    });
    actionId = proposal.action.id;
    expect(state.patches).toEqual([]);

    // The model was told nothing has changed yet
    const toolMsg = state.chatBodies.at(-1).body.messages.find((m) => m.role === 'tool');
    expect(toolMsg.content).toMatch(/waiting for the user's approval/);

    // The write tool is offered to developers
    expect(state.chatBodies[0].body.tools.map((t) => t.function.name)).toContain('propose_record_update');
  });

  it('shows the pending action with the conversation', async () => {
    const res = await developer.get(`/api/chat/conversations/${conversationId}`);
    expect(res.body.conversation.actions).toEqual([expect.objectContaining({ id: actionId, status: 'pending' })]);
  });

  it('another user cannot approve it', async () => {
    const res = await functional.post(`/api/chat/actions/${actionId}/approve`);
    expect(res.status).toBe(403);
    expect(state.patches).toEqual([]);
  });

  it('applies the change once when the owner approves', async () => {
    const res = await developer.post(`/api/chat/actions/${actionId}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.action.status).toBe('applied');
    expect(state.patches).toEqual([{ Name: 'Hearing Aid Pro' }]);

    const again = await developer.post(`/api/chat/actions/${actionId}/approve`);
    expect(again.status).toBe(400);
    expect(state.patches).toHaveLength(1);

    const conv = await developer.get(`/api/chat/conversations/${conversationId}`);
    expect(conv.body.conversation.messages.at(-1).content).toMatch(/^Applied: Update Product2 "Hearing Aid"/);
  });

  it('records proposals, tool calls and decisions in the audit log', async () => {
    const auditService = require('../../services/auditService')();
    await auditService.flushBatch();
    const { sequelize } = require('../../services/databaseService');
    const { quotedTable } = require('../../db/migrationHelpers');
    const rows = await sequelize.query(`SELECT action FROM ${quotedTable(sequelize.getQueryInterface(), 'audit_logs')}`, {
      type: require('sequelize').QueryTypes.SELECT,
    });
    const actions = rows.map((r) => (Array.isArray(r) ? r[0] : r.action));
    expect(actions).toEqual(expect.arrayContaining(['ai_write_proposed', 'ai_chat_message', 'ai_write_approved']));
  });

  it('functional users do not get the write tool', async () => {
    const conv = await functional.post('/api/chat/conversations').send({ adapter: 'copilot' });
    state.chatBodies = [];
    await chat(functional, conv.body.conversation.id, 'Hi');
    expect(state.chatBodies[0].body.tools.map((t) => t.function.name)).not.toContain('propose_record_update');
  });

  it('rejecting leaves Salesforce untouched', async () => {
    const conv = await developer.post('/api/chat/conversations').send({ adapter: 'copilot' });
    const events = await chat(developer, conv.body.conversation.id, 'rename it again please');
    const { action } = events.find((e) => e.type === 'confirmation_required');
    const res = await developer.post(`/api/chat/actions/${action.id}/reject`);
    expect(res.body.action.status).toBe('rejected');
    expect(state.patches).toHaveLength(1);
  });
});

describe('Copilot token expiry', () => {
  it('refreshes the session token and retries once on 401', async () => {
    const conv = await developer.post('/api/chat/conversations').send({ adapter: 'copilot' });
    const before = state.tokenExchanges;
    state.failNextChatWith401 = true;
    const events = await chat(developer, conv.body.conversation.id, 'Hi again');
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(events.at(-1).type).toBe('done');
    expect(state.tokenExchanges).toBe(before + 1);
    expect(state.chatBodies.at(-1).auth).toBe(`Bearer session-${state.tokenExchanges}`);
  });
});

describe('usage and cost', () => {
  it('reports the current user’s usage; Copilot is included in the plan', async () => {
    const res = await developer.get('/api/chat/usage?days=7');
    expect(res.status).toBe(200);
    expect(res.body.totals.messages).toBeGreaterThan(0);
    expect(res.body.byModel[0]).toMatchObject({ adapter: 'copilot', model: 'gpt-4.1', costUsd: 0 });
  });

  it('only admins can see everyone’s usage', async () => {
    expect((await developer.get('/api/chat/usage?scope=all')).status).toBe(403);
  });
});
