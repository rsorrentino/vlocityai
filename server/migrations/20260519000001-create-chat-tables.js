'use strict';

/**
 * AI chat conversations and messages.
 * Idempotent: chatService used to create these tables on first use.
 */
const { ensureTable, ensureIndex, jsonType, nowDefault, tableFor, dialectOf, dropTableIfExists } = require('../db/migrationHelpers');

module.exports = {
  async up(queryInterface, Sequelize) {
    const idType = dialectOf(queryInterface) === 'postgres' ? Sequelize.UUID : Sequelize.STRING;
    const JSON_T = jsonType(queryInterface, Sequelize);

    await ensureTable(queryInterface, 'chat_conversations', {
      id: { type: idType, allowNull: false, primaryKey: true },
      user_id: { type: idType, allowNull: false },
      title: { type: Sequelize.STRING, allowNull: false, defaultValue: 'New conversation' },
      org_username: { type: Sequelize.STRING, allowNull: true },
      adapter: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: nowDefault(queryInterface) },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: nowDefault(queryInterface) },
    });
    await ensureIndex(queryInterface, 'chat_conversations', ['user_id'], { name: 'idx_chat_conversations_user_id' });

    await ensureTable(queryInterface, 'chat_messages', {
      id: { type: idType, allowNull: false, primaryKey: true },
      conversation_id: {
        type: idType,
        allowNull: false,
        references: { model: tableFor(queryInterface, 'chat_conversations'), key: 'id' },
        onDelete: 'CASCADE',
      },
      role: { type: Sequelize.STRING, allowNull: false },
      content: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      tool_calls: { type: JSON_T, allowNull: true },
      tool_results: { type: JSON_T, allowNull: true },
      tokens_used: { type: Sequelize.INTEGER, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: nowDefault(queryInterface) },
    });
    await ensureIndex(queryInterface, 'chat_messages', ['conversation_id'], { name: 'idx_chat_messages_conversation_id' });
  },

  async down(queryInterface) {
    await dropTableIfExists(queryInterface, 'chat_messages');
    await dropTableIfExists(queryInterface, 'chat_conversations');
  },
};
