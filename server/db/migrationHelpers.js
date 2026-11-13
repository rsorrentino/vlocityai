/**
 * Helpers shared by migrations. Every helper is idempotent so migrations can
 * run safely against databases that were created earlier by sequelize.sync()
 * (versions before MVP2 never recorded migrations).
 *
 * Table naming:
 *   PostgreSQL – tables live in DB_SCHEMA (default vlocity_datapack_manager)
 *   SQLite     – plain table names (no schema prefix)
 */
const SCHEMA = () => process.env.DB_SCHEMA || 'vlocity_datapack_manager';

function dialectOf(queryInterface) {
  return queryInterface.sequelize.getDialect();
}

/** Table identifier usable with every QueryInterface method. */
function tableFor(queryInterface, tableName) {
  return dialectOf(queryInterface) === 'postgres' ? { tableName, schema: SCHEMA() } : tableName;
}

/** Fully-qualified, quoted name for raw SQL. */
function quotedTable(queryInterface, tableName) {
  return dialectOf(queryInterface) === 'postgres' ? `"${SCHEMA()}"."${tableName}"` : `"${tableName}"`;
}

async function tableExists(queryInterface, tableName) {
  try {
    await queryInterface.describeTable(tableFor(queryInterface, tableName));
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the table if it does not exist; otherwise add any columns that are
 * missing (tables created by an older sync() may lack newer columns).
 * Existing columns are never altered or dropped.
 */
async function ensureTable(queryInterface, tableName, attributes, options = {}) {
  const table = tableFor(queryInterface, tableName);
  let existing = null;
  try {
    existing = await queryInterface.describeTable(table);
  } catch {
    existing = null;
  }
  if (!existing) {
    await queryInterface.createTable(table, attributes, options);
    return { created: true, addedColumns: [] };
  }
  const addedColumns = [];
  for (const [column, definition] of Object.entries(attributes)) {
    if (existing[column]) continue;
    // A NOT NULL column without default cannot be added to a populated table
    const def = { ...definition };
    if (def.allowNull === false && def.defaultValue === undefined && !def.primaryKey) def.allowNull = true;
    delete def.primaryKey;
    delete def.unique;
    await queryInterface.addColumn(table, column, def);
    addedColumns.push(column);
  }
  return { created: false, addedColumns };
}

async function ensureIndex(queryInterface, tableName, fields, options) {
  try {
    await queryInterface.addIndex(tableFor(queryInterface, tableName), fields, options);
  } catch (error) {
    if (!/already exists|duplicate/i.test(error.message)) throw error;
  }
}

async function dropTableIfExists(queryInterface, tableName) {
  if (await tableExists(queryInterface, tableName)) {
    await queryInterface.dropTable(tableFor(queryInterface, tableName));
  }
}

/** JSON column type: JSONB on PostgreSQL, JSON (text) on SQLite. */
function jsonType(queryInterface, Sequelize) {
  return dialectOf(queryInterface) === 'postgres' ? Sequelize.JSONB : Sequelize.JSON;
}

/** Current timestamp default for created_at/updated_at. */
function nowDefault(queryInterface) {
  return queryInterface.sequelize.literal('CURRENT_TIMESTAMP');
}

module.exports = {
  SCHEMA,
  dialectOf,
  tableFor,
  quotedTable,
  tableExists,
  ensureTable,
  ensureIndex,
  dropTableIfExists,
  jsonType,
  nowDefault,
};
