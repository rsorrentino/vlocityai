const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const pricing = require('../../config/aiPricing');
const aiWriteActions = require('../../services/aiWriteActions');
const { runAnthropicStream, REFUSAL_MESSAGE } = require('../../services/aiAdapters/anthropicAdapter');

describe('aiPricing.estimateCost', () => {
  afterEach(() => {
    delete process.env.AI_PRICING_FILE;
    pricing._resetForTests();
  });

  it('prices Anthropic models per million tokens', () => {
    expect(pricing.estimateCost({ adapter: 'anthropic', model: 'claude-opus-5-5', inputTokens: 1_000_000, outputTokens: 100_000 }))
      .toEqual({ costUsd: 6, note: null }); // 1M x $4 + 0.1M x $20
  });

  it('treats Copilot and Ollama as included / local', () => {
    expect(pricing.estimateCost({ adapter: 'copilot', model: 'gpt-4.1', inputTokens: 5000 }).costUsd).toBe(0);
    expect(pricing.estimateCost({ adapter: 'ollama', model: 'llama3.2', inputTokens: 5000 }).costUsd).toBe(0);
  });

  it('returns null cost for models without a price', () => {
    expect(pricing.estimateCost({ adapter: 'openai', model: 'gpt-4o', inputTokens: 10 })).toMatchObject({ costUsd: null });
  });

  it('reads overrides from AI_PRICING_FILE (including provider-prefixed names)', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-')), 'p.json');
    fs.writeFileSync(file, JSON.stringify({ 'gpt-4.1': { input: 2, output: 8 }, broken: { input: 'x' } }));
    process.env.AI_PRICING_FILE = file;
    pricing._resetForTests();
    expect(pricing.estimateCost({ adapter: 'github-models', model: 'openai/gpt-4.1', inputTokens: 500_000, outputTokens: 500_000 }).costUsd).toBe(5);
    expect(pricing.priceFor('broken')).toBeNull();
  });
});

describe('aiWriteActions', () => {
  const developer = { role: 'developer', permissions: [{ resource: 'configs', actions: ['read', 'write'] }] };
  const functional = { role: 'functional', permissions: [{ resource: 'configs', actions: ['read'] }] };

  afterEach(() => {
    delete process.env.AI_WRITE_ACTIONS;
    delete process.env.AI_WRITE_ALLOWED_OBJECTS;
  });

  it('offers writes to developers and admins only, and can be switched off', () => {
    expect(aiWriteActions.canWrite(developer)).toBe(true);
    expect(aiWriteActions.canWrite({ role: 'admin' })).toBe(true);
    expect(aiWriteActions.canWrite(functional)).toBe(false);
    process.env.AI_WRITE_ACTIONS = 'false';
    expect(aiWriteActions.canWrite({ role: 'admin' })).toBe(false);
  });

  it('accepts a valid proposal', () => {
    expect(aiWriteActions.validateProposal({
      sobject: 'Product2', record_id: '01t000000000001AAA', fields: { Name: 'X', IsActive: true, vlocity_cmt__Price__c: 9.5 }, reason: 'asked',
    })).toMatchObject({ sobject: 'Product2', recordId: '01t000000000001AAA', fields: { Name: 'X', IsActive: true } });
  });

  it.each([
    [{ sobject: 'User', record_id: '005000000000001AAA', fields: { IsActive: false } }, /not allowed to change User/],
    [{ sobject: 'Account', record_id: '001000000000001AAA', fields: { Name: 'x' } }, /not allowed to change Account/],
    [{ sobject: 'Product2', record_id: "01t' OR 1=1", fields: { Name: 'x' } }, /Invalid record Id/],
    [{ sobject: 'Product2', record_id: '01t000000000001AAA', fields: {} }, /No fields/],
    [{ sobject: 'Product2', record_id: '01t000000000001AAA', fields: { OwnerId: '005' } }, /OwnerId cannot be changed/],
    [{ sobject: 'Product2', record_id: '01t000000000001AAA', fields: { 'Name; DROP': 'x' } }, /cannot be changed/],
    [{ sobject: 'Product2', record_id: '01t000000000001AAA', fields: { Name: { nested: true } } }, /must be a text/],
    [{ sobject: 'Product2/../User', record_id: '01t000000000001AAA', fields: { Name: 'x' } }, /Invalid object name/],
  ])('rejects %p', (args, message) => {
    expect(() => aiWriteActions.validateProposal({ reason: 'r', ...args })).toThrow(message);
  });

  it('never allows security objects even if configured', () => {
    process.env.AI_WRITE_ALLOWED_OBJECTS = 'Product2,User,PermissionSet';
    expect(() => aiWriteActions.validateProposal({ sobject: 'PermissionSet', record_id: '0PS000000000001AAA', fields: { Label: 'x' } }))
      .toThrow(/not allowed/);
  });

  it('applies the change with a REST PATCH', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 204, text: async () => '' });
    await aiWriteActions.applyUpdate(
      { orgUsername: 'me', sobject: 'Product2', recordId: '01t000000000001AAA', fields: { Name: 'New' } },
      { fetchImpl, auth: { accessToken: 'tok', instanceUrl: 'https://acme.my.salesforce.com' } }
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://acme.my.salesforce.com/services/data/v62.0/sobjects/Product2/01t000000000001AAA');
    expect(init).toMatchObject({ method: 'PATCH', body: JSON.stringify({ Name: 'New' }) });
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('surfaces Salesforce errors', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 400, text: async () => JSON.stringify([{ message: 'Name: data value too large' }]) });
    await expect(aiWriteActions.applyUpdate(
      { orgUsername: 'me', sobject: 'Product2', recordId: '01t000000000001AAA', fields: { Name: 'x' } },
      { fetchImpl, auth: { accessToken: 't', instanceUrl: 'https://x.my.salesforce.com' } }
    )).rejects.toThrow(/data value too large/);
  });
});

