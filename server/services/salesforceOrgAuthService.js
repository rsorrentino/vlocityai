/**
 * Authorise Salesforce orgs from the browser, without a browser on the server.
 *
 * `sf org login web` opens a browser on the machine running the server, which
 * does not work on a shared server or in Docker. This service offers three
 * server-friendly methods; each ends by handing the credentials to the
 * Salesforce CLI (which every export/deploy uses) and importing the org into
 * Organization Management:
 *
 *  1. Device flow  – the user opens login.salesforce.com/setup/connect in their
 *                    own browser and enters a short code. Uses the Salesforce
 *                    CLI's connected app ("PlatformCLI", as `sf org login device`
 *                    does) unless SF_OAUTH_CLIENT_ID is set.
 *  2. SFDX auth URL – paste the "Sfdx Auth Url" from `sf org display --verbose`.
 *  3. JWT bearer   – connected app consumer key + private key (CI/integration).
 *
 * All HTTP goes through fetch and all CLI calls through the shell-free process
 * runner, so it behaves the same on Windows, macOS and Linux.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCommand } = require('../utils/processRunner');
const { resolveSfCli } = require('../utils/sfCli');
const { ValidationError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const DEFAULT_CLIENT_ID = 'PlatformCLI';
const SCOPES = 'refresh_token api web';
const ALIAS = /^[A-Za-z0-9_.@-]{1,80}$/;

class OrgAuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'OrgAuthError';
    this.statusCode = status;
  }
}

function clientId() {
  return process.env.SF_OAUTH_CLIENT_ID || DEFAULT_CLIENT_ID;
}

/**
 * Accept only https Salesforce login / My Domain URLs (prevents the server
 * from being used to call arbitrary hosts).
 */
function normalizeLoginUrl(input) {
  const value = (input || 'https://login.salesforce.com').trim();
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ValidationError('Login URL is not a valid URL');
  }
  const allowedSuffixes = (process.env.SF_ALLOWED_LOGIN_DOMAINS || 'salesforce.com,force.com,salesforce.mil,cloudforce.com')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const host = url.hostname.toLowerCase();
  const allowed = allowedSuffixes.some((s) => host === s || host.endsWith(`.${s}`));
  if (url.protocol !== 'https:' || !allowed) {
    throw new ValidationError(`Login URL must be an https Salesforce domain (${allowedSuffixes.join(', ')})`);
  }
  return `${url.protocol}//${url.host}`;
}

function validateAlias(alias) {
  if (alias === undefined || alias === null || alias === '') return undefined;
  if (!ALIAS.test(String(alias))) throw new ValidationError('Alias may only contain letters, digits, _ . @ -');
  return String(alias);
}

async function postForm(url, params, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: 'invalid_response', error_description: text.slice(0, 200) };
  }
  return { status: res.status, ok: res.ok, data };
}

// ── Device flow ──────────────────────────────────────────────────────────────

/**
 * @returns {Promise<{deviceCode, userCode, verificationUri, interval, expiresIn, loginUrl}>}
 */
async function startDeviceFlow({ loginUrl, fetchImpl } = {}) {
  const base = normalizeLoginUrl(loginUrl);
  const { ok, status, data } = await postForm(`${base}/services/oauth2/token`, {
    response_type: 'device_code',
    client_id: clientId(),
    scope: SCOPES,
  }, fetchImpl);
  if (!ok || !data.device_code) {
    throw new OrgAuthError(`Salesforce did not start the sign-in (${status}): ${data.error_description || data.error || 'unknown error'}`, 502);
  }
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri || `${base}/setup/connect`,
    interval: Number(data.interval) || 5,
    // Salesforce codes are valid for ~10 minutes; it does not always say so
    expiresIn: Number(data.expires_in) || 600,
    loginUrl: base,
  };
}

/**
 * Poll once. On success returns tokens.
 * @returns {Promise<{status:'pending'|'slow_down'|'complete'|'denied'|'expired'|'error', tokens?:object, message?:string}>}
 */
async function pollDeviceFlow({ loginUrl, deviceCode, fetchImpl }) {
  const base = normalizeLoginUrl(loginUrl);
  const { ok, data } = await postForm(`${base}/services/oauth2/token`, {
    grant_type: 'device',
    client_id: clientId(),
    code: deviceCode,
    ...(process.env.SF_OAUTH_CLIENT_SECRET ? { client_secret: process.env.SF_OAUTH_CLIENT_SECRET } : {}),
  }, fetchImpl);

  if (ok && data.access_token) {
    if (!data.refresh_token || !data.instance_url) {
      return { status: 'error', message: 'Salesforce did not return a refresh token. Check the connected app scopes (refresh_token, api).' };
    }
    return { status: 'complete', tokens: { refreshToken: data.refresh_token, instanceUrl: data.instance_url } };
  }
  switch (data.error) {
    case 'authorization_pending':
      return { status: 'pending' };
    case 'slow_down':
      return { status: 'slow_down' };
    case 'access_denied':
      return { status: 'denied', message: 'Access was denied in Salesforce.' };
    case 'invalid_grant':
    case 'expired_token':
      return { status: 'expired', message: 'The code expired. Start again.' };
    default:
      return { status: 'error', message: data.error_description || data.error || 'Unexpected response from Salesforce' };
  }
}

