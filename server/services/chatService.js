const { DataTypes } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { runAnthropicStream } = require('./aiAdapters/anthropicAdapter');
const { runOpenAIStream, SUPPORTED_ADAPTERS: OPENAI_COMPATIBLE_ADAPTERS } = require('./aiAdapters/openaiAdapter');
const { TOOL_DEFINITIONS, executeTool: executeReadTool } = require('./vlocityAgentTools');
const aiWriteActions = require('./aiWriteActions');
const { estimateCost } = require('../config/aiPricing');

function audit(entry) {
  try {
    const getAuditService = require('./auditService');
    getAuditService().log(entry).catch(() => {});
  } catch {
    /* audit is best effort */
  }
}

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
let ensureChatTablesPromise = null;

function getDialect(db) {
  return db.getDialect();
}

function getTableRef(db, tableName) {
  return getDialect(db) === 'postgres' ? `"${schema}"."${tableName}"` : `"${tableName}"`;
}

function getTableDefinition(db, tableName) {
  return getDialect(db) === 'postgres'
    ? { tableName, schema }
    : { tableName };
}

function getIdType(db) {
  return getDialect(db) === 'postgres' ? DataTypes.UUID : DataTypes.STRING;
}

function getJsonType(db) {
  return getDialect(db) === 'postgres' ? DataTypes.JSONB : DataTypes.JSON;
}

function getTimestampDefault(db) {
  return db.literal(getDialect(db) === 'postgres' ? 'NOW()' : 'CURRENT_TIMESTAMP');
}

function serializeJsonField(db, value) {
  if (value == null) {
    return null;
  }

  // Always pass JSON as a string: raw bulkInsert cannot escape arrays/objects
  // ("Invalid value" on PostgreSQL); PostgreSQL casts the text to jsonb.
  return JSON.stringify(value);
}

