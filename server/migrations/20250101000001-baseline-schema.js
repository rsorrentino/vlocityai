'use strict';

/**
 * Baseline schema: every table the application used before migrations were
 * introduced (previously created by sequelize.sync() and by auditService).
 *
 * Safe on existing databases: missing tables are created, missing columns are
 * added, nothing is altered or dropped.
 */
const {
  ensureTable, ensureIndex, jsonType, nowDefault, dialectOf, quotedTable, tableExists,
} = require('../db/migrationHelpers');

module.exports = {
  async up(queryInterface, Sequelize) {
    const JSON_T = jsonType(queryInterface, Sequelize);
    const timestamps = {
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: nowDefault(queryInterface) },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: nowDefault(queryInterface) },
    };
    const uuidPk = { type: Sequelize.UUID, primaryKey: true, allowNull: false };

    await ensureTable(queryInterface, 'users', {
      id: uuidPk,
      username: { type: Sequelize.STRING, allowNull: false, unique: true },
      email: { type: Sequelize.STRING, allowNull: false, unique: true },
      password: { type: Sequelize.STRING, allowNull: false },
      role: { type: Sequelize.ENUM('admin', 'developer', 'functional'), allowNull: false, defaultValue: 'functional' },
      first_name: { type: Sequelize.STRING, allowNull: false },
      last_name: { type: Sequelize.STRING, allowNull: false },
      is_active: { type: Sequelize.BOOLEAN, defaultValue: true },
      last_login: { type: Sequelize.DATE },
      login_attempts: { type: Sequelize.INTEGER, defaultValue: 0 },
      lock_until: { type: Sequelize.DATE },
      preferences: { type: JSON_T },
      permissions: { type: JSON_T },
      ...timestamps,
    });

    await ensureTable(queryInterface, 'jobs', {
      id: uuidPk,
      name: { type: Sequelize.STRING, allowNull: false },
      type: { type: Sequelize.ENUM('export', 'deploy', 'snapshot', 'sfdmu'), allowNull: false },
      status: { type: Sequelize.ENUM('pending', 'running', 'completed', 'failed', 'cancelled', 'aborted'), defaultValue: 'pending' },
      progress: { type: Sequelize.INTEGER, defaultValue: 0 },
      configuration: { type: JSON_T, allowNull: false },
      result: { type: JSON_T },
      error: { type: Sequelize.TEXT },
      logs: { type: JSON_T },
      username: { type: Sequelize.STRING },
      file_path: { type: Sequelize.STRING },
      project_path: { type: Sequelize.STRING },
      source_username: { type: Sequelize.STRING },
      target_username: { type: Sequelize.STRING },
      environment: { type: Sequelize.STRING },
      cli_type: { type: Sequelize.ENUM('vlocity', 'sf'), allowNull: false, defaultValue: 'vlocity' },
      started_at: { type: Sequelize.DATE },
      completed_at: { type: Sequelize.DATE },
      duration: { type: Sequelize.INTEGER },
      user_id: { type: Sequelize.UUID },
      ...timestamps,
    });

    await ensureTable(queryInterface, 'org_analyses', {
      id: uuidPk,
      org_username: { type: Sequelize.STRING, allowNull: false },
      analysis_type: { type: Sequelize.ENUM('full', 'metadata', 'limits', 'components'), defaultValue: 'full' },
      status: { type: Sequelize.ENUM('pending', 'running', 'completed', 'failed'), defaultValue: 'pending' },
      results: { type: JSON_T },
      metadata: { type: JSON_T },
      limits: { type: JSON_T },
      components: { type: JSON_T },
      error: { type: Sequelize.TEXT },
      started_at: { type: Sequelize.DATE },
      completed_at: { type: Sequelize.DATE },
      duration: { type: Sequelize.INTEGER },
      user_id: { type: Sequelize.UUID },
      ...timestamps,
    });

    await ensureTable(queryInterface, 'orgs', {
      id: uuidPk,
      username: { type: Sequelize.STRING, allowNull: false, unique: true },
      alias: { type: Sequelize.STRING },
      label: { type: Sequelize.STRING },
      instance_url: { type: Sequelize.STRING },
      org_id: { type: Sequelize.STRING },
      is_sandbox: { type: Sequelize.BOOLEAN, defaultValue: false },
      is_dev_hub: { type: Sequelize.BOOLEAN, defaultValue: false },
      environment: { type: Sequelize.STRING },
      notes: { type: Sequelize.TEXT },
      last_tested_at: { type: Sequelize.DATE },
      last_test_result: { type: Sequelize.ENUM('success', 'failure', 'unknown'), defaultValue: 'unknown' },
      last_test_message: { type: Sequelize.STRING },
      connected_status: { type: Sequelize.STRING },
      ...timestamps,
    });

    await ensureTable(queryInterface, 'system_statuses', {
      id: uuidPk,
      component: { type: Sequelize.STRING, allowNull: false, unique: true },
      status: { type: Sequelize.ENUM('healthy', 'warning', 'error', 'unknown'), defaultValue: 'unknown' },
      message: { type: Sequelize.TEXT },
      metadata: { type: Sequelize.JSON },
      last_checked: { type: Sequelize.DATE },
      ...timestamps,
    });

    await ensureTable(queryInterface, 'sfdmu_configs', {
      id: uuidPk,
      name: { type: Sequelize.STRING, allowNull: false },
      description: { type: Sequelize.TEXT },
      source_username: { type: Sequelize.STRING },
      target_username: { type: Sequelize.STRING },
      objects: { type: JSON_T },
      settings: { type: JSON_T },
      file_path: { type: Sequelize.STRING },
      ...timestamps,
    });

    // Audit log (previously created ad hoc by auditService)
    if (!(await tableExists(queryInterface, 'audit_logs'))) {
      const table = quotedTable(queryInterface, 'audit_logs');
      if (dialectOf(queryInterface) === 'postgres') {
        await queryInterface.sequelize.query(`
          CREATE TABLE IF NOT EXISTS ${table} (
            id SERIAL PRIMARY KEY,
            timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            user_id VARCHAR(255),
            username VARCHAR(255),
            action VARCHAR(100) NOT NULL,
            resource_type VARCHAR(100),
            resource_id VARCHAR(255),
            tenant_id VARCHAR(255),
            ip_address INET,
            user_agent TEXT,
            request_id VARCHAR(255),
            session_id VARCHAR(255),
            status VARCHAR(50),
            error_message TEXT,
            metadata JSONB,
            severity VARCHAR(20) DEFAULT 'info',
            compliance_tags TEXT[],
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          )`);
      } else {
        await queryInterface.sequelize.query(`
          CREATE TABLE IF NOT EXISTS ${table} (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            user_id VARCHAR(255),
            username VARCHAR(255),
            action VARCHAR(100) NOT NULL,
            resource_type VARCHAR(100),
            resource_id VARCHAR(255),
            tenant_id VARCHAR(255),
            ip_address VARCHAR(45),
            user_agent TEXT,
            request_id VARCHAR(255),
            session_id VARCHAR(255),
            status VARCHAR(50),
            error_message TEXT,
            metadata TEXT,
            severity VARCHAR(20) DEFAULT 'info',
            compliance_tags TEXT,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          )`);
      }
    }
    for (const [name, fields] of [
      ['idx_audit_logs_timestamp', ['timestamp']],
      ['idx_audit_logs_user_id', ['user_id']],
      ['idx_audit_logs_action', ['action']],
      ['idx_audit_logs_resource', ['resource_type', 'resource_id']],
      ['idx_audit_logs_tenant', ['tenant_id']],
      ['idx_audit_logs_severity', ['severity']],
    ]) {
      await ensureIndex(queryInterface, 'audit_logs', fields, { name });
    }
  },

  async down() {
    // The baseline is never rolled back: it would drop all application data.
    throw new Error('The baseline migration cannot be undone');
  },
};