describe('runAnthropicStream', () => {
  // Minimal stand-in for the SDK's MessageStream: emits 'text', resolves finalMessage()
  function fakeClient(turns) {
    const calls = [];
    return {
      calls,
      messages: {
        stream(params) {
          calls.push(JSON.parse(JSON.stringify(params)));
          const turn = turns.shift();
          const emitter = new EventEmitter();
          return {
            on(event, fn) { emitter.on(event, fn); return this; },
            async finalMessage() {
              for (const t of turn.text || []) emitter.emit('text', t);
              return turn.message;
            },
          };
        },
      },
    };
  }

  const noop = () => {};

  it('runs tools, keeps the full assistant turn and sums usage', async () => {
    const thinking = { type: 'thinking', thinking: '', signature: 'sig' };
    const client = fakeClient([
      { message: { stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 20 }, content: [thinking, { type: 'tool_use', id: 'tu1', name: 'list_catalogs', input: {} }] } },
      { text: ['There are ', '2 catalogs.'], message: { stop_reason: 'end_turn', usage: { input_tokens: 150, output_tokens: 10 }, content: [{ type: 'text', text: 'There are 2 catalogs.' }] } },
    ]);
    const executeTool = jest.fn().mockResolvedValue('Found 2 catalogs');
    const tokens = [];

    const result = await runAnthropicStream({
      client, messages: [{ role: 'user', content: 'How many catalogs?' }], systemPrompt: 'sys', orgUsername: 'me',
      onToken: (t) => tokens.push(t), onToolStart: noop, onToolEnd: noop, executeTool,
    });

    expect(result).toMatchObject({ content: 'There are 2 catalogs.', inputTokens: 250, outputTokens: 30, model: 'claude-opus-5-5', stopReason: 'end_turn' });
    expect(executeTool).toHaveBeenCalledWith('list_catalogs', {}, 'me');
    // Second request carries the whole assistant turn (thinking block included) and the tool result
    const second = client.calls[1].messages;
    expect(second.at(-2)).toEqual({ role: 'assistant', content: [thinking, { type: 'tool_use', id: 'tu1', name: 'list_catalogs', input: {} }] });
    expect(second.at(-1)).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'Found 2 catalogs' }] });
    expect(client.calls[0].max_tokens).toBeGreaterThan(4096);
  });

  it('tells the user when Claude declines', async () => {
    const client = fakeClient([{ message: { stop_reason: 'refusal', usage: { input_tokens: 5, output_tokens: 0 }, content: [] } }]);
    const tokens = [];
    const result = await runAnthropicStream({
      client, messages: [{ role: 'user', content: 'x' }], systemPrompt: '', onToken: (t) => tokens.push(t), onToolStart: noop, onToolEnd: noop,
    });
    expect(result.stopReason).toBe('refusal');
    expect(result.content).toBe(REFUSAL_MESSAGE);
    expect(tokens.join('')).toBe(REFUSAL_MESSAGE);
  });
});
