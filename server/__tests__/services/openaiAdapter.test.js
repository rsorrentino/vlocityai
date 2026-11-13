jest.mock('../../services/vlocityAgentTools', () => ({
  TOOL_DEFINITIONS: [{ name: 'run_soql', description: 'Run SOQL', input_schema: { type: 'object', properties: {} } }],
  toOpenAITools: (defs) => defs.map((d) => ({ type: 'function', function: { name: d.name, parameters: d.input_schema } })),
  executeTool: jest.fn().mockResolvedValue('{"totalSize":3}'),
}));

jest.mock('../../services/aiAdapters/githubCopilot', () => {
  const actual = jest.requireActual('../../services/aiAdapters/githubCopilot');
  return {
    ...actual,
    getCopilotSession: jest.fn(),
    discoverLocalCopilotToken: jest.fn(),
  };
});

const copilot = require('../../services/aiAdapters/githubCopilot');
const { executeTool } = require('../../services/vlocityAgentTools');
const {
  runOpenAIStream,
  resolveClientOptions,
  resolveCopilotGitHubToken,
  normalizeOllamaBase,
} = require('../../services/aiAdapters/openaiAdapter');

const ENV_KEYS = ['GITHUB_COPILOT_TOKEN', 'GITHUB_TOKEN', 'COPILOT_USE_LOCAL_TOKEN', 'OPENAI_API_KEY', 'GITHUB_MODELS_TOKEN'];

function storeWith(token) {
  return { getCredential: jest.fn().mockResolvedValue(token ? { token, accountLogin: 'octocat' } : null) };
}

async function* streamOf(chunks) {
  for (const c of chunks) yield c;
}

