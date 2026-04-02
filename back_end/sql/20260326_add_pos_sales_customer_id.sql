-- POS Sales: link underpay sales to a registered customer
-- Date: 2026-03-26

-- NOTE: MySQL 8 does not support `ADD COLUMN IF NOT EXISTS`.
-- This migration is written to be idempotent via information_schema checks.

SET @db := DATABASE();

SET @has_customer_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'pos_sales'
    AND COLUMN_NAME = 'customer_id'
);
SET @ddl := IF(
  @has_customer_id = 0,
  'ALTER TABLE `pos_sales` ADD COLUMN `customer_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER `cashier_user_id`',
  'SELECT \"skip pos_sales.customer_id\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'pos_sales'
    AND INDEX_NAME = 'idx_pos_sales_customer_id'
);
SET @ddl := IF(
  @has_idx = 0,
  'ALTER TABLE `pos_sales` ADD KEY `idx_pos_sales_customer_id` (`customer_id`)',
  'SELECT \"skip pos_sales.idx_pos_sales_customer_id\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_fk := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = @db
    AND TABLE_NAME = 'pos_sales'
    AND CONSTRAINT_NAME = 'fk_pos_sales_customer_user'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @ddl := IF(
  @has_fk = 0,
  'ALTER TABLE `pos_sales` ADD CONSTRAINT `fk_pos_sales_customer_user` FOREIGN KEY (`customer_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE',
  'SELECT \"skip pos_sales.fk_pos_sales_customer_user\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
