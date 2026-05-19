'use strict';

/**
 * Migration: Add performance indexes
 *
 * Adds indexes to frequently queried columns to improve database performance:
 * - jobs table: (status, created_at) for job listing queries
 * - jobs table: (user_id, created_at) for user-specific job queries
 * - users table: (username) for authentication lookups
 * - users table: (email) for unique constraint and lookups
 */

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const schema = process.env.DB_SCHEMA || 'vlocity_datapack_manager';
    const dialect = queryInterface.sequelize.getDialect();

    console.log(`Adding performance indexes (${dialect})...`);

    // Jobs table indexes
    try {
      // Index for job status and date filtering (e.g., "show me all running jobs from last week")
      await queryInterface.addIndex(
        { tableName: 'jobs', schema: dialect === 'postgres' ? schema : undefined },
        ['status', 'created_at'],
        {
          name: 'jobs_status_created_at_idx',
          concurrently: dialect === 'postgres', // Non-blocking index creation in PostgreSQL
        }
      );
      console.log('✅ Created index: jobs_status_created_at_idx');
    } catch (error) {
      console.warn('⚠️ Index jobs_status_created_at_idx may already exist:', error.message);
    }

    try {
      // Index for user-specific job queries (e.g., "show me all jobs for user X")
      await queryInterface.addIndex(
        { tableName: 'jobs', schema: dialect === 'postgres' ? schema : undefined },
        ['user_id', 'created_at'],
        {
          name: 'jobs_user_id_created_at_idx',
          concurrently: dialect === 'postgres',
        }
      );
      console.log('✅ Created index: jobs_user_id_created_at_idx');
    } catch (error) {
      console.warn('⚠️ Index jobs_user_id_created_at_idx may already exist:', error.message);
    }

    try {
      // Index for job type filtering
      await queryInterface.addIndex(
        { tableName: 'jobs', schema: dialect === 'postgres' ? schema : undefined },
        ['type', 'created_at'],
        {
          name: 'jobs_type_created_at_idx',
          concurrently: dialect === 'postgres',
        }
      );
      console.log('✅ Created index: jobs_type_created_at_idx');
    } catch (error) {
      console.warn('⚠️ Index jobs_type_created_at_idx may already exist:', error.message);
    }

    // Users table indexes
    try {
      // Index for username lookups (authentication)
      await queryInterface.addIndex(
        { tableName: 'users', schema: dialect === 'postgres' ? schema : undefined },
        ['username'],
        {
          name: 'users_username_idx',
          unique: true, // Enforce unique usernames
          concurrently: dialect === 'postgres',
        }
      );
      console.log('✅ Created index: users_username_idx');
    } catch (error) {
      console.warn('⚠️ Index users_username_idx may already exist:', error.message);
    }

    try {
      // Index for email lookups
      await queryInterface.addIndex(
        { tableName: 'users', schema: dialect === 'postgres' ? schema : undefined },
        ['email'],
        {
          name: 'users_email_idx',
          unique: true, // Enforce unique emails
          concurrently: dialect === 'postgres',
        }
      );
      console.log('✅ Created index: users_email_idx');
    } catch (error) {
      console.warn('⚠️ Index users_email_idx may already exist:', error.message);
    }

    // Audit logs table indexes (if exists)
    try {
      await queryInterface.addIndex(
        { tableName: 'audit_logs', schema: dialect === 'postgres' ? schema : undefined },
        ['user_id', 'timestamp'],
        {
          name: 'audit_logs_user_id_timestamp_idx',
          concurrently: dialect === 'postgres',
        }
      );
      console.log('✅ Created index: audit_logs_user_id_timestamp_idx');
    } catch (error) {
      console.warn('⚠️ Index audit_logs_user_id_timestamp_idx may already exist or table does not exist:', error.message);
    }

    console.log('✅ Performance indexes migration completed');
  },

  down: async (queryInterface, Sequelize) => {
    const schema = process.env.DB_SCHEMA || 'vlocity_datapack_manager';
    const dialect = queryInterface.sequelize.getDialect();

    console.log(`Removing performance indexes (${dialect})...`);

    // Remove all indexes in reverse order
    const indexes = [
      { table: 'audit_logs', name: 'audit_logs_user_id_timestamp_idx' },
      { table: 'users', name: 'users_email_idx' },
      { table: 'users', name: 'users_username_idx' },
      { table: 'jobs', name: 'jobs_type_created_at_idx' },
      { table: 'jobs', name: 'jobs_user_id_created_at_idx' },
      { table: 'jobs', name: 'jobs_status_created_at_idx' },
    ];

    for (const { table, name } of indexes) {
      try {
        await queryInterface.removeIndex(
          { tableName: table, schema: dialect === 'postgres' ? schema : undefined },
          name
        );
        console.log(`✅ Removed index: ${name}`);
      } catch (error) {
        console.warn(`⚠️ Could not remove index ${name}:`, error.message);
      }
    }

    console.log('✅ Performance indexes rollback completed');
  }
};