describe('openaiAdapter', () => {
  const savedEnv = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    copilot.getCopilotSession.mockReset();
    copilot.discoverLocalCopilotToken.mockReset();
    executeTool.mockResolvedValue('{"totalSize":3}');
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  describe('resolveCopilotGitHubToken', () => {
    it('prefers a token sent with the request', async () => {
      const r = await resolveCopilotGitHubToken({ apiKey: 'gho_req', userId: 'u1', credentialStore: storeWith('gho_user') });
      expect(r).toEqual({ token: 'gho_req', source: 'request' });
    });

    it('then the user’s stored token', async () => {
      process.env.GITHUB_COPILOT_TOKEN = 'gho_env';
      const r = await resolveCopilotGitHubToken({ userId: 'u1', credentialStore: storeWith('gho_user') });
      expect(r).toMatchObject({ token: 'gho_user', source: 'user', accountLogin: 'octocat' });
    });

    it('then GITHUB_COPILOT_TOKEN', async () => {
      process.env.GITHUB_COPILOT_TOKEN = 'gho_env';
      const r = await resolveCopilotGitHubToken({ userId: 'u1', credentialStore: storeWith(null) });
      expect(r).toEqual({ token: 'gho_env', source: 'env' });
    });

    it('only reads the local IDE token when explicitly enabled', async () => {
      copilot.discoverLocalCopilotToken.mockReturnValue('ghu_local');
      let r = await resolveCopilotGitHubToken({ credentialStore: storeWith(null) });
      expect(r.token).toBeNull();
      expect(copilot.discoverLocalCopilotToken).not.toHaveBeenCalled();

      process.env.COPILOT_USE_LOCAL_TOKEN = 'true';
      r = await resolveCopilotGitHubToken({ credentialStore: storeWith(null) });
      expect(r).toEqual({ token: 'ghu_local', source: 'local' });
    });

    it('survives a credential store that is not ready', async () => {
      const store = { getCredential: jest.fn().mockRejectedValue(new Error('db down')) };
      process.env.GITHUB_COPILOT_TOKEN = 'gho_env';
      const r = await resolveCopilotGitHubToken({ userId: 'u1', credentialStore: store });
      expect(r).toEqual({ token: 'gho_env', source: 'env' });
    });

    it('ignores GITHUB_TOKEN (PATs/CI tokens are not Copilot tokens)', async () => {
      process.env.GITHUB_TOKEN = 'ghp_pat';
      const r = await resolveCopilotGitHubToken({ credentialStore: storeWith(null) });
      expect(r).toEqual({ token: null, source: null });
    });
  });

  describe('resolveClientOptions', () => {
    it('copilot: uses the exchanged session token, its endpoint and editor headers', async () => {
      copilot.getCopilotSession.mockResolvedValue({ token: 'sess', apiBase: 'https://api.individual.githubcopilot.com' });
      const opts = await resolveClientOptions({ adapterType: 'copilot', userId: 'u1', credentialStore: storeWith('gho_user') });
      expect(copilot.getCopilotSession).toHaveBeenCalledWith('gho_user', expect.anything());
      expect(opts.apiKey).toBe('sess');
      expect(opts.baseURL).toBe('https://api.individual.githubcopilot.com');
      expect(opts.defaultHeaders['Copilot-Integration-Id']).toBe('vscode-chat');
    });

    it('copilot: ignores a caller-supplied base URL', async () => {
      copilot.getCopilotSession.mockResolvedValue({ token: 'sess', apiBase: 'https://api.githubcopilot.com' });
      const opts = await resolveClientOptions({ adapterType: 'copilot', baseURL: 'https://evil.example', credentialStore: storeWith('gho') });
      expect(opts.baseURL).toBe('https://api.githubcopilot.com');
    });

    it('openai: never sends the server key to a caller-supplied base URL', async () => {
      process.env.OPENAI_API_KEY = 'sk-server';
      const opts = await resolveClientOptions({ adapterType: 'openai', baseURL: 'https://evil.example' });
      expect(opts).toEqual({ apiKey: 'sk-server', baseURL: 'https://api.openai.com/v1' });
    });

    it('openai: allows a custom base URL with the caller’s own key', async () => {
      const opts = await resolveClientOptions({ adapterType: 'openai', apiKey: 'sk-mine', baseURL: 'https://proxy.example/v1' });
      expect(opts).toEqual({ apiKey: 'sk-mine', baseURL: 'https://proxy.example/v1' });
    });

    it('github-models: uses the GitHub Models endpoint', async () => {
      process.env.GITHUB_MODELS_TOKEN = 'github_pat_x';
      const opts = await resolveClientOptions({ adapterType: 'github-models' });
      expect(opts).toEqual({ apiKey: 'github_pat_x', baseURL: 'https://models.github.ai/inference' });
    });

    it('fails clearly when no key is configured', async () => {
      await expect(resolveClientOptions({ adapterType: 'openai' })).rejects.toThrow(/No API key configured for openai/);
    });

    it('ollama: normalises the base URL', async () => {
      const opts = await resolveClientOptions({ adapterType: 'ollama', baseURL: 'http://localhost:11434/' });
      expect(opts.baseURL).toBe('http://localhost:11434/v1');
      expect(normalizeOllamaBase('http://host:1/v1')).toBe('http://host:1/v1');
    });
  });

  describe('runOpenAIStream (Copilot)', () => {
    it('streams text, runs tool calls split across chunks and returns the answer', async () => {
      copilot.getCopilotSession.mockResolvedValue({ token: 'sess', apiBase: 'https://api.githubcopilot.com' });
      const create = jest.fn()
        // Round 1: tool call whose id/name are repeated on every chunk (as some Copilot models do)
        .mockResolvedValueOnce(streamOf([
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'run_soql', arguments: '{"soql":' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'run_soql', arguments: '"SELECT COUNT() FROM Product2"}' } }] } }] },
        ]))
        // Round 2: final answer
        .mockResolvedValueOnce(streamOf([
          { choices: [{ delta: { content: 'There are ' } }] },
          { choices: [{ delta: { content: '3 products.' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
        ]));
      const clientFactory = jest.fn(() => ({ chat: { completions: { create } } }));
      const tokens = [];
      const onToolStart = jest.fn();
      const onToolEnd = jest.fn();

      const result = await runOpenAIStream({
        adapterType: 'copilot',
        messages: [{ role: 'user', content: 'How many products?' }],
        systemPrompt: 'sys',
        userId: 'u1',
        orgUsername: 'me@org',
        onToken: (t) => tokens.push(t),
        onToolStart,
        onToolEnd,
        clientFactory,
        credentialStore: storeWith('gho_user'),
      });

      expect(clientFactory).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sess', baseURL: 'https://api.githubcopilot.com' }));
      expect(create.mock.calls[0][0].model).toBe('gpt-4.1');
      expect(onToolStart).toHaveBeenCalledWith('run_soql', { soql: 'SELECT COUNT() FROM Product2' });
      expect(executeTool).toHaveBeenCalledWith('run_soql', { soql: 'SELECT COUNT() FROM Product2' }, 'me@org');

      const secondCallMessages = create.mock.calls[1][0].messages;
      const assistant = secondCallMessages.find((m) => m.role === 'assistant');
      expect(assistant.tool_calls).toEqual([
        { id: 'call_1', type: 'function', function: { name: 'run_soql', arguments: '{"soql":"SELECT COUNT() FROM Product2"}' } },
      ]);
      expect(secondCallMessages.at(-1)).toEqual({ role: 'tool', tool_call_id: 'call_1', content: '{"totalSize":3}' });

      expect(tokens.join('')).toBe('There are 3 products.');
      expect(result.content).toBe('There are 3 products.');
      expect(result.tokensUsed).toBe(15);
      expect(result.toolCalls).toHaveLength(1);
    });

    it('surfaces Copilot auth problems', async () => {
      copilot.getCopilotSession.mockRejectedValue(new copilot.CopilotAuthError('no subscription', 403));
      await expect(runOpenAIStream({
        adapterType: 'copilot',
        messages: [],
        systemPrompt: '',
        credentialStore: storeWith('gho'),
        onToken: jest.fn(),
        onToolStart: jest.fn(),
        onToolEnd: jest.fn(),
        clientFactory: jest.fn(),
      })).rejects.toThrow(/no subscription/);
    });
  });
});