// ── Salesforce CLI hand-off ──────────────────────────────────────────────────

/** Build an SFDX auth URL (force://clientId:secret:refreshToken@host). */
function buildSfdxAuthUrl({ refreshToken, instanceUrl, clientSecret = process.env.SF_OAUTH_CLIENT_SECRET || '' }) {
  const host = new URL(instanceUrl).host;
  return `force://${clientId()}:${clientSecret}:${refreshToken}@${host}`;
}

function validateSfdxAuthUrl(authUrl) {
  const value = String(authUrl || '').trim();
  if (!/^force:\/\/[^\s:@]+:[^\s:@]*:[^\s@]+@[A-Za-z0-9.-]+(:\d+)?\/?$/.test(value)) {
    throw new ValidationError('Not a valid SFDX auth URL (expected force://<clientId>:<secret>:<refreshToken>@<instance>)');
  }
  return value;
}

/** Write a secret to a private temp file, run fn(file), always delete it. */
async function withSecretFile(contents, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vlocityai-auth-'));
  const file = path.join(dir, `${crypto.randomBytes(8).toString('hex')}.tmp`);
  fs.writeFileSync(file, contents, { mode: 0o600 });
  try {
    return await fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function requireCli() {
  const cli = await resolveSfCli();
  if (cli !== 'sf') {
    throw new OrgAuthError('The Salesforce CLI (sf) is not installed on the server. Install it with: npm install -g @salesforce/cli', 503);
  }
  return cli;
}

function parseCliJson(stdout, stderr) {
  const clean = String(stdout || '').replace(/\x1b\[[0-9;]*m/g, '');
  try {
    return JSON.parse(clean);
  } catch {
    throw new OrgAuthError(`Salesforce CLI returned unexpected output: ${(stderr || clean).slice(0, 300)}`, 502);
  }
}

async function runLogin(args) {
  await requireCli();
  const { stdout, stderr, code } = await runCommand('sf', [...args, '--json'], { timeout: 120000 });
  const json = parseCliJson(stdout, stderr);
  if (code !== 0 || json.status !== 0) {
    throw new OrgAuthError(`Salesforce CLI login failed: ${json.message || json.name || stderr || 'unknown error'}`, 400);
  }
  const result = json.result || {};
  return { username: result.username, orgId: result.orgId, instanceUrl: result.instanceUrl };
}

/** Store an SFDX auth URL in the Salesforce CLI. */
async function loginWithSfdxUrl({ authUrl, alias, setDefault = false }) {
  const url = validateSfdxAuthUrl(authUrl);
  const safeAlias = validateAlias(alias);
  return withSecretFile(url, (file) => runLogin([
    'org', 'login', 'sfdx-url', '--sfdx-url-file', file,
    ...(safeAlias ? ['--alias', safeAlias] : []),
    ...(setDefault ? ['--set-default'] : []),
  ]));
}

/** JWT bearer flow (connected app with a certificate). */
async function loginWithJwt({ clientId: jwtClientId, username, privateKey, loginUrl, alias }) {
  if (!jwtClientId || !/^[A-Za-z0-9._]{10,}$/.test(jwtClientId)) throw new ValidationError('A valid connected app consumer key is required');
  if (!username || !/^[^\s@]+@[^\s@]+$/.test(username)) throw new ValidationError('A valid Salesforce username is required');
  if (!privateKey || !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(privateKey)) throw new ValidationError('A PEM private key is required');
  const base = normalizeLoginUrl(loginUrl);
  const safeAlias = validateAlias(alias);
  return withSecretFile(privateKey, (file) => runLogin([
    'org', 'login', 'jwt',
    '--client-id', jwtClientId,
    '--jwt-key-file', file,
    '--username', username,
    '--instance-url', base,
    ...(safeAlias ? ['--alias', safeAlias] : []),
  ]));
}

/** After a successful CLI login: import into the Org table with label/env. */
async function registerOrg({ username, label, environment }) {
  const orgService = require('./orgService');
  await orgService.syncFromCli();
  if (username && (label || environment)) {
    try {
      await orgService.updateOrg(username, { label, environment });
    } catch (error) {
      logger.warn('Could not set label/environment for new org', { username, error: error.message });
    }
  }
}

module.exports = {
  startDeviceFlow,
  pollDeviceFlow,
  buildSfdxAuthUrl,
  validateSfdxAuthUrl,
  normalizeLoginUrl,
  loginWithSfdxUrl,
  loginWithJwt,
  registerOrg,
  OrgAuthError,
  DEFAULT_CLIENT_ID,
};
