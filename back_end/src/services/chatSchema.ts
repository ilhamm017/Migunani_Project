import { sequelize } from '../models';

const ensureColumn = async (table: string, column: string, alterSql: string) => {
    const [rows] = await sequelize.query(
        `
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = :tableName
          AND COLUMN_NAME = :columnName
        `,
        {
            replacements: { tableName: table, columnName: column }
        }
    ) as any;
    if (Array.isArray(rows) && rows.length > 0) return;
    await sequelize.query(alterSql);
};

const ensureIndex = async (table: string, indexName: string, createSql: string) => {
    const [rows] = await sequelize.query(
        `
        SELECT INDEX_NAME
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = :tableName
          AND INDEX_NAME = :indexName
        LIMIT 1
        `,
        {
            replacements: { tableName: table, indexName }
        }
    ) as any;
    if (Array.isArray(rows) && rows.length > 0) return;
    await sequelize.query(createSql);
};

export const ensureChatThreadSchema = async () => {
    if (sequelize.getDialect() !== 'mysql') return;

    await sequelize.query(
        `
        CREATE TABLE IF NOT EXISTS chat_threads (
            id CHAR(36) NOT NULL PRIMARY KEY,
            thread_key VARCHAR(255) NOT NULL UNIQUE,
            thread_type ENUM('staff_dm','staff_customer','support_omni','wa_lead') NOT NULL,
            last_message_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            is_bot_active TINYINT(1) NOT NULL DEFAULT 0,
            customer_user_id CHAR(36) NULL,
            external_whatsapp_number VARCHAR(32) NULL,
            createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_chat_threads_type_last (thread_type, last_message_at),
            INDEX idx_chat_threads_customer (customer_user_id),
            INDEX idx_chat_threads_external (external_whatsapp_number)
        )
        `
    );

    await sequelize.query(
        `
        CREATE TABLE IF NOT EXISTS chat_thread_members (
            id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            thread_id CHAR(36) NOT NULL,
            user_id CHAR(36) NOT NULL,
            member_role ENUM('participant','support_agent') NOT NULL DEFAULT 'participant',
            joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_chat_thread_member (thread_id, user_id),
            INDEX idx_chat_thread_members_user (user_id)
        )
        `
    );

    await ensureColumn(
        'messages',
        'thread_id',
        `ALTER TABLE messages ADD COLUMN thread_id CHAR(36) NULL AFTER session_id`
    );
    await ensureColumn(
        'messages',
        'channel',
        `ALTER TABLE messages ADD COLUMN channel ENUM('app','whatsapp') NOT NULL DEFAULT 'app' AFTER created_via`
    );
    await ensureColumn(
        'messages',
        'quoted_message_id',
        `ALTER TABLE messages ADD COLUMN quoted_message_id BIGINT NULL AFTER channel`
    );
    await ensureColumn(
        'messages',
        'delivery_state',
        `ALTER TABLE messages ADD COLUMN delivery_state ENUM('sent','delivered','read','failed') NOT NULL DEFAULT 'sent' AFTER quoted_message_id`
    );
    await ensureColumn(
        'messages',
        'read_at',
        `ALTER TABLE messages ADD COLUMN read_at DATETIME NULL AFTER delivery_state`
    );

    await ensureIndex(
        'messages',
        'idx_messages_thread_created',
        `CREATE INDEX idx_messages_thread_created ON messages (thread_id, createdAt)`
    );
    await ensureIndex(
        'messages',
        'idx_messages_read_at',
        `CREATE INDEX idx_messages_read_at ON messages (read_at)`
    );
};
