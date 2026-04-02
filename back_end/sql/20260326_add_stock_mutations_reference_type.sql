-- Stock mutations: add reference_type for better traceability
-- Date: 2026-03-26

-- NOTE: MySQL 8 does not support `ADD COLUMN IF NOT EXISTS`.
-- This migration is written to be idempotent via information_schema checks.

SET @db := DATABASE();

SET @has_reference_type := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'stock_mutations'
    AND COLUMN_NAME = 'reference_type'
);
SET @ddl := IF(
  @has_reference_type = 0,
  'ALTER TABLE `stock_mutations` ADD COLUMN `reference_type` VARCHAR(64) NULL AFTER `qty`',
  'SELECT \"skip stock_mutations.reference_type\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'stock_mutations'
    AND INDEX_NAME = 'idx_stock_mutations_reference'
);
SET @ddl := IF(
  @has_idx = 0,
  'ALTER TABLE `stock_mutations` ADD KEY `idx_stock_mutations_reference` (`reference_type`, `reference_id`)',
  'SELECT \"skip stock_mutations.idx_stock_mutations_reference\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
