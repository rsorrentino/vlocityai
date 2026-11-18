/**
 * Authorise Salesforce orgs from the browser (developer/admin – enforced by
 * middleware/accessPolicy.js). See services/salesforceOrgAuthService.js.
 */
const express = require('express');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const orgAuth = require('../services/salesforceOrgAuthService');
const logger = require('../utils/logger');

const router = express.Router();

// Pending device-flow sign-ins per app user (device codes never leave the server)
const pending = new Map();

const ENVIRONMENTS = new Set(['', 'dev', 'uat', 'prod', 'sit', 'qa', 'staging', 'training']);

function orgOptions(body = {}) {
  const environment = body.environment ? String(body.environment).toLowerCase() : '';
  if (!ENVIRONMENTS.has(environment)) throw new ValidationError('Unknown environment');
  if (body.alias && !/^[A-Za-z0-9_.@-]{1,80}$/.test(String(body.alias))) {
    throw new ValidationError('Alias may only contain letters, digits, _ . @ -');
  }
  const label = body.label ? String(body.label).slice(0, 80) : undefined;
  return { alias: body.alias || undefined, label, environment: environment || undefined };
}

/** Start "Sign in with Salesforce" (device flow). */
router.post('/device/start', asyncHandler(async (req, res) => {
  const opts = orgOptions(req.body);
  const loginUrl = orgAuth.normalizeLoginUrl(req.body?.loginUrl);
  const flow = await orgAuth.startDeviceFlow({ loginUrl });
  pending.set(req.userId, { ...flow, ...opts, expiresAt: Date.now() + flow.expiresIn * 1000 });
  res.json({
    userCode: flow.userCode,
    verificationUri: flow.verificationUri,
    interval: flow.interval,
    expiresIn: flow.expiresIn,
  });
}));

/** Poll the device flow once; the client calls this every `interval` seconds. */
router.post('/device/poll', asyncHandler(async (req, res) => {
  const flow = pending.get(req.userId);
  if (!flow || flow.expiresAt < Date.now()) {
    pending.delete(req.userId);
    return res.json({ status: 'expired', message: 'No sign-in in progress or the code expired. Start again.' });
  }

  const result = await orgAuth.pollDeviceFlow({ loginUrl: flow.loginUrl, deviceCode: flow.deviceCode });
  if (result.status === 'slow_down') flow.interval += 5;
  if (result.status !== 'complete') {
    if (['denied', 'expired', 'error'].includes(result.status)) pending.delete(req.userId);
    return res.json({ status: result.status, interval: flow.interval, message: result.message });
  }

  pending.delete(req.userId);
  const authUrl = orgAuth.buildSfdxAuthUrl(result.tokens);
  const org = await orgAuth.loginWithSfdxUrl({ authUrl, alias: flow.alias });
  await orgAuth.registerOrg({ username: org.username, label: flow.label, environment: flow.environment });
  logger.logOperation('Org authorised (device flow)', { username: org.username, by: req.user?.username });
  res.json({ status: 'complete', org });
}));

/** Cancel a pending device-flow sign-in. */
router.delete('/device', (req, res) => {
  pending.delete(req.userId);
  res.json({ success: true });
});

/** Authorise with an SFDX auth URL (`sf org display --verbose`). */
router.post('/sfdx-url', asyncHandler(async (req, res) => {
  const opts = orgOptions(req.body);
  const org = await orgAuth.loginWithSfdxUrl({ authUrl: req.body?.authUrl, alias: opts.alias });
  await orgAuth.registerOrg({ username: org.username, ...opts });
  logger.logOperation('Org authorised (SFDX auth URL)', { username: org.username, by: req.user?.username });
  res.json({ success: true, org });
}));

/** Authorise with the JWT bearer flow (connected app + certificate). */
router.post('/jwt', asyncHandler(async (req, res) => {
  const opts = orgOptions(req.body);
  const { clientId, username, privateKey, loginUrl } = req.body || {};
  const org = await orgAuth.loginWithJwt({ clientId, username, privateKey, loginUrl, alias: opts.alias });
  await orgAuth.registerOrg({ username: org.username, ...opts });
  logger.logOperation('Org authorised (JWT)', { username: org.username, by: req.user?.username });
  res.json({ success: true, org });
}));

module.exports = router;
