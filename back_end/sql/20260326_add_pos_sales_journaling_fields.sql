-- POS Sales: journaling status fields
-- Date: 2026-03-26

-- NOTE: MySQL 8 does not support `ADD COLUMN IF NOT EXISTS`.
-- This migration is written to be idempotent via information_schema checks.

SET @db := DATABASE();

SET @has_journal_status := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'pos_sales'
    AND COLUMN_NAME = 'journal_status'
);
SET @ddl := IF(
  @has_journal_status = 0,
  'ALTER TABLE `pos_sales` ADD COLUMN `journal_status` ENUM(''posted'',''failed'') NULL AFTER `void_reason`',
  'SELECT \"skip pos_sales.journal_status\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_journal_posted_at := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'pos_sales'
    AND COLUMN_NAME = 'journal_posted_at'
);
SET @ddl := IF(
  @has_journal_posted_at = 0,
  'ALTER TABLE `pos_sales` ADD COLUMN `journal_posted_at` DATETIME NULL AFTER `journal_status`',
  'SELECT \"skip pos_sales.journal_posted_at\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_journal_error := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'pos_sales'
    AND COLUMN_NAME = 'journal_error'
);
SET @ddl := IF(
  @has_journal_error = 0,
  'ALTER TABLE `pos_sales` ADD COLUMN `journal_error` TEXT NULL AFTER `journal_posted_at`',
  'SELECT \"skip pos_sales.journal_error\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
