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
