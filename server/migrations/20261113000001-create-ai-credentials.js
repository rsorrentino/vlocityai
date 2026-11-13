'use strict';

/**
 * Per-user AI provider credentials (GitHub token from "Sign in with GitHub"),
 * encrypted at rest by the application.
 */
const { ensureTable, ensureIndex, dropTableIfExists } = require('../db/migrationHelpers');

module.exports = {
  async up(queryInterface, Sequelize) {
    await ensureTable(queryInterface, 'ai_credentials', {
      id: { type: Sequelize.STRING(36), primaryKey: true, allowNull: false },
      user_id: { type: Sequelize.STRING(64), allowNull: false },
      provider: { type: Sequelize.STRING(32), allowNull: false },
      encrypted_token: { type: Sequelize.TEXT, allowNull: false },
      account_login: { type: Sequelize.STRING(255), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });
    await ensureIndex(queryInterface, 'ai_credentials', ['user_id', 'provider'], {
      name: 'idx_ai_credentials_user_provider',
      unique: true,
    });
  },

  async down(queryInterface) {
    await dropTableIfExists(queryInterface, 'ai_credentials');
  },
};
