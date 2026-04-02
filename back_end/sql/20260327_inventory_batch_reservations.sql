-- Hard Reservation for FIFO cost-layer inventory (order allocation locks specific cost layers)
-- Date: 2026-03-27

-- 1) Add reserved quantity column to batches
-- NOTE: MySQL 8 does not support `ADD COLUMN IF NOT EXISTS`.
-- This migration is written to be idempotent via information_schema checks.

SET @db := DATABASE();

SET @has_qty_reserved := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'inventory_batches'
    AND COLUMN_NAME = 'qty_reserved'
);
SET @ddl := IF(
  @has_qty_reserved = 0,
  'ALTER TABLE `inventory_batches` ADD COLUMN `qty_reserved` INT NOT NULL DEFAULT 0 AFTER `qty_on_hand`',
  'SELECT \"skip inventory_batches.qty_reserved\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_inventory_batches_product_reserved := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'inventory_batches'
    AND INDEX_NAME = 'idx_inventory_batches_product_reserved'
);
SET @ddl := IF(
  @has_idx_inventory_batches_product_reserved = 0,
  'ALTER TABLE `inventory_batches` ADD KEY `idx_inventory_batches_product_reserved` (`product_id`, `qty_reserved`)',
  'SELECT \"skip inventory_batches.idx_inventory_batches_product_reserved\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) Batch reservations per order item
CREATE TABLE IF NOT EXISTS `inventory_batch_reservations` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `order_id` CHAR(36) NOT NULL,
  `order_item_id` BIGINT NOT NULL,
  `product_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `batch_id` BIGINT NOT NULL,
  `qty_reserved` INT NOT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reservation_item_batch` (`order_item_id`, `batch_id`),
  KEY `idx_inventory_batch_reservations_order` (`order_id`),
  KEY `idx_inventory_batch_reservations_order_item` (`order_item_id`),
  KEY `idx_inventory_batch_reservations_product` (`product_id`),
  KEY `idx_inventory_batch_reservations_batch` (`batch_id`),
  CONSTRAINT `fk_inventory_batch_reservations_batch` FOREIGN KEY (`batch_id`) REFERENCES `inventory_batches` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_inventory_batch_reservations_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) Optional per-order cost layer preference on order items (admin-only)
SET @has_preferred_unit_cost := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'order_items'
    AND COLUMN_NAME = 'preferred_unit_cost'
);
SET @ddl := IF(
  @has_preferred_unit_cost = 0,
  'ALTER TABLE `order_items` ADD COLUMN `preferred_unit_cost` DECIMAL(15,4) NULL AFTER `clearance_promo_id`',
  'SELECT \"skip order_items.preferred_unit_cost\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_idx_order_items_preferred_unit_cost := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'order_items'
    AND INDEX_NAME = 'idx_order_items_preferred_unit_cost'
);
SET @ddl := IF(
  @has_idx_order_items_preferred_unit_cost = 0,
  'ALTER TABLE `order_items` ADD KEY `idx_order_items_preferred_unit_cost` (`preferred_unit_cost`)',
  'SELECT \"skip order_items.idx_order_items_preferred_unit_cost\"'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
