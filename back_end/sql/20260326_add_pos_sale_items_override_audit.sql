-- POS Sale Items: audit price overrides (snapshot + reason)
-- Date: 2026-03-26

ALTER TABLE `pos_sale_items`
  ADD COLUMN `unit_price_normal_snapshot` DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER `qty`,
  ADD COLUMN `unit_price_override` DECIMAL(15,2) NULL AFTER `unit_price_normal_snapshot`,
  ADD COLUMN `override_reason` TEXT NULL AFTER `unit_price_override`;

