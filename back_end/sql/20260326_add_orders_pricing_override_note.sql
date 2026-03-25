-- Add admin-only order-level negotiated pricing note
-- Used by manual order negotiated pricing feature (admin/kasir/super_admin).

ALTER TABLE `orders`
  ADD COLUMN `pricing_override_note` TEXT NULL AFTER `discount_amount`;

