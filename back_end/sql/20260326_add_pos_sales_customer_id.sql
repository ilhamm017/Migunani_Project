-- POS Sales: link underpay sales to a registered customer
-- Date: 2026-03-26

ALTER TABLE `pos_sales`
  ADD COLUMN `customer_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER `cashier_user_id`,
  ADD KEY `idx_pos_sales_customer_id` (`customer_id`),
  ADD CONSTRAINT `fk_pos_sales_customer_user` FOREIGN KEY (`customer_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE;
