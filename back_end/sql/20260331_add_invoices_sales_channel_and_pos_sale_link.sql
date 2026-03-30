-- Add invoices.sales_channel + invoices.pos_sale_id link to POS sales
-- Date: 2026-03-31
-- Idempotent migration (MySQL 8)

SET @db := DATABASE();

-- 1) Add `sales_channel` column (app vs pos)
SET @has_sales_channel := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'invoices'
    AND COLUMN_NAME = 'sales_channel'
);

SET @ddl := IF(
  @has_sales_channel = 0,
  "ALTER TABLE `invoices` ADD COLUMN `sales_channel` ENUM('app','pos') NOT NULL DEFAULT 'app' AFTER `customer_id`",
  "SELECT 'skip invoices.sales_channel'"
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) Add `pos_sale_id` column
SET @has_pos_sale_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'invoices'
    AND COLUMN_NAME = 'pos_sale_id'
);

SET @ddl := IF(
  @has_pos_sale_id = 0,
  "ALTER TABLE `invoices` ADD COLUMN `pos_sale_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL AFTER `sales_channel`",
  "SELECT 'skip invoices.pos_sale_id'"
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 3) Unique index on pos_sale_id (allow multiple NULL)
SET @has_uniq_pos_sale_id := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'invoices'
    AND INDEX_NAME = 'uniq_invoices_pos_sale_id'
);

SET @ddl := IF(
  @has_uniq_pos_sale_id = 0,
  "ALTER TABLE `invoices` ADD UNIQUE KEY `uniq_invoices_pos_sale_id` (`pos_sale_id`)",
  "SELECT 'skip uniq_invoices_pos_sale_id'"
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4) Foreign key invoices.pos_sale_id -> pos_sales.id
SET @has_fk_pos_sale := (
  SELECT COUNT(*)
  FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = @db
    AND TABLE_NAME = 'invoices'
    AND CONSTRAINT_NAME = 'fk_invoices_pos_sale'
);

SET @ddl := IF(
  @has_fk_pos_sale = 0,
  "ALTER TABLE `invoices` ADD CONSTRAINT `fk_invoices_pos_sale` FOREIGN KEY (`pos_sale_id`) REFERENCES `pos_sales` (`id`) ON DELETE SET NULL ON UPDATE CASCADE",
  "SELECT 'skip fk_invoices_pos_sale'"
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

