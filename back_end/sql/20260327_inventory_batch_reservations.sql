-- Hard Reservation for FIFO cost-layer inventory (order allocation locks specific cost layers)
-- Date: 2026-03-27

-- 1) Add reserved quantity column to batches
ALTER TABLE `inventory_batches`
  ADD COLUMN `qty_reserved` INT NOT NULL DEFAULT 0 AFTER `qty_on_hand`,
  ADD KEY `idx_inventory_batches_product_reserved` (`product_id`, `qty_reserved`);

-- 2) Batch reservations per order item
CREATE TABLE IF NOT EXISTS `inventory_batch_reservations` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `order_id` CHAR(36) NOT NULL,
  `order_item_id` BIGINT NOT NULL,
  `product_id` CHAR(36) NOT NULL,
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
ALTER TABLE `order_items`
  ADD COLUMN `preferred_unit_cost` DECIMAL(15,4) NULL AFTER `clearance_promo_id`,
  ADD KEY `idx_order_items_preferred_unit_cost` (`preferred_unit_cost`);

