-- NOTE: MySQL 8 does not support `ADD COLUMN IF NOT EXISTS`.
-- This migration is written to be idempotent via information_schema checks.

SET @db := DATABASE();

SET @has_qty_canceled_manual := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'qty_canceled_manual'
);

SET @ddl := IF(
  @has_qty_canceled_manual = 0,
  'ALTER TABLE `order_items` ADD COLUMN `qty_canceled_manual` INT NOT NULL DEFAULT 0 AFTER `qty_canceled_backorder`',
  'SELECT \"skip order_items.qty_canceled_manual\"'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE order_items
SET qty_canceled_manual = 0
WHERE qty_canceled_manual IS NULL;
