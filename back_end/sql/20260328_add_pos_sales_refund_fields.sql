-- POS Sales: refund fields (replace void button with refund)
-- Date: 2026-03-28

-- NOTE: MySQL 8 does not support `ADD COLUMN IF NOT EXISTS`.
-- This migration is written to be idempotent via information_schema checks.

-- Ensure enum includes `refunded` (safe to re-run)
ALTER TABLE `pos_sales`
  MODIFY COLUMN `status` ENUM('paid', 'voided', 'refunded') NOT NULL DEFAULT 'paid';

SET @db := DATABASE();

SET @has_refunded_at := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'pos_sales'
    AND COLUMN_NAME = 'refunded_at'
);
SET @ddl := IF(
  @has_refunded_at = 0,
  'ALTER TABLE `pos_sales` ADD COLUMN `refunded_at` DATETIME NULL AFTER `void_reason`',
  'SELECT \"skip pos_sales.refunded_at\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_refunded_by := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'pos_sales'
    AND COLUMN_NAME = 'refunded_by'
);
SET @ddl := IF(
  @has_refunded_by = 0,
  'ALTER TABLE `pos_sales` ADD COLUMN `refunded_by` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER `refunded_at`',
  'SELECT \"skip pos_sales.refunded_by\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_refund_reason := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'pos_sales'
    AND COLUMN_NAME = 'refund_reason'
);
SET @ddl := IF(
  @has_refund_reason = 0,
  'ALTER TABLE `pos_sales` ADD COLUMN `refund_reason` TEXT NULL AFTER `refunded_by`',
  'SELECT \"skip pos_sales.refund_reason\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_refunded_at := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'pos_sales'
    AND INDEX_NAME = 'idx_pos_sales_refunded_at'
);
SET @ddl := IF(
  @has_idx_refunded_at = 0,
  'ALTER TABLE `pos_sales` ADD KEY `idx_pos_sales_refunded_at` (`refunded_at`)',
  'SELECT \"skip pos_sales.idx_pos_sales_refunded_at\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk_refunded_by := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = @db
    AND TABLE_NAME = 'pos_sales'
    AND CONSTRAINT_NAME = 'fk_pos_sales_refunded_by_user'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @ddl := IF(
  @has_fk_refunded_by = 0,
  'ALTER TABLE `pos_sales` ADD CONSTRAINT `fk_pos_sales_refunded_by_user` FOREIGN KEY (`refunded_by`) REFERENCES `users` (`id`) ON UPDATE CASCADE',
  'SELECT \"skip pos_sales.fk_pos_sales_refunded_by_user\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
