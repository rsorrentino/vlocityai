'use strict';

/**
 * AI chat usage tracking and AI-proposed changes that need confirmation.
 *
 * chat_messages gains per-message usage (input/output tokens, model, adapter,
 * estimated cost). ai_pending_actions stores write actions the assistant
 * proposes; nothing is changed in Salesforce until the user approves.
 */
const { ensureTable, ensureIndex, dropTableIfExists, jsonType, nowDefault, tableFor, dialectOf } = require('../db/migrationHelpers');

module.exports = {
  async up(queryInterface, Sequelize) {
    const JSON_T = jsonType(queryInterface, Sequelize);
    const idType = dialectOf(queryInterface) === 'postgres' ? Sequelize.UUID : Sequelize.STRING;

    // ensureTable adds the missing columns to the existing table
    await ensureTable(queryInterface, 'chat_messages', {
      input_tokens: { type: Sequelize.INTEGER, allowNull: true },
      output_tokens: { type: Sequelize.INTEGER, allowNull: true },
      model: { type: Sequelize.STRING(100), allowNull: true },
      adapter: { type: Sequelize.STRING(32), allowNull: true },
      cost_usd: { type: Sequelize.DECIMAL(14, 6), allowNull: true },
    });
    await ensureIndex(queryInterface, 'chat_messages', ['created_at'], { name: 'idx_chat_messages_created_at' });

    await ensureTable(queryInterface, 'ai_pending_actions', {
      id: { type: idType, primaryKey: true, allowNull: false },
      conversation_id: {
        type: idType,
        allowNull: false,
        references: { model: tableFor(queryInterface, 'chat_conversations'), key: 'id' },
        onDelete: 'CASCADE',
      },
      user_id: { type: idType, allowNull: false },
      org_username: { type: Sequelize.STRING, allowNull: true },
      tool: { type: Sequelize.STRING(64), allowNull: false },
      args: { type: JSON_T, allowNull: false },
      summary: { type: Sequelize.TEXT, allowNull: true },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'pending' },
      result: { type: JSON_T, allowNull: true },
      decided_by: { type: Sequelize.STRING(64), allowNull: true },
      decided_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: nowDefault(queryInterface) },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: nowDefault(queryInterface) },
    });
    await ensureIndex(queryInterface, 'ai_pending_actions', ['conversation_id'], { name: 'idx_ai_pending_actions_conversation' });
    await ensureIndex(queryInterface, 'ai_pending_actions', ['user_id', 'status'], { name: 'idx_ai_pending_actions_user_status' });
  },

  async down(queryInterface) {
    await dropTableIfExists(queryInterface, 'ai_pending_actions');
    for (const column of ['input_tokens', 'output_tokens', 'model', 'adapter', 'cost_usd']) {
      try {
        await queryInterface.removeColumn(tableFor(queryInterface, 'chat_messages'), column);
      } catch {
        /* already removed */
      }
    }
  },
};
