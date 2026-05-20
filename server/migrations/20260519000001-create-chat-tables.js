'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const schema = process.env.DB_SCHEMA || 'vlocity_datapack_manager';
    const dialect = queryInterface.sequelize.getDialect();
    const idType = dialect === 'postgres' ? Sequelize.UUID : Sequelize.STRING;
    const jsonType = dialect === 'postgres' ? Sequelize.JSONB : Sequelize.JSON;
    const timestampDefault = queryInterface.sequelize.literal(
      dialect === 'postgres' ? 'NOW()' : 'CURRENT_TIMESTAMP'
    );

    const conversationsTable = dialect === 'postgres'
      ? { tableName: 'chat_conversations', schema }
      : { tableName: 'chat_conversations' };

    const messagesTable = dialect === 'postgres'
      ? { tableName: 'chat_messages', schema }
      : { tableName: 'chat_messages' };

    await queryInterface.createTable(conversationsTable, {
      id: {
        type: idType,
        allowNull: false,
        primaryKey: true,
      },
      user_id: {
        type: idType,
        allowNull: false,
      },
      title: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'New conversation',
      },
      org_username: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      adapter: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: timestampDefault,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: timestampDefault,
      },
    });

    await queryInterface.addIndex(conversationsTable, ['user_id'], {
      name: 'idx_chat_conversations_user_id',
    });

    await queryInterface.createTable(messagesTable, {
      id: {
        type: idType,
        allowNull: false,
        primaryKey: true,
      },
      conversation_id: {
        type: idType,
        allowNull: false,
        references: {
          model: conversationsTable,
          key: 'id',
        },
        onDelete: 'CASCADE',
      },
      role: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      content: {
        type: Sequelize.TEXT,
        allowNull: false,
        defaultValue: '',
      },
      tool_calls: {
        type: jsonType,
        allowNull: true,
      },
      tool_results: {
        type: jsonType,
        allowNull: true,
      },
      tokens_used: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: timestampDefault,
      },
    });

    await queryInterface.addIndex(messagesTable, ['conversation_id'], {
      name: 'idx_chat_messages_conversation_id',
    });
  },

  async down(queryInterface, Sequelize) {
    const schema = process.env.DB_SCHEMA || 'vlocity_datapack_manager';
    const dialect = queryInterface.sequelize.getDialect();
    const conversationsTable = dialect === 'postgres'
      ? { tableName: 'chat_conversations', schema }
      : { tableName: 'chat_conversations' };
    const messagesTable = dialect === 'postgres'
      ? { tableName: 'chat_messages', schema }
      : { tableName: 'chat_messages' };

    await queryInterface.dropTable(messagesTable);
    await queryInterface.dropTable(conversationsTable);
  },
};
