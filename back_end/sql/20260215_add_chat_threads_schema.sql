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

-- Idempotent additions to `messages` (safe to run multiple times).
SET @db := DATABASE();

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'messages'
    AND COLUMN_NAME = 'thread_id'
);
SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE `messages` ADD COLUMN `thread_id` CHAR(36) NULL',
  'SELECT \"skip messages.thread_id\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'messages'
    AND COLUMN_NAME = 'channel'
);
SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE `messages` ADD COLUMN `channel` ENUM(''app'',''whatsapp'') NOT NULL DEFAULT ''app''',
  'SELECT \"skip messages.channel\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'messages'
    AND COLUMN_NAME = 'quoted_message_id'
);
SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE `messages` ADD COLUMN `quoted_message_id` BIGINT NULL',
  'SELECT \"skip messages.quoted_message_id\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'messages'
    AND COLUMN_NAME = 'delivery_state'
);
SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE `messages` ADD COLUMN `delivery_state` ENUM(''sent'',''delivered'',''read'',''failed'') NOT NULL DEFAULT ''sent''',
  'SELECT \"skip messages.delivery_state\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'messages'
    AND COLUMN_NAME = 'read_at'
);
SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE `messages` ADD COLUMN `read_at` DATETIME NULL',
  'SELECT \"skip messages.read_at\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Idempotent indexes (safe to run multiple times).
SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'messages'
    AND INDEX_NAME = 'idx_messages_thread_created'
);
SET @ddl := IF(
  @idx_exists = 0,
  'CREATE INDEX `idx_messages_thread_created` ON `messages` (`thread_id`, `createdAt`)',
  'SELECT \"skip idx_messages_thread_created\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'messages'
    AND INDEX_NAME = 'idx_messages_read_at'
);
SET @ddl := IF(
  @idx_exists = 0,
  'CREATE INDEX `idx_messages_read_at` ON `messages` (`read_at`)',
  'SELECT \"skip idx_messages_read_at\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
