/**
 * Enterprise Audit Service
 * Comprehensive audit logging for compliance and security
 */

const logger = require('../utils/logger');
const databaseService = require('./databaseService');
const { Op, QueryTypes } = require('sequelize');

class AuditService {
  constructor() {
    this.isEnabled = process.env.ENABLE_AUDIT_LOGGING !== 'false';
    this.retentionDays = parseInt(process.env.AUDIT_RETENTION_DAYS) || 365;
    this.batchSize = parseInt(process.env.AUDIT_BATCH_SIZE) || 100;
    this.batch = [];
    this.flushInterval = null;

    if (this.isEnabled) {
      this.initializeDatabase();
      this.startBatchProcessor();
    }
  }

  async initializeDatabase() {
    try {
      const { sequelize } = databaseService;
      
      // Create audit log table if it doesn't exist
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS vlocity_datapack_manager.audit_logs (
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
        )
      `);

      // Create indexes for performance
      await sequelize.query(`
        CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON vlocity_datapack_manager.audit_logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON vlocity_datapack_manager.audit_logs(user_id);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON vlocity_datapack_manager.audit_logs(action);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON vlocity_datapack_manager.audit_logs(resource_type, resource_id);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON vlocity_datapack_manager.audit_logs(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON vlocity_datapack_manager.audit_logs(severity);
      `);

      logger.info('Audit service database initialized');
    } catch (error) {
      logger.logError(error, { operation: 'initializeDatabase' });
    }
  }

  /**
   * Log an audit event
   */
  async log({
    userId,
    username,
    action,
    resourceType,
    resourceId,
    tenantId,
    ipAddress,
    userAgent,
    requestId,
    sessionId,
    status = 'success',
    errorMessage,
    metadata = {},
    severity = 'info',
    complianceTags = [],
  }) {
    if (!this.isEnabled) return;

    const auditEntry = {
      timestamp: new Date(),
      user_id: userId,
      username,
      action,
      resource_type: resourceType,
      resource_id: resourceId,
      tenant_id: tenantId,
      ip_address: ipAddress,
      user_agent: userAgent,
      request_id: requestId,
      session_id: sessionId,
      status,
      error_message: errorMessage,
      metadata: JSON.stringify(metadata),
      severity,
      compliance_tags: complianceTags,
    };

    // Add to batch
    this.batch.push(auditEntry);

    // Flush if batch is full
    if (this.batch.length >= this.batchSize) {
      await this.flushBatch();
    }

    // Also log to Winston for immediate visibility
    const logLevel = severity === 'error' ? 'error' : severity === 'warning' ? 'warn' : 'info';
    logger[logLevel]('Audit log', auditEntry);
  }

  /**
   * Log authentication event
   */
  async logAuthentication({
    userId,
    username,
    action, // login, logout, login_failed, password_changed, etc.
    ipAddress,
    userAgent,
    requestId,
    sessionId,
    status,
    errorMessage,
    metadata = {},
  }) {
    return this.log({
      userId,
      username,
      action: `auth_${action}`,
      resourceType: 'authentication',
      ipAddress,
      userAgent,
      requestId,
      sessionId,
      status,
      errorMessage,
      metadata,
      severity: status === 'success' ? 'info' : 'warning',
      complianceTags: ['security', 'authentication'],
    });
  }

  /**
   * Log authorization event
   */
  async logAuthorization({
    userId,
    username,
    action, // access_granted, access_denied, permission_changed, etc.
    resourceType,
    resourceId,
    ipAddress,
    userAgent,
    requestId,
    status,
    errorMessage,
    metadata = {},
  }) {
    return this.log({
      userId,
      username,
      action: `authz_${action}`,
      resourceType,
      resourceId,
      ipAddress,
      userAgent,
      requestId,
      status,
      errorMessage,
      metadata,
      severity: status === 'access_denied' ? 'warning' : 'info',
      complianceTags: ['security', 'authorization'],
    });
  }

  /**
   * Log data access event
   */
  async logDataAccess({
    userId,
    username,
    action, // read, write, delete, export, etc.
    resourceType,
    resourceId,
    tenantId,
    ipAddress,
    userAgent,
    requestId,
    status,
    metadata = {},
  }) {
    return this.log({
      userId,
      username,
      action: `data_${action}`,
      resourceType,
      resourceId,
      tenantId,
      ipAddress,
      userAgent,
      requestId,
      status,
      metadata,
      severity: 'info',
      complianceTags: ['data_access', 'privacy'],
    });
  }

  /**
   * Log configuration change
   */
  async logConfigurationChange({
    userId,
    username,
    action, // created, updated, deleted
    resourceType,
    resourceId,
    ipAddress,
    userAgent,
    requestId,
    oldValue,
    newValue,
    status,
    metadata = {},
  }) {
    return this.log({
      userId,
      username,
      action: `config_${action}`,
      resourceType,
      resourceId,
      ipAddress,
      userAgent,
      requestId,
      status,
      metadata: {
        ...metadata,
        old_value: oldValue,
        new_value: newValue,
      },
      severity: 'info',
      complianceTags: ['configuration', 'change_management'],
    });
  }

  /**
   * Log job execution
   */
  async logJobExecution({
    userId,
    username,
    action, // started, completed, failed, cancelled
    jobId,
    jobType,
    tenantId,
    ipAddress,
    userAgent,
    requestId,
    status,
    errorMessage,
    metadata = {},
  }) {
    return this.log({
      userId,
      username,
      action: `job_${action}`,
      resourceType: jobType,
      resourceId: jobId,
      tenantId,
      ipAddress,
      userAgent,
      requestId,
      status,
      errorMessage,
      metadata,
      severity: status === 'failed' ? 'error' : 'info',
      complianceTags: ['job_execution', 'operations'],
    });
  }

  /**
   * Log security event
   */
  async logSecurityEvent({
    userId,
    username,
    action, // suspicious_activity, brute_force, privilege_escalation, etc.
    resourceType,
    resourceId,
    ipAddress,
    userAgent,
    requestId,
    status,
    errorMessage,
    metadata = {},
    severity = 'warning',
  }) {
    return this.log({
      userId,
      username,
      action: `security_${action}`,
      resourceType,
      resourceId,
      ipAddress,
      userAgent,
      requestId,
      status,
      errorMessage,
      metadata,
      severity,
      complianceTags: ['security', 'threat_detection'],
    });
  }

  /**
   * Flush batch to database
   */
  async flushBatch() {
    if (this.batch.length === 0) return;

    const batchToFlush = [...this.batch];
    this.batch = [];

    try {
      const { sequelize } = databaseService;
      
      // Use Sequelize's proper bulk insert with parameterized queries
      // This prevents SQL injection and handles database-specific syntax
      
      // Prepare data for bulk insert
      const insertData = batchToFlush.map(entry => ({
        timestamp: entry.timestamp,
        user_id: entry.user_id || null,
        username: entry.username || null,
        action: entry.action,
        resource_type: entry.resource_type || null,
        resource_id: entry.resource_id || null,
        tenant_id: entry.tenant_id || null,
        ip_address: entry.ip_address || null,
        user_agent: entry.user_agent || null,
        request_id: entry.request_id || null,
        session_id: entry.session_id || null,
        status: entry.status,
        error_message: entry.error_message || null,
        metadata: typeof entry.metadata === 'string' ? entry.metadata : JSON.stringify(entry.metadata || {}),
        severity: entry.severity,
        compliance_tags: entry.compliance_tags || []
      }));

      // Use raw query with proper parameterization for PostgreSQL arrays
      // For PostgreSQL, we need to handle array types properly
      const dbType = sequelize.getDialect();
      
      if (dbType === 'postgres') {
        // PostgreSQL: Use proper array syntax
        const placeholders = [];
        const values = [];
        let paramIndex = 1;
        
        for (const entry of insertData) {
          const rowPlaceholders = [];
          
          rowPlaceholders.push(`$${paramIndex++}`); values.push(entry.timestamp);
          rowPlaceholders.push(`$${paramIndex++}`); values.push(entry.user_id);
          rowPlaceholders.push(`$${paramIndex++}`); values.push(entry.username);
          rowPlaceholders.push(`$${paramIndex++}`); values.push(entry.action);
          rowPlaceholders.push(`$${paramIndex++}`); values.push(entry.resource_type);
          rowPlaceholders.push(`$${paramIndex++}`); values.push(entry.resource_id);
          rowPlaceholders.push(`$${paramIndex++}`); values.push(entry.tenant_id);
          rowPlaceholders.push(`$${paramIndex++}`); values.push(entry.ip_address);
          rowPlaceholders.push(`$${paramIndex++}`); values.push(entry.user_agent);
          rowPlaceholders.push(`$${paramIndex++}`); values.push(entry.request_id);
          rowPlaceholders.push(`$${paramIndex++}`); values.push(entry.session_id);
          rowPlaceholders.push(`$${paramIndex++}`); values.push(entry.status);
          rowPlaceholders.push(`$${paramIndex++}`); values.push(entry.error_message);
          rowPlaceholders.push(`$${paramIndex++}`); values.push(entry.metadata);
          rowPlaceholders.push(`$${paramIndex++}`); values.push(entry.severity);
          rowPlaceholders.push(`$${paramIndex++}::text[]`); values.push(entry.compliance_tags);
          
          placeholders.push(`(${rowPlaceholders.join(', ')})`);
        }

        const query = `
          INSERT INTO vlocity_datapack_manager.audit_logs (
            timestamp, user_id, username, action, resource_type, resource_id,
            tenant_id, ip_address, user_agent, request_id, session_id,
            status, error_message, metadata, severity, compliance_tags
          ) VALUES ${placeholders.join(', ')}
        `;

        await sequelize.query(query, {
          bind: values,
          type: QueryTypes.INSERT
        });
      } else {
        // SQLite or other: Use simpler approach
        // For SQLite, we'll insert one by one or use a transaction
        const transaction = await sequelize.transaction();
        try {
          for (const entry of insertData) {
            await sequelize.query(`
              INSERT INTO audit_logs (
                timestamp, user_id, username, action, resource_type, resource_id,
                tenant_id, ip_address, user_agent, request_id, session_id,
                status, error_message, metadata, severity, compliance_tags
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, {
              replacements: [
                entry.timestamp,
                entry.user_id,
                entry.username,
                entry.action,
                entry.resource_type,
                entry.resource_id,
                entry.tenant_id,
                entry.ip_address,
                entry.user_agent,
                entry.request_id,
                entry.session_id,
                entry.status,
                entry.error_message,
                entry.metadata,
                entry.severity,
                JSON.stringify(entry.compliance_tags) // SQLite doesn't support arrays
              ],
              type: QueryTypes.INSERT,
              transaction
            });
          }
          await transaction.commit();
        } catch (error) {
          await transaction.rollback();
          throw error;
        }
      }

