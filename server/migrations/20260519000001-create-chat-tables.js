'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS vlocity_datapack_manager.chat_conversations (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      INTEGER NOT NULL,
        title        VARCHAR(255) NOT NULL DEFAULT 'New conversation',
        org_username VARCHAR(255),
        adapter      VARCHAR(50),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_chat_conversations_user_id
        ON vlocity_datapack_manager.chat_conversations(user_id);

      CREATE TABLE IF NOT EXISTS vlocity_datapack_manager.chat_messages (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES vlocity_datapack_manager.chat_conversations(id) ON DELETE CASCADE,
        role            VARCHAR(20) NOT NULL,
        content         TEXT NOT NULL DEFAULT '',
        tool_calls      JSONB,
        tool_results    JSONB,
        tokens_used     INTEGER,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id
        ON vlocity_datapack_manager.chat_messages(conversation_id);
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DROP TABLE IF EXISTS vlocity_datapack_manager.chat_messages;
      DROP TABLE IF EXISTS vlocity_datapack_manager.chat_conversations;
    `);
  },
};
