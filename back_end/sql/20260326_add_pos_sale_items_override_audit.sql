-- POS Sale Items: audit price overrides (snapshot + reason)
-- Date: 2026-03-26

-- NOTE: MySQL 8 does not support `ADD COLUMN IF NOT EXISTS`.
-- This migration is written to be idempotent via information_schema checks.

SET @db := DATABASE();

SET @has_unit_price_normal_snapshot := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'pos_sale_items'
    AND COLUMN_NAME = 'unit_price_normal_snapshot'
);
SET @ddl := IF(
  @has_unit_price_normal_snapshot = 0,
  'ALTER TABLE `pos_sale_items` ADD COLUMN `unit_price_normal_snapshot` DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER `qty`',
  'SELECT \"skip pos_sale_items.unit_price_normal_snapshot\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_unit_price_override := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'pos_sale_items'
    AND COLUMN_NAME = 'unit_price_override'
);
SET @ddl := IF(
  @has_unit_price_override = 0,
  'ALTER TABLE `pos_sale_items` ADD COLUMN `unit_price_override` DECIMAL(15,2) NULL AFTER `unit_price_normal_snapshot`',
  'SELECT \"skip pos_sale_items.unit_price_override\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_override_reason := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'pos_sale_items'
    AND COLUMN_NAME = 'override_reason'
);
SET @ddl := IF(
  @has_override_reason = 0,
  'ALTER TABLE `pos_sale_items` ADD COLUMN `override_reason` TEXT NULL AFTER `unit_price_override`',
  'SELECT \"skip pos_sale_items.override_reason\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
