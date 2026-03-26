-- POS Sales: add order-level discount percent
-- Date: 2026-03-26

-- Idempotent (safe on MySQL):
SET @db := DATABASE();

SET @has_discount_percent := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'pos_sales'
    AND COLUMN_NAME = 'discount_percent'
);

SET @ddl := IF(
  @has_discount_percent = 0,
  'ALTER TABLE `pos_sales` ADD COLUMN `discount_percent` DECIMAL(6,3) NOT NULL DEFAULT 0 AFTER `discount_amount`',
  'SELECT \"skip pos_sales.discount_percent\"'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
