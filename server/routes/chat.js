const express = require('express');
const router = express.Router();
const chatService = require('../services/chatService');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

// All chat routes require authentication
router.use(authenticate);

// ── Conversations ─────────────────────────────────────────────────────────────

router.get('/conversations', asyncHandler(async (req, res) => {
  const conversations = await chatService.listConversations(req.userId);
  res.json({ conversations, timestamp: new Date().toISOString() });
}));

router.post('/conversations', asyncHandler(async (req, res) => {
  const { orgUsername, adapter, title } = req.body;
  const conversation = await chatService.createConversation({
    userId: req.userId,
    orgUsername,
    adapter,
    title,
  });
  res.status(201).json({ conversation, timestamp: new Date().toISOString() });
}));

router.get('/conversations/:id', asyncHandler(async (req, res) => {
  const conv = await chatService.getConversationWithMessages(req.params.id, req.userId);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  res.json({ conversation: conv, timestamp: new Date().toISOString() });
}));

router.patch('/conversations/:id/title', asyncHandler(async (req, res) => {
  const { title } = req.body;
  if (!title) throw new ValidationError('title is required');
  await chatService.updateConversationTitle(req.params.id, req.userId, title.slice(0, 255));
  res.json({ success: true, timestamp: new Date().toISOString() });
}));

router.delete('/conversations/:id', asyncHandler(async (req, res) => {
  await chatService.deleteConversation(req.params.id, req.userId);
  res.json({ success: true, timestamp: new Date().toISOString() });
}));

// ── AI adapters: GitHub Copilot sign-in & model discovery ────────────────────

const copilot = require('../services/aiAdapters/githubCopilot');
const credentialStore = require('../services/aiCredentialStore');
const { resolveCopilotGitHubToken, SUPPORTED_ADAPTERS } = require('../services/aiAdapters/openaiAdapter');

// Pending device-flow logins, keyed by app user id (device codes never leave the server)
const pendingDeviceFlows = new Map();

function sendCopilotError(res, err) {
  const status = err.name === 'CopilotAuthError' && err.status >= 400 && err.status < 500 ? 400 : 502;
  logger.warn('Copilot request failed', { message: err.message, status: err.status });
  res.status(status).json({ error: err.message });
}

router.get('/adapters', (req, res) => {
  res.json({
    adapters: ['anthropic', ...SUPPORTED_ADAPTERS],
    timestamp: new Date().toISOString(),
  });
});

/** Is Copilot usable for this user, and with which credential source? */
router.get('/copilot/status', asyncHandler(async (req, res) => {
  const { token, source, accountLogin } = await resolveCopilotGitHubToken({ userId: req.userId });
  if (!token) {
    return res.json({ connected: false, source: null });
  }
  try {
    const session = await copilot.getCopilotSession(token);
    res.json({ connected: true, source, accountLogin: accountLogin || null, apiBase: session.apiBase });
  } catch (err) {
    res.json({ connected: false, source, accountLogin: accountLogin || null, error: err.message });
  }
}));

/** Start "Sign in with GitHub" (OAuth device flow). */
router.post('/copilot/device/start', asyncHandler(async (req, res) => {
  try {
    const flow = await copilot.startDeviceFlow();
    pendingDeviceFlows.set(req.userId, {
      deviceCode: flow.deviceCode,
      interval: flow.interval,
      expiresAt: Date.now() + flow.expiresIn * 1000,
    });
    res.json({
      userCode: flow.userCode,
      verificationUri: flow.verificationUri,
      expiresIn: flow.expiresIn,
      interval: flow.interval,
    });
  } catch (err) {
    sendCopilotError(res, err);
  }
}));

/** Poll the device flow once; the client calls this every `interval` seconds. */
router.post('/copilot/device/poll', asyncHandler(async (req, res) => {
  const pending = pendingDeviceFlows.get(req.userId);
  if (!pending || pending.expiresAt < Date.now()) {
    pendingDeviceFlows.delete(req.userId);
    return res.json({ status: 'expired', message: 'No sign-in in progress or the code expired. Start again.' });
  }
  try {
    const result = await copilot.pollDeviceFlow(pending.deviceCode);
    if (result.status === 'slow_down' && result.interval) pending.interval = result.interval;
    if (result.status !== 'complete') {
      if (['expired', 'denied', 'error'].includes(result.status)) pendingDeviceFlows.delete(req.userId);
      return res.json({ status: result.status, interval: pending.interval, message: result.message });
    }

    pendingDeviceFlows.delete(req.userId);
    // Verify the account actually has Copilot before storing the token
    await copilot.getCopilotSession(result.accessToken, { force: true });
    const user = await copilot.getGitHubUser(result.accessToken).catch(() => null);
    await credentialStore.saveCredential(req.userId, 'copilot', result.accessToken, user?.login || null);
    res.json({ status: 'complete', accountLogin: user?.login || null });
  } catch (err) {
    pendingDeviceFlows.delete(req.userId);
    sendCopilotError(res, err);
  }
}));

/** Disconnect Copilot for this user. */
router.delete('/copilot', asyncHandler(async (req, res) => {
  pendingDeviceFlows.delete(req.userId);
  await credentialStore.deleteCredential(req.userId, 'copilot');
  res.json({ success: true });
}));

/** Models available to the signed-in Copilot account. */
router.get('/copilot/models', asyncHandler(async (req, res) => {
  const { token } = await resolveCopilotGitHubToken({ userId: req.userId });
  if (!token) return res.status(400).json({ error: 'GitHub Copilot is not connected' });
  try {
    const models = await copilot.listCopilotModels(token);
    res.json({ models });
  } catch (err) {
    sendCopilotError(res, err);
  }
}));

// ── AI-proposed changes (need explicit confirmation) ──────────────────────────

router.post('/actions/:id/approve', asyncHandler(async (req, res) => {
  const action = await chatService.decideAction({ actionId: req.params.id, user: req.user, approve: true });
  res.json({ action });
}));

router.post('/actions/:id/reject', asyncHandler(async (req, res) => {
  const action = await chatService.decideAction({ actionId: req.params.id, user: req.user, approve: false });
  res.json({ action });
}));

// ── Usage & estimated cost ───────────────────────────────────────────────────

router.get('/usage', asyncHandler(async (req, res) => {
  const days = Math.max(1, Math.min(parseInt(req.query.days, 10) || 30, 366));
  const everyone = req.query.scope === 'all';
  if (everyone && req.user?.role !== 'admin') {
    const { ForbiddenError } = require('../middleware/errorHandler');
    throw new ForbiddenError('Only administrators can see everyone’s usage');
  }
  const usage = await chatService.getUsage({ userId: everyone ? undefined : req.userId, days });
  res.json({ ...usage, scope: everyone ? 'all' : 'me' });
}));

// ── Message (SSE streaming) ───────────────────────────────────────────────────

router.post('/message', async (req, res) => {
  const { conversationId, message, orgUsername, adapter, adapterConfig } = req.body;

  if (!conversationId) {
    return res.status(400).json({ error: 'conversationId is required' });
  }
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    await chatService.streamMessage({
      res,
      conversationId,
      userMessage: message.trim(),
      userId: req.userId,
      user: req.user,
      adapter,
      adapterConfig,
      orgUsername,
    });
  } catch (err) {
    logger.logError(err, { operation: 'POST /api/chat/message' });
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

module.exports = router;
