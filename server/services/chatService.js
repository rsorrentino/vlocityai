const { DataTypes } = require('sequelize');
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
let ensureChatTablesPromise = null;

function getDialect(db) {
  return db.getDialect();
}

function getTableRef(db, tableName) {
  return getDialect(db) === 'postgres' ? `${schema}.${tableName}` : tableName;
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

  return getDialect(db) === 'postgres' ? value : JSON.stringify(value);
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
  return { ...convRows[0], messages: msgRows.map(normalizeMessageRow) };
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

async function saveMessage({ conversationId, role, content, toolCalls, toolResults, tokensUsed }) {
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
