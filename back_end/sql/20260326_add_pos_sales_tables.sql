-- POS Sales (Kasir Offline) schema
-- Date: 2026-03-26

CREATE TABLE IF NOT EXISTS `pos_sales` (
  `id` CHAR(36) NOT NULL,
  `receipt_no` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `receipt_number` VARCHAR(32) GENERATED ALWAYS AS (CONCAT('POS-', LPAD(`receipt_no`, 9, '0'))) STORED,
  `cashier_user_id` CHAR(36) NOT NULL,
  `customer_name` VARCHAR(255) NULL,
  `note` TEXT NULL,
  `status` ENUM('paid', 'voided') NOT NULL DEFAULT 'paid',
  `subtotal` DECIMAL(15,2) NOT NULL DEFAULT 0,
  `discount_amount` DECIMAL(15,2) NOT NULL DEFAULT 0,
  `tax_percent` DECIMAL(6,3) NOT NULL DEFAULT 0,
  `tax_amount` DECIMAL(15,2) NOT NULL DEFAULT 0,
  `total` DECIMAL(15,2) NOT NULL DEFAULT 0,
  `amount_received` DECIMAL(15,2) NOT NULL DEFAULT 0,
  `change_amount` DECIMAL(15,2) NOT NULL DEFAULT 0,
  `paid_at` DATETIME NOT NULL,
  `voided_at` DATETIME NULL,
  `voided_by` CHAR(36) NULL,
  `void_reason` TEXT NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_pos_sales_receipt_no` (`receipt_no`),
  UNIQUE KEY `uniq_pos_sales_receipt_number` (`receipt_number`),
  KEY `idx_pos_sales_cashier_paid_at` (`cashier_user_id`, `paid_at`),
  KEY `idx_pos_sales_paid_at` (`paid_at`),
  CONSTRAINT `fk_pos_sales_cashier_user` FOREIGN KEY (`cashier_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pos_sale_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `pos_sale_id` CHAR(36) NOT NULL,
  `product_id` CHAR(36) NOT NULL,
  `sku_snapshot` VARCHAR(64) NOT NULL,
  `name_snapshot` VARCHAR(255) NOT NULL,
  `unit_snapshot` VARCHAR(32) NOT NULL DEFAULT 'Pcs',
  `qty` INT NOT NULL,
  `unit_price` DECIMAL(15,2) NOT NULL,
  `line_total` DECIMAL(15,2) NOT NULL,
  `unit_cost` DECIMAL(15,4) NOT NULL DEFAULT 0,
  `cogs_total` DECIMAL(15,4) NOT NULL DEFAULT 0,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pos_sale_items_sale` (`pos_sale_id`),
  KEY `idx_pos_sale_items_product` (`product_id`),
  CONSTRAINT `fk_pos_sale_items_sale` FOREIGN KEY (`pos_sale_id`) REFERENCES `pos_sales` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_pos_sale_items_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

