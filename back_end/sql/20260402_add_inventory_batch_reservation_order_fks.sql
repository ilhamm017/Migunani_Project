-- Add FK constraints to prevent orphan inventory batch reservations
-- Date: 2026-04-02

-- 1) Cleanup orphan rows before adding FKs (must be safe to re-run)
DELETE r
FROM `inventory_batch_reservations` r
LEFT JOIN `orders` o ON o.`id` = r.`order_id`
WHERE o.`id` IS NULL;

DELETE r
FROM `inventory_batch_reservations` r
LEFT JOIN `order_items` oi ON oi.`id` = r.`order_item_id`
WHERE oi.`id` IS NULL;

DELETE r
FROM `inventory_batch_reservations` r
LEFT JOIN `products` p ON p.`id` = r.`product_id`
WHERE p.`id` IS NULL;

DELETE r
FROM `inventory_batch_reservations` r
LEFT JOIN `inventory_batches` b ON b.`id` = r.`batch_id`
WHERE b.`id` IS NULL;

-- 2) Resync qty_reserved to match reservations (avoid drift)
UPDATE `inventory_batches` b
LEFT JOIN (
  SELECT `batch_id`, SUM(`qty_reserved`) AS `qty`
  FROM `inventory_batch_reservations`
  GROUP BY `batch_id`
) s ON s.`batch_id` = b.`id`
SET b.`qty_reserved` = LEAST(b.`qty_on_hand`, COALESCE(s.`qty`, 0));

-- 2.5) Normalize UUID collation for FK compatibility (must be safe to re-run)
-- `orders.id` uses `utf8mb4_bin`, so referencing columns must match.
ALTER TABLE `inventory_batch_reservations`
  MODIFY COLUMN `order_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

-- 3) Add missing FKs (conditional, so migration is idempotent)
SET @schema := DATABASE();

-- FK: inventory_batch_reservations.order_id -> orders.id (cascade delete)
SELECT COUNT(*) INTO @fk_exists
FROM information_schema.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = @schema
  AND TABLE_NAME = 'inventory_batch_reservations'
  AND CONSTRAINT_NAME = 'fk_inventory_batch_reservations_order';
SET @sql := IF(
  @fk_exists = 0,
  'ALTER TABLE `inventory_batch_reservations` ADD CONSTRAINT `fk_inventory_batch_reservations_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- FK: inventory_batch_reservations.order_item_id -> order_items.id (cascade delete)
SELECT COUNT(*) INTO @fk_exists
FROM information_schema.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = @schema
  AND TABLE_NAME = 'inventory_batch_reservations'
  AND CONSTRAINT_NAME = 'fk_inventory_batch_reservations_order_item';
SET @sql := IF(
  @fk_exists = 0,
  'ALTER TABLE `inventory_batch_reservations` ADD CONSTRAINT `fk_inventory_batch_reservations_order_item` FOREIGN KEY (`order_item_id`) REFERENCES `order_items` (`id`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- FK: inventory_batch_reservations.product_id -> products.id (restrict delete)
SELECT COUNT(*) INTO @fk_exists
FROM information_schema.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = @schema
  AND TABLE_NAME = 'inventory_batch_reservations'
  AND CONSTRAINT_NAME = 'fk_inventory_batch_reservations_product';
SET @sql := IF(
  @fk_exists = 0,
  'ALTER TABLE `inventory_batch_reservations` ADD CONSTRAINT `fk_inventory_batch_reservations_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
