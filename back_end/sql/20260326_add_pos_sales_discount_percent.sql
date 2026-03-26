-- POS Sales: add order-level discount percent
-- Date: 2026-03-26

ALTER TABLE `pos_sales`
  ADD COLUMN `discount_percent` DECIMAL(6,3) NOT NULL DEFAULT 0 AFTER `discount_amount`;

