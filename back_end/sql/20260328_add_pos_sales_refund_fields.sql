-- POS Sales: refund fields (replace void button with refund)
-- Date: 2026-03-28

ALTER TABLE `pos_sales`
  MODIFY COLUMN `status` ENUM('paid', 'voided', 'refunded') NOT NULL DEFAULT 'paid',
  ADD COLUMN `refunded_at` DATETIME NULL AFTER `void_reason`,
  ADD COLUMN `refunded_by` CHAR(36) NULL AFTER `refunded_at`,
  ADD COLUMN `refund_reason` TEXT NULL AFTER `refunded_by`,
  ADD KEY `idx_pos_sales_refunded_at` (`refunded_at`),
  ADD CONSTRAINT `fk_pos_sales_refunded_by_user` FOREIGN KEY (`refunded_by`) REFERENCES `users` (`id`);

