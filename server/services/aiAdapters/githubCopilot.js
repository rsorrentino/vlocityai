/**
 * GitHub Copilot integration.
 *
 * The Copilot chat API (https://api.githubcopilot.com, OpenAI-compatible) does
 * not accept a GitHub token directly. The flow is:
 *
 *   1. Obtain a GitHub OAuth token for a Copilot-enabled OAuth app, either
 *      - interactively with the OAuth device flow (startDeviceFlow/pollDeviceFlow),
 *      - from GITHUB_COPILOT_TOKEN, or
 *      - (opt-in) from the local Copilot IDE plugin config on this machine.
 *   2. Exchange it for a short-lived Copilot session token
 *      (GET https://api.github.com/copilot_internal/v2/token). The response also
 *      tells us which API endpoint to use (individual / business / enterprise).
 *   3. Call the chat completions endpoint with the session token and the
 *      editor headers Copilot requires.
 *
 * Everything here is plain HTTPS through fetch, so it behaves identically on
 * Windows, Linux and macOS. Local token discovery uses the per-OS config
 * locations of the Copilot IDE plugins.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GITHUB_BASE_URL = (process.env.GITHUB_BASE_URL || 'https://github.com').replace(/\/+$/, '');
const GITHUB_API_URL = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
const DEFAULT_COPILOT_API = 'https://api.githubcopilot.com';

// OAuth client id of the GitHub Copilot editor integration. Override with
// COPILOT_OAUTH_CLIENT_ID if your organisation provides its own app.
const DEFAULT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';

const EDITOR_VERSION = process.env.COPILOT_EDITOR_VERSION || 'vscode/1.99.3';
const EDITOR_PLUGIN_VERSION = process.env.COPILOT_EDITOR_PLUGIN_VERSION || 'copilot-chat/0.26.7';
const USER_AGENT = process.env.COPILOT_USER_AGENT || 'GitHubCopilotChat/0.26.7';
const INTEGRATION_ID = process.env.COPILOT_INTEGRATION_ID || 'vscode-chat';

const REFRESH_MARGIN_SECONDS = 120;

function getClientId() {
  return process.env.COPILOT_OAUTH_CLIENT_ID || DEFAULT_CLIENT_ID;
}

class CopilotAuthError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'CopilotAuthError';
    this.status = status;
  }
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function requestJson(url, { method = 'GET', headers = {}, body, fetchImpl } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  const res = await doFetch(url, {
    method,
    headers: { Accept: 'application/json', ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, ok: res.ok, data };
}

// ── Device flow ───────────────────────────────────────────────────────────────

/**
 * Start the GitHub OAuth device flow.
 * @returns {Promise<{deviceCode:string,userCode:string,verificationUri:string,expiresIn:number,interval:number}>}
 */
async function startDeviceFlow({ fetchImpl } = {}) {
  const { ok, status, data } = await requestJson(`${GITHUB_BASE_URL}/login/device/code`, {
    method: 'POST',
    body: { client_id: getClientId(), scope: 'read:user' },
    fetchImpl,
  });
  if (!ok || !data?.device_code) {
    throw new CopilotAuthError(
      `GitHub device flow could not be started (${status}): ${data?.error_description || data?.message || 'unknown error'}`,
      status
    );
  }
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri || `${GITHUB_BASE_URL}/login/device`,
    expiresIn: Number(data.expires_in) || 900,
    interval: Number(data.interval) || 5,
  };
}

/**
 * Poll the device flow once.
 * @returns {Promise<{status:'pending'|'slow_down'|'complete'|'expired'|'denied'|'error', accessToken?:string, interval?:number, message?:string}>}
 */
async function pollDeviceFlow(deviceCode, { fetchImpl } = {}) {
  const { data } = await requestJson(`${GITHUB_BASE_URL}/login/oauth/access_token`, {
    method: 'POST',
    body: {
      client_id: getClientId(),
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    },
    fetchImpl,
  });

  if (data?.access_token) {
    return { status: 'complete', accessToken: data.access_token };
  }
  switch (data?.error) {
    case 'authorization_pending':
      return { status: 'pending' };
    case 'slow_down':
      return { status: 'slow_down', interval: Number(data.interval) || undefined };
    case 'expired_token':
      return { status: 'expired', message: 'The code expired. Start again.' };
    case 'access_denied':
      return { status: 'denied', message: 'Authorization was cancelled on GitHub.' };
    default:
      return { status: 'error', message: data?.error_description || data?.error || 'Unexpected response from GitHub' };
  }
}

/**
 * Look up the GitHub login for a token (used to show "connected as …").
 */
async function getGitHubUser(githubToken, { fetchImpl } = {}) {
  const { ok, data } = await requestJson(`${GITHUB_API_URL}/user`, {
    headers: { Authorization: `token ${githubToken}`, 'User-Agent': USER_AGENT },
    fetchImpl,
  });
  return ok ? { login: data?.login, name: data?.name } : null;
}

// ── Session token exchange ────────────────────────────────────────────────────

const sessionCache = new Map(); // sha256(githubToken) -> { token, expiresAt, apiBase }

function cacheKey(githubToken) {
  return crypto.createHash('sha256').update(String(githubToken)).digest('hex');
}

/**
 * Exchange a GitHub OAuth token for a Copilot session token (cached).
 * @returns {Promise<{token:string, expiresAt:number, apiBase:string}>}
 */
