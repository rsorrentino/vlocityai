/**
 * Write actions proposed by the AI assistant – always confirmed by a person.
 *
 * The assistant may call `propose_record_update` to suggest changing fields on
 * one Salesforce record. Nothing is written: the proposal is stored in
 * ai_pending_actions, shown in the chat with current vs. proposed values, and
 * only applied when a user with write permission approves it.
 *
 * Safety rails:
 *  - only developers/admins get the tool, and only they can approve
 *  - objects must be in AI_WRITE_ALLOWED_OBJECTS (catalog/pricing objects by
 *    default); security objects are never allowed
 *  - record ids, object and field names are validated; values must be scalars
 *  - the update is a REST PATCH with the Salesforce CLI's access token (no
 *    shell, no SOQL string building)
 *  - every proposal, decision and result is written to the audit log
 */
const { v4: uuidv4 } = require('uuid');
const { QueryTypes } = require('sequelize');
const { ValidationError, ForbiddenError, NotFoundError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const TOOL_NAME = 'propose_record_update';

const DEFAULT_ALLOWED_OBJECTS = [
  'Product2',
  'vlocity_cmt__Catalog__c',
  'vlocity_cmt__CatalogProductRelationship__c',
  'vlocity_cmt__PriceList__c',
  'vlocity_cmt__PriceListEntry__c',
  'vlocity_cmt__PricingElement__c',
  'vlocity_cmt__PricingVariable__c',
  'vlocity_cmt__Promotion__c',
  'vlocity_cmt__PromotionItem__c',
  'vlocity_cmt__AttributeAssignment__c',
  'GT_ProductSKU__c',
  'GT_RateCode__c',
  'GT_RateTable__c',
];

// Never writable by the assistant, whatever the configuration says
const DENIED_OBJECTS = new Set([
  'User', 'Profile', 'PermissionSet', 'PermissionSetAssignment', 'PermissionSetGroup', 'Group', 'GroupMember',
  'UserRole', 'Organization', 'ConnectedApplication', 'AuthProvider', 'NamedCredential', 'SetupAuditTrail',
  'LoginIp', 'CustomPermission', 'ApexClass', 'ApexTrigger', 'ApexPage', 'StaticResource',
]);
const DENIED_FIELDS = new Set(['Id', 'OwnerId', 'CreatedById', 'CreatedDate', 'LastModifiedById', 'LastModifiedDate', 'SystemModstamp', 'IsDeleted']);

const SF_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;
const API_NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const MAX_FIELDS = 20;

const TOOL_DEFINITION = {
  name: TOOL_NAME,
  description:
    'Propose changing field values on ONE Salesforce record. Nothing is changed until the user reviews and approves '
    + 'the proposal in the chat. Use only when the user explicitly asks to change data. Look up the record first '
    + '(e.g. with run_soql) so you know its Id and current values. After calling this tool, tell the user the change '
    + 'is waiting for their approval.',
  input_schema: {
    type: 'object',
    properties: {
      sobject: { type: 'string', description: 'API name of the object, e.g. Product2' },
      record_id: { type: 'string', description: '15 or 18 character Salesforce record Id' },
      fields: {
        type: 'object',
        description: 'Field API names and their new values (strings, numbers, booleans or null)',
        additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
      },
      reason: { type: 'string', description: 'One sentence explaining why, shown to the user' },
      org_username: { type: 'string', description: 'Salesforce org username (optional, defaults to selected org)' },
    },
    required: ['sobject', 'record_id', 'fields', 'reason'],
  },
};

function enabled() {
  return process.env.AI_WRITE_ACTIONS !== 'false';
}

function allowedObjects() {
  const configured = process.env.AI_WRITE_ALLOWED_OBJECTS;
  const list = configured ? configured.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_ALLOWED_OBJECTS;
  return new Set(list.filter((o) => !DENIED_OBJECTS.has(o)));
}

/** Developers and admins may receive and approve write proposals. */
function canWrite(user) {
  if (!user || !enabled()) return false;
  if (user.role === 'admin') return true;
  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  const configs = perms.find((p) => p.resource === 'configs');
  return Boolean(configs && configs.actions.includes('write'));
}

/**
 * Validate and normalise a proposal from the model.
 * @returns {{sobject:string, recordId:string, fields:object, reason:string, orgUsername?:string}}
 */
function validateProposal(args = {}) {
  const sobject = String(args.sobject || '').trim();
  const recordId = String(args.record_id || '').trim();
  const reason = String(args.reason || '').trim().slice(0, 500);
  if (!API_NAME.test(sobject)) throw new ValidationError(`Invalid object name: ${sobject}`);
  if (DENIED_OBJECTS.has(sobject) || !allowedObjects().has(sobject)) {
    throw new ValidationError(`The assistant is not allowed to change ${sobject} records`);
  }
  if (!SF_ID.test(recordId)) throw new ValidationError(`Invalid record Id: ${recordId}`);
  const fields = args.fields && typeof args.fields === 'object' && !Array.isArray(args.fields) ? args.fields : null;
  if (!fields || Object.keys(fields).length === 0) throw new ValidationError('No fields to change');
  if (Object.keys(fields).length > MAX_FIELDS) throw new ValidationError(`At most ${MAX_FIELDS} fields per change`);
  const clean = {};
  for (const [name, value] of Object.entries(fields)) {
    if (!API_NAME.test(name) || DENIED_FIELDS.has(name)) throw new ValidationError(`Field ${name} cannot be changed`);
    const ok = value === null || ['string', 'number', 'boolean'].includes(typeof value);
    if (!ok) throw new ValidationError(`Field ${name} must be a text, number, boolean or null value`);
    if (typeof value === 'string' && value.length > 32000) throw new ValidationError(`Field ${name} is too long`);
    if (typeof value === 'number' && !Number.isFinite(value)) throw new ValidationError(`Field ${name} is not a valid number`);
    clean[name] = value;
  }
  return { sobject, recordId, fields: clean, reason, orgUsername: args.org_username || undefined };
}

// ── Salesforce REST (token from the Salesforce CLI) ──────────────────────────

function apiVersion() {
  const v = process.env.SF_API_VERSION || '62.0';
  return /^\d{2,3}\.\d$/.test(v) ? v : '62.0';
}

async function sfRequest(orgUsername, method, pathname, body, { fetchImpl, auth } = {}) {
  const { accessToken, instanceUrl } = auth || await require('./sfdxAuthService').getAccessToken(orgUsername);
  const doFetch = fetchImpl || globalThis.fetch;
  const res = await doFetch(`${instanceUrl}/services/data/v${apiVersion()}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const message = Array.isArray(data) ? data.map((e) => e.message).join('; ') : (data?.message || text || `HTTP ${res.status}`);
    const error = new Error(`Salesforce rejected the change: ${message}`);
    error.statusCode = res.status >= 500 ? 502 : 400;
    throw error;
  }
  return data;
}

/** Current values of the fields being changed (best effort, for the review card). */
async function readCurrentValues({ orgUsername, sobject, recordId, fields }, opts) {
  try {
    const names = Object.keys(fields).join(',');
    const record = await sfRequest(orgUsername, 'GET', `/sobjects/${sobject}/${recordId}?fields=${encodeURIComponent(names)}`, null, opts);
    const before = {};
    for (const name of Object.keys(fields)) before[name] = record?.[name] ?? null;
    return { before, name: record?.Name || null };
  } catch (error) {
    logger.warn('Could not read current values for AI proposal', { sobject, recordId, error: error.message });
    return { before: null, name: null };
  }
}

async function applyUpdate({ orgUsername, sobject, recordId, fields }, opts) {
  await sfRequest(orgUsername, 'PATCH', `/sobjects/${sobject}/${recordId}`, fields, opts);
  return { updated: true };
}

// ── Pending action storage (PostgreSQL and SQLite) ───────────────────────────

function db() {
  const { sequelize } = require('./databaseService');
  if (!sequelize) throw new Error('Database connection is not ready');
  return sequelize;
}

function table(sequelize) {
  return require('../db/migrationHelpers').quotedTable(sequelize.getQueryInterface(), 'ai_pending_actions');
}

function parseRow(row) {
  if (!row) return null;
  const parse = (v) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v);
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    orgUsername: row.org_username,
    tool: row.tool,
    args: parse(row.args),
    summary: row.summary,
    status: row.status,
    result: parse(row.result),
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

async function createPendingAction({ conversationId, userId, orgUsername, proposal, before, recordName }) {
  const sequelize = db();
  const id = uuidv4();
  const now = new Date();
  const fieldList = Object.keys(proposal.fields).join(', ');
  const summary = `Update ${proposal.sobject} ${recordName ? `"${recordName}" ` : ''}(${proposal.recordId}): ${fieldList}`;
  await sequelize.query(
    `INSERT INTO ${table(sequelize)} (id, conversation_id, user_id, org_username, tool, args, summary, status, created_at, updated_at)
     VALUES (:id, :conversationId, :userId, :orgUsername, :tool, :args, :summary, 'pending', :now, :now)`,
    {
      replacements: {
        id, conversationId, userId: String(userId), orgUsername: orgUsername || null, tool: TOOL_NAME,
        args: JSON.stringify({ ...proposal, before, recordName }), summary, now,
      },
    }
  );
  return getAction(id);
}

async function getAction(id) {
  const sequelize = db();
  const rows = await sequelize.query(`SELECT * FROM ${table(sequelize)} WHERE id = :id`, {
    replacements: { id }, type: QueryTypes.SELECT,
  });
  return parseRow(rows[0]);
}

async function listActionsForConversation(conversationId) {
  const sequelize = db();
  const rows = await sequelize.query(
    `SELECT * FROM ${table(sequelize)} WHERE conversation_id = :conversationId ORDER BY created_at ASC`,
    { replacements: { conversationId }, type: QueryTypes.SELECT }
  );
  return rows.map(parseRow);
}

async function setActionStatus(id, { status, result, decidedBy }) {
  const sequelize = db();
  const now = new Date();
  await sequelize.query(
    `UPDATE ${table(sequelize)} SET status = :status, result = :result, decided_by = :decidedBy, decided_at = :now, updated_at = :now WHERE id = :id`,
    { replacements: { id, status, result: result ? JSON.stringify(result) : null, decidedBy: decidedBy || null, now } }
  );
  return getAction(id);
}

/**
 * Approve or reject a pending action. Only the user who asked for it, with
 * write permission, can decide; an action is decided exactly once.
 */
async function decide({ actionId, user, approve, fetchImpl, auth }) {
  const action = await getAction(actionId);
  if (!action) throw new NotFoundError('Action not found');
  if (String(action.userId) !== String(user.userId)) throw new ForbiddenError('This change was proposed in another user’s conversation');
  if (action.status !== 'pending') throw new ValidationError(`This change was already ${action.status}`);
  if (!approve) {
    return setActionStatus(actionId, { status: 'rejected', decidedBy: user.username });
  }
  if (!canWrite(user)) throw new ForbiddenError('You do not have permission to change Salesforce data');

  // Re-validate: configuration may have changed since the proposal
  const proposal = validateProposal({ ...action.args, record_id: action.args.recordId });
  // Claim the action first so a double click cannot apply it twice
  const claimed = await claim(actionId);
  if (!claimed) throw new ValidationError('This change is already being applied');
  try {
    await applyUpdate({ orgUsername: action.orgUsername, sobject: proposal.sobject, recordId: proposal.recordId, fields: proposal.fields }, { fetchImpl, auth });
    return setActionStatus(actionId, { status: 'applied', result: { updated: true }, decidedBy: user.username });
  } catch (error) {
    return setActionStatus(actionId, { status: 'failed', result: { error: error.message }, decidedBy: user.username });
  }
}

async function claim(id) {
  const sequelize = db();
  const [, meta] = await sequelize.query(
    `UPDATE ${table(sequelize)} SET status = 'applying', updated_at = :now WHERE id = :id AND status = 'pending'`,
    { replacements: { id, now: new Date() } }
  );
  // rowCount (pg) / changes (sqlite)
  const affected = typeof meta === 'number' ? meta : (meta?.rowCount ?? meta?.changes ?? 1);
  return affected > 0;
}

module.exports = {
  TOOL_NAME,
  TOOL_DEFINITION,
  DEFAULT_ALLOWED_OBJECTS,
  enabled,
  canWrite,
  validateProposal,
  readCurrentValues,
  applyUpdate,
  createPendingAction,
  getAction,
  listActionsForConversation,
  decide,
};
