const path = require('path');
const { Org } = require('../models');
const sfdxAuthService = require('./sfdxAuthService');
const PropertiesReader = require('../utils/propertiesReader');
const logger = require('../utils/logger');

function detectIsSandbox(username) {
  if (!username) return false;
  const l = username.toLowerCase();
  return l.includes('.sandbox') || l.includes('.sbx') || l.includes('sandbox');
}

function mapOrg(o) {
  return {
    id: o.id,
    username: o.username,
    // effective display name consumed by all dropdowns across the app
    alias: o.label || o.alias || o.username,
    label: o.label || null,
    environment: o.environment || null,
    isSandbox: o.isSandbox,
    isDevHub: o.isDevHub,
    notes: o.notes || null,
    lastTestedAt: o.lastTestedAt || null,
    lastTestResult: o.lastTestResult || 'unknown',
    lastTestMessage: o.lastTestMessage || null,
    instanceUrl: o.instanceUrl || null,
    orgId: o.orgId || null,
    connectedStatus: o.connectedStatus || null,
  };
}

/**
 * List all tracked orgs from the database.
 */
async function listOrgs() {
  const orgs = await Org.findAll({
    order: [
      ['label', 'ASC'],
      ['alias', 'ASC'],
      ['username', 'ASC'],
    ],
  });
  return orgs.map(mapOrg);
}

/**
 * Sync authenticated orgs from SF CLI into the DB.
 * Updates CLI-sourced fields (alias, instanceUrl, orgId, connectedStatus,
 * isSandbox, isDevHub) but preserves user's label, environment, notes.
 * Returns { added, updated, total }.
 */
async function syncFromCli() {
  const cliOrgs = await sfdxAuthService.listOrgs();
  let added = 0;
  let updated = 0;

  for (const cliOrg of cliOrgs) {
    const cliFields = {
      alias: cliOrg.alias || cliOrg.username,
      instanceUrl: cliOrg.instanceUrl || null,
      orgId: cliOrg.orgId || null,
      isSandbox: detectIsSandbox(cliOrg.username),
      isDevHub: cliOrg.isDevHub || false,
      connectedStatus: cliOrg.connectedStatus || null,
    };

    const [org, created] = await Org.findOrCreate({
      where: { username: cliOrg.username },
      defaults: cliFields,
    });

    if (created) {
      added++;
    } else {
      await org.update(cliFields);
      updated++;
    }
  }

  logger.info('Org sync from CLI complete', { added, updated, total: cliOrgs.length });
  return { added, updated, total: cliOrgs.length };
}

/**
 * Update user-managed fields for an org.
 */
async function updateOrg(username, { label, environment, notes }) {
  const [count] = await Org.update(
    { label: label || null, environment: environment || null, notes: notes || null },
    { where: { username } }
  );
  if (count === 0) throw new Error(`Org not found: ${username}`);
}

/**
 * Remove an org from DB tracking (does NOT revoke SF CLI auth).
 */
async function deleteOrg(username) {
  await Org.destroy({ where: { username } });
}

/**
 * Persist the result of a connection test for an org.
 * Also updates instanceUrl and orgId from the test response.
 */
async function recordTestResult(username, { success, message, orgInfo }) {
  const updates = {
    lastTestedAt: new Date(),
    lastTestResult: success ? 'success' : 'failure',
    lastTestMessage: message || null,
  };
  if (orgInfo) {
    if (orgInfo.instanceUrl) updates.instanceUrl = orgInfo.instanceUrl;
    if (orgInfo.orgId) updates.orgId = orgInfo.orgId;
    if (orgInfo.alias) updates.alias = orgInfo.alias;
  }
  // Upsert: if org doesn't exist in DB yet, create it (test-connection can run before sync)
  await Org.upsert({ username, ...updates });
}

/**
 * One-time import from environments.properties into the Org table.
 * Only runs when the table is empty (first startup after upgrade).
 */
async function migrateFromProperties(propertiesPath) {
  const count = await Org.count();
  if (count > 0) return; // already populated

  let properties;
  try {
    properties = new PropertiesReader(propertiesPath);
  } catch {
    logger.warn('environments.properties not found — skipping org migration');
    return;
  }

  const usernames = new Set();
  const keys = [
    'SFDX_USERNAME',
    'SOURCE_SFDX_USERNAME',
    'TARGET_SFDX_USERNAME',
  ];
  const envs = [null, 'dev', 'uat', 'prod'];

  for (const key of keys) {
    for (const env of envs) {
      const username = env
        ? properties.getWithEnv(key, env)
        : properties.get(key);
      if (username) usernames.add(username);
    }
  }

  for (const username of usernames) {
    await Org.findOrCreate({
      where: { username },
      defaults: {
        alias: username,
        isSandbox: detectIsSandbox(username),
      },
    });
  }

  logger.info('Org migration from properties complete', { count: usernames.size });
}

module.exports = {
  listOrgs,
  syncFromCli,
  updateOrg,
  deleteOrg,
  recordTestResult,
  migrateFromProperties,
};