async function getCopilotSession(githubToken, { fetchImpl, force = false } = {}) {
  if (!githubToken) {
    throw new CopilotAuthError('GitHub Copilot is not connected. Sign in with GitHub in the chat settings.', 401);
  }
  const key = cacheKey(githubToken);
  const cached = sessionCache.get(key);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!force && cached && cached.expiresAt - REFRESH_MARGIN_SECONDS > nowSec) {
    return cached;
  }

  const { ok, status, data } = await requestJson(`${GITHUB_API_URL}/copilot_internal/v2/token`, {
    headers: {
      Authorization: `token ${githubToken}`,
      'Editor-Version': EDITOR_VERSION,
      'Editor-Plugin-Version': EDITOR_PLUGIN_VERSION,
      'User-Agent': USER_AGENT,
    },
    fetchImpl,
  });

  if (!ok || !data?.token) {
    sessionCache.delete(key);
    let hint = '';
    if (status === 401) hint = ' The GitHub token is invalid or expired – sign in again.';
    else if (status === 403) hint = ' This GitHub account has no active Copilot subscription, or Copilot is disabled by your organisation.';
    else if (status === 404) hint = ' Personal access tokens are not accepted by Copilot – use "Sign in with GitHub" instead.';
    throw new CopilotAuthError(
      `Could not obtain a Copilot session (${status}).${hint}`,
      status
    );
  }

  const session = {
    token: data.token,
    expiresAt: Number(data.expires_at) || nowSec + 25 * 60,
    apiBase: (data.endpoints?.api || DEFAULT_COPILOT_API).replace(/\/+$/, ''),
  };
  sessionCache.set(key, session);
  return session;
}

/** Headers required by the Copilot chat API. */
function copilotHeaders() {
  return {
    'Editor-Version': EDITOR_VERSION,
    'Editor-Plugin-Version': EDITOR_PLUGIN_VERSION,
    'Copilot-Integration-Id': INTEGRATION_ID,
    'User-Agent': USER_AGENT,
    'Openai-Intent': 'conversation-panel',
    'X-Request-Id': crypto.randomUUID(),
  };
}

/**
 * List chat models available to this Copilot account.
 * @returns {Promise<Array<{id:string,name:string,vendor?:string,toolCalls:boolean}>>}
 */
async function listCopilotModels(githubToken, { fetchImpl } = {}) {
  const session = await getCopilotSession(githubToken, { fetchImpl });
  const { ok, status, data } = await requestJson(`${session.apiBase}/models`, {
    headers: { Authorization: `Bearer ${session.token}`, ...copilotHeaders() },
    fetchImpl,
  });
  if (!ok) {
    throw new CopilotAuthError(`Could not list Copilot models (${status})`, status);
  }
  const models = Array.isArray(data?.data) ? data.data : [];
  return models
    .filter((m) => (m.capabilities?.type || 'chat') === 'chat')
    .filter((m) => m.model_picker_enabled !== false)
    .filter((m) => !m.policy || m.policy.state !== 'disabled')
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
      vendor: m.vendor,
      toolCalls: Boolean(m.capabilities?.supports?.tool_calls),
    }));
}

// ── Local Copilot install discovery (opt-in) ─────────────────────────────────

/**
 * Directories where the Copilot IDE plugins (VS Code, JetBrains, Neovim, …)
 * store their GitHub OAuth token, per operating system.
 */
function localCopilotConfigDirs({ platform = process.platform, env = process.env, homedir = os.homedir() } = {}) {
  const dirs = [];
  if (platform === 'win32') {
    if (env.LOCALAPPDATA) dirs.push(path.win32.join(env.LOCALAPPDATA, 'github-copilot'));
    if (env.APPDATA) dirs.push(path.win32.join(env.APPDATA, 'github-copilot'));
    dirs.push(path.win32.join(homedir, 'AppData', 'Local', 'github-copilot'));
  } else {
    if (env.XDG_CONFIG_HOME) dirs.push(path.posix.join(env.XDG_CONFIG_HOME, 'github-copilot'));
    dirs.push(path.posix.join(homedir, '.config', 'github-copilot'));
  }
  return [...new Set(dirs)];
}

/**
 * Read a GitHub OAuth token left by a Copilot IDE plugin on this machine.
 * Only used when COPILOT_USE_LOCAL_TOKEN=true (single-user/desktop installs),
 * because every user of the app would share it.
 * @returns {string|null}
 */
function discoverLocalCopilotToken(opts = {}) {
  const readFile = opts.readFile || ((p) => fs.readFileSync(p, 'utf8'));
  for (const dir of localCopilotConfigDirs(opts)) {
    for (const file of ['apps.json', 'hosts.json']) {
      try {
        const json = JSON.parse(readFile(path.join(dir, file)));
        for (const [host, entry] of Object.entries(json || {})) {
          if (host.startsWith('github.com') && entry && entry.oauth_token) {
            return entry.oauth_token;
          }
        }
      } catch {
        /* not present */
      }
    }
  }
  return null;
}

function _clearSessionCache() {
  sessionCache.clear();
}

module.exports = {
  startDeviceFlow,
  pollDeviceFlow,
  getGitHubUser,
  getCopilotSession,
  listCopilotModels,
  copilotHeaders,
  localCopilotConfigDirs,
  discoverLocalCopilotToken,
  CopilotAuthError,
  DEFAULT_COPILOT_API,
  _clearSessionCache,
};