function parseJsonField(value) {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeMessageRow(row) {
  return {
    ...row,
    tool_calls: parseJsonField(row.tool_calls),
    tool_results: parseJsonField(row.tool_results),
  };
}

async function ensureChatTables() {
  const db = getDb();
  if (!db) {
    throw new Error('Database connection is not ready');
  }

  if (!ensureChatTablesPromise) {
    ensureChatTablesPromise = (async () => {
      const queryInterface = db.getQueryInterface();
      const conversationsTable = getTableDefinition(db, 'chat_conversations');
      const messagesTable = getTableDefinition(db, 'chat_messages');
      const idType = getIdType(db);
      const jsonType = getJsonType(db);
      const timestampDefault = getTimestampDefault(db);

      const ensureTable = async (table, createDefinition) => {
        try {
          await queryInterface.describeTable(table);
        } catch {
          await queryInterface.createTable(table, createDefinition);
        }
      };

      await ensureTable(conversationsTable, {
        id: {
          type: idType,
          allowNull: false,
          primaryKey: true,
        },
        user_id: {
          type: idType,
          allowNull: false,
        },
        title: {
          type: DataTypes.STRING,
          allowNull: false,
          defaultValue: 'New conversation',
        },
        org_username: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        adapter: {
          type: DataTypes.STRING,
          allowNull: true,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: timestampDefault,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: timestampDefault,
        },
      });

      await ensureTable(messagesTable, {
        id: {
          type: idType,
          allowNull: false,
          primaryKey: true,
        },
        conversation_id: {
          type: idType,
          allowNull: false,
          references: {
            model: conversationsTable,
            key: 'id',
          },
          onDelete: 'CASCADE',
        },
        role: {
          type: DataTypes.STRING,
          allowNull: false,
        },
        content: {
          type: DataTypes.TEXT,
          allowNull: false,
          defaultValue: '',
        },
        tool_calls: {
          type: jsonType,
          allowNull: true,
        },
        tool_results: {
          type: jsonType,
          allowNull: true,
        },
        tokens_used: {
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: timestampDefault,
        },
      });

      try {
        const conversationDescription = await queryInterface.describeTable(conversationsTable);
        const userIdType = String(conversationDescription.user_id?.type || '').toLowerCase();
        if (userIdType.includes('int')) {
          await queryInterface.changeColumn(conversationsTable, 'user_id', {
            type: idType,
            allowNull: false,
          });
        }
      } catch (error) {
        logger.warn('Unable to reconcile chat_conversations.user_id type', { error: error.message });
      }

      const safeAddIndex = async (table, fields, options) => {
        try {
          await queryInterface.addIndex(table, fields, options);
        } catch (error) {
          const message = error.message || '';
          if (!message.includes('already exists') && !message.includes('duplicate')) {
            throw error;
          }
        }
      };

      await safeAddIndex(conversationsTable, ['user_id'], {
        name: 'idx_chat_conversations_user_id',
      });

      await safeAddIndex(messagesTable, ['conversation_id'], {
        name: 'idx_chat_messages_conversation_id',
      });
    })().catch((error) => {
      ensureChatTablesPromise = null;
      throw error;
    });
  }

  return ensureChatTablesPromise;
}

async function createConversation({ userId, orgUsername, adapter, title }) {
  const db = getDb();
  await ensureChatTables();
  const queryInterface = db.getQueryInterface();
  const id = uuidv4();
  const now = new Date();
  await queryInterface.bulkInsert(getTableDefinition(db, 'chat_conversations'), [{
    id,
    user_id: userId,
    title: title || 'New conversation',
    org_username: orgUsername || null,
    adapter: adapter || null,
    created_at: now,
    updated_at: now,
  }]);
  const [rows] = await db.query(
    `SELECT * FROM ${getTableRef(db, 'chat_conversations')} WHERE id = :id`,
    { replacements: { id } }
  );
  return rows[0];
}

async function listConversations(userId) {
  const db = getDb();
  await ensureChatTables();
  const [rows] = await db.query(
    `SELECT * FROM ${getTableRef(db, 'chat_conversations')} WHERE user_id = :userId ORDER BY updated_at DESC`,
    { replacements: { userId } }
  );
  return rows;
}

async function getConversationWithMessages(id, userId) {
  const db = getDb();
  await ensureChatTables();
  const [convRows] = await db.query(
    `SELECT * FROM ${getTableRef(db, 'chat_conversations')} WHERE id = :id AND user_id = :userId`,
    { replacements: { id, userId } }
  );
  if (!convRows[0]) return null;

  const [msgRows] = await db.query(
    `SELECT * FROM ${getTableRef(db, 'chat_messages')} WHERE conversation_id = :id ORDER BY created_at ASC`,
    { replacements: { id } }
  );
  let actions = [];
  try {
    actions = await aiWriteActions.listActionsForConversation(id);
  } catch {
    actions = [];
  }
  return { ...convRows[0], messages: msgRows.map(normalizeMessageRow), actions };
}

async function deleteConversation(id, userId) {
  const db = getDb();
  await ensureChatTables();
  return db.getQueryInterface().bulkDelete(
    getTableDefinition(db, 'chat_conversations'),
    { id, user_id: userId }
  );
}

async function updateConversationTitle(id, userId, title) {
  const db = getDb();
  await ensureChatTables();
  await db.getQueryInterface().bulkUpdate(
    getTableDefinition(db, 'chat_conversations'),
    { title, updated_at: new Date() },
    { id, user_id: userId }
  );
}

async function saveMessage({ conversationId, role, content, toolCalls, toolResults, tokensUsed, usage }) {
  const db = getDb();
  await ensureChatTables();
  const id = uuidv4();
  await db.getQueryInterface().bulkInsert(getTableDefinition(db, 'chat_messages'), [{
    id,
    conversation_id: conversationId,
    role,
    content,
    tool_calls: serializeJsonField(db, toolCalls),
    tool_results: serializeJsonField(db, toolResults),
    tokens_used: tokensUsed || null,
    input_tokens: usage?.inputTokens ?? null,
    output_tokens: usage?.outputTokens ?? null,
    model: usage?.model || null,
    adapter: usage?.adapter || null,
    cost_usd: usage?.costUsd ?? null,
    created_at: new Date(),
  }]);
  return id;
}

async function touchConversation(id) {
  const db = getDb();
  await ensureChatTables();
  await db.getQueryInterface().bulkUpdate(
    getTableDefinition(db, 'chat_conversations'),
    { updated_at: new Date() },
    { id }
  );
}

// ── SSE helpers ───────────────────────────────────────────────────────────────

function sseWrite(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ── Main streaming function ───────────────────────────────────────────────────

async function streamMessage({ res, conversationId, userMessage, userId, user, adapter, adapterConfig, orgUsername }) {
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
      const [rows] = await db.query(`SELECT username, environment, label FROM ${getTableRef(db, 'orgs')} LIMIT 20`);
      orgList = rows;
    } catch {}

    const systemPrompt = buildSystemPrompt(orgToUse, orgList);

    // Callbacks for SSE events
    const onToken = text => sseWrite(res, { type: 'token', content: text });
    const onToolStart = (name, args) => sseWrite(res, { type: 'tool_start', tool: name, args });
    const onToolEnd = (name, result) => sseWrite(res, { type: 'tool_end', tool: name, result: String(result).slice(0, 500) });

    let result;
    const adapterType = adapter || conv.adapter || 'anthropic';
    const auditBase = { userId, username: user?.username, resourceType: 'chat_conversation', resourceId: conversationId };

    // Developers/admins also get the write tool (proposals need confirmation)
    const allowWrites = aiWriteActions.canWrite(user);
    const tools = allowWrites ? [...TOOL_DEFINITIONS, aiWriteActions.TOOL_DEFINITION] : TOOL_DEFINITIONS;

    const executeTool = async (name, input, org) => {
      const targetOrg = input?.org_username || org;
      if (name === aiWriteActions.TOOL_NAME) {
        if (!allowWrites) return 'Error: you are not allowed to propose data changes.';
        try {
          const proposal = aiWriteActions.validateProposal(input);
          if (!targetOrg) return 'Error: no Salesforce org is selected.';
          const current = await aiWriteActions.readCurrentValues({ ...proposal, orgUsername: targetOrg });
          const action = await aiWriteActions.createPendingAction({
            conversationId, userId, orgUsername: targetOrg, proposal, before: current.before, recordName: current.name,
          });
          sseWrite(res, { type: 'confirmation_required', action });
          audit({ ...auditBase, action: 'ai_write_proposed', metadata: { actionId: action.id, sobject: proposal.sobject, recordId: proposal.recordId, fields: Object.keys(proposal.fields), org: targetOrg } });
          return `Proposed change ${action.id} is waiting for the user's approval in the chat. Nothing has been changed yet. `
            + 'Tell the user to review and approve or reject it.';
        } catch (error) {
          return `Error: ${error.message}`;
        }
      }
      const output = await executeReadTool(name, input, targetOrg);
      audit({ ...auditBase, action: 'ai_tool_call', metadata: { tool: name, org: targetOrg, input: JSON.stringify(input || {}).slice(0, 1000), error: /^Error/.test(String(output)) } });
      return output;
    };

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
        tools,
        executeTool,
      });
    } else if (OPENAI_COMPATIBLE_ADAPTERS.includes(adapterType)) {
      result = await runOpenAIStream({
        adapterType,
        messages: history,
        systemPrompt,
        apiKey: adapterConfig?.apiKey,
        model: adapterConfig?.model,
        baseURL: adapterConfig?.baseURL,
        userId,
        orgUsername: orgToUse,
        onToken,
        onToolStart,
        onToolEnd,
        tools,
        executeTool,
      });
    } else {
      sseWrite(res, { type: 'error', message: `Unknown adapter: ${adapterType}` });
      return;
    }

    const { costUsd } = estimateCost({
      adapter: adapterType, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
    });
    const usage = {
      inputTokens: result.inputTokens || 0,
      outputTokens: result.outputTokens || 0,
      model: result.model || null,
      adapter: adapterType,
      costUsd,
    };

    // Save assistant response
    const msgId = await saveMessage({
      conversationId,
      role: 'assistant',
      content: result.content,
      toolCalls: result.toolCalls.length ? result.toolCalls.map(tc => ({ name: tc.name, input: tc.input })) : null,
      toolResults: result.toolCalls.length ? result.toolCalls.map(tc => ({ name: tc.name, result: tc.result })) : null,
      tokensUsed: result.tokensUsed,
      usage,
    });

    await touchConversation(conversationId);

    // Auto-title on first exchange
    if (conv.messages.length === 0 && conv.title === 'New conversation') {
      const title = userMessage.slice(0, 60) + (userMessage.length > 60 ? '…' : '');
      await updateConversationTitle(conversationId, userId, title);
    }

    audit({
      ...auditBase,
      action: 'ai_chat_message',
      metadata: { adapter: adapterType, model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd, tools: result.toolCalls.map(tc => tc.name), org: orgToUse },
    });

    sseWrite(res, { type: 'done', messageId: msgId, tokensUsed: result.tokensUsed, usage });
  } catch (err) {
    logger.logError(err, { operation: 'streamMessage', conversationId });
    audit({ userId, username: user?.username, resourceType: 'chat_conversation', resourceId: conversationId, action: 'ai_chat_error', status: 'failure', errorMessage: err.message, severity: 'warning' });
    sseWrite(res, { type: 'error', message: err.message });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}

