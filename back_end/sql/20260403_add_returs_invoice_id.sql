-- Add invoice_id to returs to disambiguate multi-invoice orders
-- Date: 2026-04-03

SET @schema := DATABASE();

-- 1) Add column if missing
SELECT COUNT(*) INTO @col_exists
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'returs'
  AND COLUMN_NAME = 'invoice_id';

SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE `returs` ADD COLUMN `invoice_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER `order_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.5) Normalize collation for FK compatibility (must be safe to re-run)
-- `invoices.id` uses `utf8mb4_bin`, so referencing columns must match.
ALTER TABLE `returs`
  MODIFY COLUMN `invoice_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL;

-- 2) Backfill best-effort: set latest invoice per order for legacy rows (keeps old behavior)
-- Only fills rows that are still NULL.
UPDATE `returs` r
JOIN (
  SELECT
    oi.`order_id` AS `order_id`,
    ii.`invoice_id` AS `invoice_id`,
    MAX(inv.`createdAt`) AS `latest_created`
  FROM `invoice_items` ii
  JOIN `order_items` oi ON oi.`id` = ii.`order_item_id`
  JOIN `invoices` inv ON inv.`id` = ii.`invoice_id`
  GROUP BY oi.`order_id`, ii.`invoice_id`
) x ON x.`order_id` = r.`order_id`
JOIN (
  SELECT
    oi.`order_id` AS `order_id`,
    MAX(inv.`createdAt`) AS `latest_created`
  FROM `invoice_items` ii
  JOIN `order_items` oi ON oi.`id` = ii.`order_item_id`
  JOIN `invoices` inv ON inv.`id` = ii.`invoice_id`
  GROUP BY oi.`order_id`
) y ON y.`order_id` = r.`order_id` AND y.`latest_created` = x.`latest_created`
SET r.`invoice_id` = x.`invoice_id`
WHERE r.`invoice_id` IS NULL;

-- 3) Add index if missing
SELECT COUNT(*) INTO @idx_exists
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME = 'returs'
  AND INDEX_NAME = 'idx_returs_invoice_id';

SET @sql := IF(
  @idx_exists = 0,
  'ALTER TABLE `returs` ADD INDEX `idx_returs_invoice_id` (`invoice_id`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) Add FK if missing (set null on invoice delete)
SELECT COUNT(*) INTO @fk_exists
FROM information_schema.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = @schema
  AND TABLE_NAME = 'returs'
  AND CONSTRAINT_NAME = 'fk_returs_invoice';

SET @sql := IF(
  @fk_exists = 0,
  'ALTER TABLE `returs` ADD CONSTRAINT `fk_returs_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
