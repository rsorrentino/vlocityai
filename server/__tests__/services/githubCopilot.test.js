const path = require('path');
const copilot = require('../../services/aiAdapters/githubCopilot');

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
  };
}

describe('githubCopilot', () => {
  beforeEach(() => {
    copilot._clearSessionCache();
  });

  describe('device flow', () => {
    it('starts the flow with the Copilot OAuth client id', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, {
        device_code: 'dev-123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      }));

      const flow = await copilot.startDeviceFlow({ fetchImpl });

      expect(flow).toEqual({
        deviceCode: 'dev-123',
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        expiresIn: 900,
        interval: 5,
      });
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe('https://github.com/login/device/code');
      expect(JSON.parse(init.body)).toEqual({ client_id: 'Iv1.b507a08c87ecfe98', scope: 'read:user' });
    });

    it('throws a readable error when GitHub refuses', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(400, { error_description: 'bad client' }));
      await expect(copilot.startDeviceFlow({ fetchImpl })).rejects.toThrow(/bad client/);
    });

    it.each([
      [{ error: 'authorization_pending' }, { status: 'pending' }],
      [{ error: 'slow_down', interval: 10 }, { status: 'slow_down', interval: 10 }],
      [{ error: 'expired_token' }, expect.objectContaining({ status: 'expired' })],
      [{ error: 'access_denied' }, expect.objectContaining({ status: 'denied' })],
      [{ access_token: 'gho_abc' }, { status: 'complete', accessToken: 'gho_abc' }],
    ])('maps poll response %p', async (body, expected) => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, body));
      await expect(copilot.pollDeviceFlow('dev-123', { fetchImpl })).resolves.toEqual(expected);
      const sent = JSON.parse(fetchImpl.mock.calls[0][1].body);
      expect(sent.grant_type).toBe('urn:ietf:params:oauth:grant-type:device_code');
    });
  });

  describe('session token exchange', () => {
    const nowSec = () => Math.floor(Date.now() / 1000);

    it('exchanges the GitHub token and uses the endpoint GitHub returns', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, {
        token: 'tid=copilot-session',
        expires_at: nowSec() + 1800,
        endpoints: { api: 'https://api.business.githubcopilot.com/' },
      }));

      const session = await copilot.getCopilotSession('gho_abc', { fetchImpl });

      expect(session.token).toBe('tid=copilot-session');
      expect(session.apiBase).toBe('https://api.business.githubcopilot.com');
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe('https://api.github.com/copilot_internal/v2/token');
      expect(init.headers.Authorization).toBe('token gho_abc');
      expect(init.headers['Editor-Version']).toBeTruthy();
    });

    it('caches the session until shortly before it expires', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { token: 't1', expires_at: nowSec() + 1800 }));
      await copilot.getCopilotSession('gho_abc', { fetchImpl });
      await copilot.getCopilotSession('gho_abc', { fetchImpl });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('refreshes a session that is about to expire', async () => {
      const fetchImpl = jest.fn()
        .mockResolvedValueOnce(jsonResponse(200, { token: 't1', expires_at: nowSec() + 30 }))
        .mockResolvedValueOnce(jsonResponse(200, { token: 't2', expires_at: nowSec() + 1800 }));
      await copilot.getCopilotSession('gho_abc', { fetchImpl });
      const second = await copilot.getCopilotSession('gho_abc', { fetchImpl });
      expect(second.token).toBe('t2');
    });

    it.each([
      [401, /invalid or expired/],
      [403, /no active Copilot subscription/],
      [404, /Personal access tokens are not accepted/],
    ])('explains HTTP %d', async (status, message) => {
      const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(status, { message: 'nope' }));
      await expect(copilot.getCopilotSession('ghp_x', { fetchImpl })).rejects.toThrow(message);
    });

    it('requires a token', async () => {
      await expect(copilot.getCopilotSession(null)).rejects.toThrow(/not connected/);
    });
  });

  describe('listCopilotModels', () => {
    it('returns enabled chat models', async () => {
      const fetchImpl = jest.fn()
        .mockResolvedValueOnce(jsonResponse(200, { token: 't', expires_at: Math.floor(Date.now() / 1000) + 1800 }))
        .mockResolvedValueOnce(jsonResponse(200, {
          data: [
            { id: 'gpt-4.1', name: 'GPT-4.1', vendor: 'Azure OpenAI', model_picker_enabled: true, capabilities: { type: 'chat', supports: { tool_calls: true } } },
            { id: 'claude-sonnet', name: 'Claude Sonnet', model_picker_enabled: true, capabilities: { type: 'chat', supports: { tool_calls: true } }, policy: { state: 'enabled' } },
            { id: 'disabled-model', model_picker_enabled: true, capabilities: { type: 'chat' }, policy: { state: 'disabled' } },
            { id: 'text-embedding-3-small', capabilities: { type: 'embeddings' } },
            { id: 'hidden', model_picker_enabled: false, capabilities: { type: 'chat' } },
          ],
        }));

      const models = await copilot.listCopilotModels('gho_abc', { fetchImpl });

      expect(models.map((m) => m.id)).toEqual(['gpt-4.1', 'claude-sonnet']);
      expect(models[0]).toEqual({ id: 'gpt-4.1', name: 'GPT-4.1', vendor: 'Azure OpenAI', toolCalls: true });
      const [url, init] = fetchImpl.mock.calls[1];
      expect(url).toBe('https://api.githubcopilot.com/models');
      expect(init.headers.Authorization).toBe('Bearer t');
      expect(init.headers['Copilot-Integration-Id']).toBe('vscode-chat');
    });
  });

  describe('local Copilot token discovery (Windows, macOS, Linux)', () => {
    it('uses %LOCALAPPDATA%\\github-copilot on Windows', () => {
      const dirs = copilot.localCopilotConfigDirs({
        platform: 'win32',
        env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
        homedir: 'C:\\Users\\me',
      });
      expect(dirs[0]).toBe('C:\\Users\\me\\AppData\\Local\\github-copilot');
    });

    it('uses ~/.config/github-copilot on macOS', () => {
      const dirs = copilot.localCopilotConfigDirs({ platform: 'darwin', env: {}, homedir: '/Users/me' });
      expect(dirs).toEqual(['/Users/me/.config/github-copilot']);
    });

    it('honours XDG_CONFIG_HOME on Linux', () => {
      const dirs = copilot.localCopilotConfigDirs({ platform: 'linux', env: { XDG_CONFIG_HOME: '/xdg' }, homedir: '/home/me' });
      expect(dirs).toEqual(['/xdg/github-copilot', '/home/me/.config/github-copilot']);
    });

    it('reads the oauth_token from apps.json', () => {
      const files = {
        [path.join('/home/me/.config/github-copilot', 'apps.json')]: JSON.stringify({
          'github.com:Iv1.b507a08c87ecfe98': { user: 'me', oauth_token: 'ghu_local' },
        }),
      };
      const token = copilot.discoverLocalCopilotToken({
        platform: 'linux',
        env: {},
        homedir: '/home/me',
        readFile: (p) => {
          if (files[p]) return files[p];
          throw new Error('ENOENT');
        },
      });
      expect(token).toBe('ghu_local');
    });

    it('returns null when nothing is installed', () => {
      const token = copilot.discoverLocalCopilotToken({
        platform: 'darwin',
        env: {},
        homedir: '/Users/me',
        readFile: () => { throw new Error('ENOENT'); },
      });
      expect(token).toBeNull();
    });
  });
});