      logger.debug(`Flushed ${batchToFlush.length} audit logs to database`);
    } catch (error) {
      logger.logError(error, { operation: 'flushBatch', batchSize: batchToFlush.length });
      // Re-add to batch for retry (limit retries to prevent infinite loops)
      if (batchToFlush.length < 1000) { // Only retry if batch is reasonable size
        this.batch.unshift(...batchToFlush);
      } else {
        logger.error('Batch too large to retry, dropping audit logs', { batchSize: batchToFlush.length });
      }
    }
  }

  /**
   * Start batch processor
   */
  startBatchProcessor() {
    // Flush every 5 seconds
    this.flushInterval = setInterval(() => {
      this.flushBatch();
    }, 5000);

    // Flush on process exit
    process.on('SIGTERM', () => {
      this.flushBatch();
      if (this.flushInterval) {
        clearInterval(this.flushInterval);
      }
    });
  }

  /**
   * Query audit logs
   */
  async queryAuditLogs({
    userId,
    action,
    resourceType,
    resourceId,
    tenantId,
    startDate,
    endDate,
    severity,
    complianceTags,
    limit = 100,
    offset = 0,
  } = {}) {
    if (!this.isEnabled) return { logs: [], total: 0 };

    try {
      const { sequelize } = databaseService;
      const conditions = [];
      const replacements = {};

      if (userId) {
        conditions.push('user_id = :userId');
        replacements.userId = userId;
      }
      if (action) {
        conditions.push('action = :action');
        replacements.action = action;
      }
      if (resourceType) {
        conditions.push('resource_type = :resourceType');
        replacements.resourceType = resourceType;
      }
      if (resourceId) {
        conditions.push('resource_id = :resourceId');
        replacements.resourceId = resourceId;
      }
      if (tenantId) {
        conditions.push('tenant_id = :tenantId');
        replacements.tenantId = tenantId;
      }
      if (startDate) {
        conditions.push('timestamp >= :startDate');
        replacements.startDate = startDate;
      }
      if (endDate) {
        conditions.push('timestamp <= :endDate');
        replacements.endDate = endDate;
      }
      if (severity) {
        conditions.push('severity = :severity');
        replacements.severity = severity;
      }
      if (complianceTags && complianceTags.length > 0) {
        conditions.push('compliance_tags && ARRAY[:complianceTags]');
        replacements.complianceTags = complianceTags;
      }

      const whereClause = conditions.length > 0 
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

      // Get total count
      const [countResult] = await sequelize.query(`
        SELECT COUNT(*) as total
        FROM vlocity_datapack_manager.audit_logs
        ${whereClause}
      `, { replacements });

      const total = parseInt(countResult[0].total);

      // Get logs
      const [logs] = await sequelize.query(`
        SELECT *
        FROM vlocity_datapack_manager.audit_logs
        ${whereClause}
        ORDER BY timestamp DESC
        LIMIT :limit OFFSET :offset
      `, {
        replacements: {
          ...replacements,
          limit,
          offset,
        },
      });

      // Parse metadata JSON
      logs.forEach(log => {
        if (log.metadata) {
          try {
            log.metadata = JSON.parse(log.metadata);
          } catch (e) {
            // Keep as string if parsing fails
          }
        }
      });

      return { logs, total };
    } catch (error) {
      logger.logError(error, { operation: 'queryAuditLogs' });
      throw error;
    }
  }

  /**
   * Clean up old audit logs
   */
  async cleanupOldLogs() {
    if (!this.isEnabled) return;

    try {
      const { sequelize } = databaseService;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);

      const [result] = await sequelize.query(`
        DELETE FROM vlocity_datapack_manager.audit_logs
        WHERE timestamp < :cutoffDate
      `, {
        replacements: { cutoffDate },
      });

      logger.info(`Cleaned up audit logs older than ${this.retentionDays} days`);
      return result;
    } catch (error) {
      logger.logError(error, { operation: 'cleanupOldLogs' });
      throw error;
    }
  }

  /**
   * Get audit statistics
   */
  async getAuditStatistics(startDate, endDate) {
    if (!this.isEnabled) return {};

    try {
      const { sequelize } = databaseService;
      
      const [stats] = await sequelize.query(`
        SELECT
          COUNT(*) as total_events,
          COUNT(DISTINCT user_id) as unique_users,
          COUNT(DISTINCT action) as unique_actions,
          COUNT(*) FILTER (WHERE status = 'success') as successful_events,
          COUNT(*) FILTER (WHERE status = 'failed') as failed_events,
          COUNT(*) FILTER (WHERE severity = 'error') as error_events,
          COUNT(*) FILTER (WHERE severity = 'warning') as warning_events
        FROM vlocity_datapack_manager.audit_logs
        WHERE timestamp >= :startDate AND timestamp <= :endDate
      `, {
        replacements: { startDate, endDate },
      });

      return stats[0] || {};
    } catch (error) {
      logger.logError(error, { operation: 'getAuditStatistics' });
      throw error;
    }
  }
}

// Singleton instance
let instance = null;

module.exports = function getAuditService() {
  if (!instance) {
    instance = new AuditService();
  }
  return instance;
};

module.exports.AuditService = AuditService;

