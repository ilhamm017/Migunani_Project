-- Add admin-only order-level negotiated pricing note
-- Used by manual order negotiated pricing feature (admin/kasir/super_admin).

-- Idempotent (safe on MySQL):
SET @db := DATABASE();

SET @has_pricing_override_note := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'orders'
    AND COLUMN_NAME = 'pricing_override_note'
);

SET @ddl := IF(
  @has_pricing_override_note = 0,
  'ALTER TABLE `orders` ADD COLUMN `pricing_override_note` TEXT NULL AFTER `discount_amount`',
  'SELECT \"skip orders.pricing_override_note\"'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
