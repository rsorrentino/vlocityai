'use strict';

/**
 * Performance indexes for frequently queried columns.
 * Idempotent: indexes that already exist are skipped.
 */
const { ensureIndex, dialectOf, tableFor } = require('../db/migrationHelpers');

const INDEXES = [
  { table: 'jobs', fields: ['status', 'created_at'], name: 'jobs_status_created_at_idx' },
  { table: 'jobs', fields: ['user_id', 'created_at'], name: 'jobs_user_id_created_at_idx' },
  { table: 'jobs', fields: ['type', 'created_at'], name: 'jobs_type_created_at_idx' },
  { table: 'users', fields: ['username'], name: 'users_username_idx', unique: true },
  { table: 'users', fields: ['email'], name: 'users_email_idx', unique: true },
  { table: 'audit_logs', fields: ['user_id', 'timestamp'], name: 'audit_logs_user_id_timestamp_idx' },
];

module.exports = {
  async up(queryInterface) {
    const concurrently = dialectOf(queryInterface) === 'postgres';
    for (const { table, fields, name, unique } of INDEXES) {
      await ensureIndex(queryInterface, table, fields, { name, unique: Boolean(unique), concurrently });
    }
  },

  async down(queryInterface) {
    for (const { table, name } of [...INDEXES].reverse()) {
      try {
        await queryInterface.removeIndex(tableFor(queryInterface, table), name);
      } catch {
        /* already gone */
      }
    }
  },
};
