-- Chat thread schema for omnichannel + internal DM alignment

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
);

CREATE TABLE IF NOT EXISTS chat_thread_members (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    thread_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    member_role ENUM('participant','support_agent') NOT NULL DEFAULT 'participant',
    joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_chat_thread_member (thread_id, user_id),
    INDEX idx_chat_thread_members_user (user_id)
);

ALTER TABLE messages ADD COLUMN thread_id CHAR(36) NULL;
ALTER TABLE messages ADD COLUMN channel ENUM('app','whatsapp') NOT NULL DEFAULT 'app';
ALTER TABLE messages ADD COLUMN quoted_message_id BIGINT NULL;
ALTER TABLE messages ADD COLUMN delivery_state ENUM('sent','delivered','read','failed') NOT NULL DEFAULT 'sent';
ALTER TABLE messages ADD COLUMN read_at DATETIME NULL;

CREATE INDEX idx_messages_thread_created ON messages (thread_id, createdAt);
CREATE INDEX idx_messages_read_at ON messages (read_at);

