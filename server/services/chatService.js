const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { runAnthropicStream } = require('./aiAdapters/anthropicAdapter');
const { runOpenAIStream } = require('./aiAdapters/openaiAdapter');

// Lazy-load DB to avoid circular imports at startup
function getDb() {
  const { sequelize } = require('./databaseService');
  return sequelize;
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(orgUsername, orgList) {
  const orgSection = orgList?.length
    ? `Connected Salesforce orgs:\n${orgList.map(o => `- ${o.username} (${o.environment || 'unknown env'}${o.label ? ', ' + o.label : ''})`).join('\n')}`
    : orgUsername
      ? `Current org: ${orgUsername}`
      : 'No org selected — ask the user to select one.';

  return `You are a Vlocity/Salesforce expert AI assistant integrated into the Vlocity DataPack Manager tool.

${orgSection}

You have access to tools that can query live Salesforce data. When a user asks about catalogs, products, pricing, promotions, or any Salesforce/Vlocity data, use the appropriate tool to get real data before answering.

Vlocity objects you can query:
- vlocity_cmt__Catalog__c — product catalogs
- Product2 — product master records
- vlocity_cmt__Promotion__c — promotions
- vlocity_cmt__PriceListEntry__c — pricing entries
- vlocity_cmt__PriceList__c — price lists
- vlocity_cmt__CatalogProductRelationship__c — catalog-to-product relationships
- vlocity_cmt__AttributeAssignment__c — product attributes
- GT_ProductSKU__c, GT_RateCode__c, GT_RateTable__c — custom objects

Guidelines:
- Always use tools for live data questions — never guess or make up data
- Format results clearly and concisely
- If a SOQL query fails because an object doesn't exist in the org, explain why and suggest alternatives
- You can run custom SOQL with run_soql for any query not covered by the named tools`;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

const schema = process.env.DB_SCHEMA || 'vlocity_datapack_manager';

async function createConversation({ userId, orgUsername, adapter, title }) {
  const db = getDb();
  const id = uuidv4();
  await db.query(
    `INSERT INTO ${schema}.chat_conversations (id, user_id, title, org_username, adapter)
     VALUES (:id, :userId, :title, :orgUsername, :adapter)`,
    { replacements: { id, userId, title: title || 'New conversation', orgUsername: orgUsername || null, adapter: adapter || null } }
  );
  const [rows] = await db.query(
    `SELECT * FROM ${schema}.chat_conversations WHERE id = :id`,
    { replacements: { id } }
  );
  return rows[0];
}

async function listConversations(userId) {
  const db = getDb();
  const [rows] = await db.query(
    `SELECT * FROM ${schema}.chat_conversations WHERE user_id = :userId ORDER BY updated_at DESC`,
    { replacements: { userId } }
  );
  return rows;
}

async function getConversationWithMessages(id, userId) {
  const db = getDb();
  const [convRows] = await db.query(
    `SELECT * FROM ${schema}.chat_conversations WHERE id = :id AND user_id = :userId`,
    { replacements: { id, userId } }
  );
  if (!convRows[0]) return null;

  const [msgRows] = await db.query(
    `SELECT * FROM ${schema}.chat_messages WHERE conversation_id = :id ORDER BY created_at ASC`,
    { replacements: { id } }
  );
  return { ...convRows[0], messages: msgRows };
}

async function deleteConversation(id, userId) {
  const db = getDb();
  const [result] = await db.query(
    `DELETE FROM ${schema}.chat_conversations WHERE id = :id AND user_id = :userId`,
    { replacements: { id, userId } }
  );
  return result;
}

async function updateConversationTitle(id, userId, title) {
  const db = getDb();
  await db.query(
    `UPDATE ${schema}.chat_conversations SET title = :title, updated_at = NOW() WHERE id = :id AND user_id = :userId`,
    { replacements: { id, userId, title } }
  );
}

async function saveMessage({ conversationId, role, content, toolCalls, toolResults, tokensUsed }) {
  const db = getDb();
  const id = uuidv4();
  await db.query(
    `INSERT INTO ${schema}.chat_messages (id, conversation_id, role, content, tool_calls, tool_results, tokens_used)
     VALUES (:id, :conversationId, :role, :content, :toolCalls::jsonb, :toolResults::jsonb, :tokensUsed)`,
    {
      replacements: {
        id,
        conversationId,
        role,
        content,
        toolCalls: toolCalls ? JSON.stringify(toolCalls) : null,
        toolResults: toolResults ? JSON.stringify(toolResults) : null,
        tokensUsed: tokensUsed || null,
      },
    }
  );
  return id;
}

async function touchConversation(id) {
  const db = getDb();
  await db.query(
    `UPDATE ${schema}.chat_conversations SET updated_at = NOW() WHERE id = :id`,
    { replacements: { id } }
  );
}

// ── SSE helpers ───────────────────────────────────────────────────────────────

function sseWrite(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ── Main streaming function ───────────────────────────────────────────────────

async function streamMessage({ res, conversationId, userMessage, userId, adapter, adapterConfig, orgUsername }) {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Keep SSE alive during long tool calls
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch {}
  }, 15000);

  try {
    // Load conversation + history
    const conv = await getConversationWithMessages(conversationId, userId);
    if (!conv) {
      sseWrite(res, { type: 'error', message: 'Conversation not found' });
      return;
    }

    const orgToUse = orgUsername || conv.org_username;

    // Save user message
    await saveMessage({ conversationId, role: 'user', content: userMessage });

    // Build message history for adapter (exclude tool metadata for AI context)
    const history = conv.messages.map(m => ({ role: m.role, content: m.content }));
    history.push({ role: 'user', content: userMessage });

    // Load org list for system prompt
    let orgList = [];
    try {
      const db = getDb();
      const [rows] = await db.query(`SELECT username, environment, label FROM ${schema}.orgs LIMIT 20`);
      orgList = rows;
    } catch {}

    const systemPrompt = buildSystemPrompt(orgToUse, orgList);

    // Callbacks for SSE events
    const onToken = text => sseWrite(res, { type: 'token', content: text });
    const onToolStart = (name, args) => sseWrite(res, { type: 'tool_start', tool: name, args });
    const onToolEnd = (name, result) => sseWrite(res, { type: 'tool_end', tool: name, result: result.slice(0, 500) });

    let result;
    const adapterType = adapter || conv.adapter || 'anthropic';

    if (adapterType === 'anthropic') {
      result = await runAnthropicStream({
        messages: history,
        systemPrompt,
        apiKey: adapterConfig?.apiKey,
        model: adapterConfig?.model,
        orgUsername: orgToUse,
        onToken,
        onToolStart,
        onToolEnd,
      });
    } else if (['openai', 'copilot', 'ollama'].includes(adapterType)) {
      result = await runOpenAIStream({
        adapterType,
        messages: history,
        systemPrompt,
        apiKey: adapterConfig?.apiKey,
        model: adapterConfig?.model,
        baseURL: adapterConfig?.baseURL,
        orgUsername: orgToUse,
        onToken,
        onToolStart,
        onToolEnd,
      });
    } else {
      sseWrite(res, { type: 'error', message: `Unknown adapter: ${adapterType}` });
      return;
    }

    // Save assistant response
    const msgId = await saveMessage({
      conversationId,
      role: 'assistant',
      content: result.content,
      toolCalls: result.toolCalls.length ? result.toolCalls.map(tc => ({ name: tc.name, input: tc.input })) : null,
      toolResults: result.toolCalls.length ? result.toolCalls.map(tc => ({ name: tc.name, result: tc.result })) : null,
      tokensUsed: result.tokensUsed,
    });

    await touchConversation(conversationId);

    // Auto-title on first exchange
    if (conv.messages.length === 0 && conv.title === 'New conversation') {
      const title = userMessage.slice(0, 60) + (userMessage.length > 60 ? '…' : '');
      await updateConversationTitle(conversationId, userId, title);
    }

    sseWrite(res, { type: 'done', messageId: msgId, tokensUsed: result.tokensUsed });
  } catch (err) {
    logger.logError(err, { operation: 'streamMessage', conversationId });
    sseWrite(res, { type: 'error', message: err.message });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}

module.exports = {
  createConversation,
  listConversations,
  getConversationWithMessages,
  deleteConversation,
  updateConversationTitle,
  streamMessage,
};