/**
 * Token usage and estimated cost.
 * @param {{userId?: string, days?: number}} opts – omit userId for everyone (admin)
 */
async function getUsage({ userId, days = 30 } = {}) {
  const db = getDb();
  await ensureChatTables();
  const since = new Date(Date.now() - Math.max(1, Math.min(days, 366)) * 86400000);
  const msgs = getTableRef(db, 'chat_messages');
  const convs = getTableRef(db, 'chat_conversations');
  const rows = await db.query(
    `SELECT c.user_id AS user_id, m.adapter AS adapter, m.model AS model,
            COUNT(*) AS messages,
            COALESCE(SUM(m.input_tokens), 0) AS input_tokens,
            COALESCE(SUM(m.output_tokens), 0) AS output_tokens,
            SUM(m.cost_usd) AS cost_usd,
            SUM(CASE WHEN m.cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced
       FROM ${msgs} m JOIN ${convs} c ON c.id = m.conversation_id
      WHERE m.role = 'assistant' AND m.model IS NOT NULL AND m.created_at >= :since ${userId ? 'AND c.user_id = :userId' : ''}
      GROUP BY c.user_id, m.adapter, m.model
      ORDER BY c.user_id`,
    { replacements: { since, userId: userId ? String(userId) : null }, type: require('sequelize').QueryTypes.SELECT }
  );
  const byModel = rows.map(r => ({
    userId: r.user_id,
    adapter: r.adapter || 'unknown',
    model: r.model || 'unknown',
    messages: Number(r.messages) || 0,
    inputTokens: Number(r.input_tokens) || 0,
    outputTokens: Number(r.output_tokens) || 0,
    costUsd: r.cost_usd === null || r.cost_usd === undefined ? null : Math.round(Number(r.cost_usd) * 1e6) / 1e6,
    unpricedMessages: Number(r.unpriced) || 0,
  }));
  const totals = byModel.reduce((t, r) => ({
    messages: t.messages + r.messages,
    inputTokens: t.inputTokens + r.inputTokens,
    outputTokens: t.outputTokens + r.outputTokens,
    costUsd: Math.round((t.costUsd + (r.costUsd || 0)) * 1e6) / 1e6,
    unpricedMessages: t.unpricedMessages + r.unpricedMessages,
  }), { messages: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, unpricedMessages: 0 });
  return { since: since.toISOString(), days, totals, byModel };
}

