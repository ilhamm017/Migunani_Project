-- FIFO cost-layer inventory + clearance promos
-- Date: 2026-03-27

-- 1) Cost layers (batches/lots)
CREATE TABLE IF NOT EXISTS `inventory_batches` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `product_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `unit_cost` DECIMAL(15,4) NOT NULL,
  `qty_on_hand` INT NOT NULL DEFAULT 0,
  `source_type` VARCHAR(32) NULL,
  `source_id` VARCHAR(64) NULL,
  `note` TEXT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_inventory_batches_product` (`product_id`),
  KEY `idx_inventory_batches_product_unit_cost` (`product_id`, `unit_cost`),
  CONSTRAINT `fk_inventory_batches_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) Batch consumption audit (FIFO usage)
CREATE TABLE IF NOT EXISTS `inventory_batch_consumptions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `batch_id` BIGINT NOT NULL,
  `product_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `qty` INT NOT NULL,
  `unit_cost` DECIMAL(15,4) NOT NULL,
  `total_cost` DECIMAL(15,4) NOT NULL,
  `reference_type` VARCHAR(32) NOT NULL,
  `reference_id` VARCHAR(64) NOT NULL,
  `order_item_id` BIGINT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_inventory_batch_consumptions_batch` (`batch_id`),
  KEY `idx_inventory_batch_consumptions_product` (`product_id`),
  KEY `idx_inventory_batch_consumptions_order_item` (`order_item_id`),
  KEY `idx_inventory_batch_consumptions_reference` (`reference_type`, `reference_id`),
  CONSTRAINT `fk_inventory_batch_consumptions_batch` FOREIGN KEY (`batch_id`) REFERENCES `inventory_batches` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_inventory_batch_consumptions_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) Clearance promo ("cepat habis") that targets a specific cost layer
CREATE TABLE IF NOT EXISTS `clearance_promos` (
  `id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `product_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `target_unit_cost` DECIMAL(15,4) NOT NULL,
  `pricing_mode` ENUM('fixed_price','percent_off') NOT NULL,
  `promo_unit_price` DECIMAL(15,2) NULL,
  `discount_pct` DECIMAL(5,2) NULL,
  `starts_at` DATETIME NOT NULL,
  `ends_at` DATETIME NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by` CHAR(36) NULL,
  `updated_by` CHAR(36) NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_clearance_promos_product` (`product_id`),
  KEY `idx_clearance_promos_active_window` (`is_active`, `starts_at`, `ends_at`),
  CONSTRAINT `fk_clearance_promos_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4) Link promo to transactions
ALTER TABLE `order_items`
  ADD COLUMN `clearance_promo_id` CHAR(36) NULL AFTER `product_id`,
  ADD KEY `idx_order_items_clearance_promo_id` (`clearance_promo_id`);

ALTER TABLE `pos_sale_items`
  ADD COLUMN `clearance_promo_id` CHAR(36) NULL AFTER `product_id`,
  ADD KEY `idx_pos_sale_items_clearance_promo_id` (`clearance_promo_id`);

-- 5) Optional bootstrap: create 1 cost layer per product from existing moving-average state.
-- This keeps the system usable immediately after migration for existing on-hand inventory.
INSERT INTO `inventory_batches` (`product_id`, `unit_cost`, `qty_on_hand`, `source_type`, `source_id`, `note`)
SELECT
  pcs.`product_id`,
  pcs.`avg_cost`,
  pcs.`on_hand_qty`,
  'legacy_bootstrap',
  NULL,
  'Bootstrap from product_cost_states (moving average)'
FROM `product_cost_states` pcs
WHERE pcs.`on_hand_qty` > 0
  AND NOT EXISTS (
    SELECT 1
    FROM `inventory_batches` b
    WHERE b.`product_id` = pcs.`product_id`
      AND b.`source_type` = 'legacy_bootstrap'
  );