/** Approve or reject an AI-proposed change and record it in the conversation. */
async function decideAction({ actionId, user, approve }) {
  const action = await aiWriteActions.decide({ actionId, user, approve });
  const verb = { applied: 'Applied', rejected: 'Rejected', failed: 'Failed to apply' }[action.status] || action.status;
  const detail = action.status === 'failed' && action.result?.error ? ` – ${action.result.error}` : '';
  await saveMessage({ conversationId: action.conversationId, role: 'assistant', content: `${verb}: ${action.summary}${detail}` });
  await touchConversation(action.conversationId);
  audit({
    userId: user.userId,
    username: user.username,
    resourceType: 'ai_pending_action',
    resourceId: action.id,
    action: approve ? 'ai_write_approved' : 'ai_write_rejected',
    status: action.status === 'failed' ? 'failure' : 'success',
    errorMessage: action.result?.error,
    metadata: { status: action.status, org: action.orgUsername, sobject: action.args?.sobject, recordId: action.args?.recordId, fields: action.args?.fields },
    severity: approve ? 'warning' : 'info',
  });
  return action;
}

module.exports = {
  getUsage,
  decideAction,
  createConversation,
  listConversations,
  getConversationWithMessages,
  deleteConversation,
  updateConversationTitle,
  streamMessage,
};
