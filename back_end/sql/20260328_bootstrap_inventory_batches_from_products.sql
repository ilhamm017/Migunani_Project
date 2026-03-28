-- Bootstrap FIFO inventory batches from legacy product stock
-- Date: 2026-03-28
--
-- Purpose:
-- Some older databases may have `products.stock_quantity` / `products.allocated_quantity` populated,
-- but `product_cost_states` and/or `inventory_batches` are empty (freshly created by Sequelize sync).
-- This causes outbound cost posting to fail with:
--   "Insufficient inventory batches ... Run SQL migration bootstrap if needed."
--
-- This script is designed to be idempotent and conservative:
-- - It only bootstraps for products that have NO batches yet.
-- - It prefers `products.base_price` as the legacy unit cost (fallback: `total_modal`, else 0).
--
-- Notes:
-- - Physical on-hand approximation uses `stock_quantity + allocated_quantity`.
-- - For accurate FIFO layers, record real inbound purchases going forward.

-- 1) Ensure product cost state table exists (for DBs that never created it yet).
CREATE TABLE IF NOT EXISTS `product_cost_states` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `product_id` CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `on_hand_qty` INT NOT NULL DEFAULT 0,
  `avg_cost` DECIMAL(15,4) NOT NULL DEFAULT 0,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_product_cost_states_product_id` (`product_id`),
  CONSTRAINT `fk_product_cost_states_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) Bootstrap missing cost states for products that have stock but no batches yet.
INSERT INTO `product_cost_states` (`product_id`, `on_hand_qty`, `avg_cost`, `createdAt`, `updatedAt`)
SELECT
  p.`id`,
  (p.`stock_quantity` + p.`allocated_quantity`) AS on_hand_qty,
  COALESCE(NULLIF(p.`base_price`, 0), NULLIF(p.`total_modal`, 0), 0) AS avg_cost,
  NOW(),
  NOW()
FROM `products` p
WHERE (p.`stock_quantity` + p.`allocated_quantity`) > 0
  AND NOT EXISTS (
    SELECT 1 FROM `inventory_batches` b WHERE b.`product_id` = p.`id`
  )
  AND NOT EXISTS (
    SELECT 1 FROM `product_cost_states` pcs WHERE pcs.`product_id` = p.`id`
  );

-- 3) If a cost state exists but is still zero (fresh default), backfill it when there are no batches.
UPDATE `product_cost_states` pcs
JOIN `products` p ON p.`id` = pcs.`product_id`
LEFT JOIN (
  SELECT `product_id`, SUM(`qty_on_hand`) AS qty_sum
  FROM `inventory_batches`
  GROUP BY `product_id`
) b ON b.`product_id` = pcs.`product_id`
SET
  pcs.`on_hand_qty` = (p.`stock_quantity` + p.`allocated_quantity`),
  pcs.`avg_cost` = COALESCE(NULLIF(p.`base_price`, 0), NULLIF(p.`total_modal`, 0), pcs.`avg_cost`),
  pcs.`updatedAt` = NOW()
WHERE (p.`stock_quantity` + p.`allocated_quantity`) > 0
  AND (b.`qty_sum` IS NULL OR b.`qty_sum` <= 0)
  AND pcs.`on_hand_qty` = 0;

-- 4) Create a single legacy bootstrap batch per product (only when the product still has no batches).
INSERT INTO `inventory_batches` (`product_id`, `unit_cost`, `qty_on_hand`, `source_type`, `source_id`, `note`)
SELECT
  pcs.`product_id`,
  pcs.`avg_cost`,
  pcs.`on_hand_qty`,
  'legacy_bootstrap',
  NULL,
  'Bootstrap from products.stock_quantity + allocated_quantity (legacy)'
FROM `product_cost_states` pcs
WHERE pcs.`on_hand_qty` > 0
  AND NOT EXISTS (
    SELECT 1
    FROM `inventory_batches` b
    WHERE b.`product_id` = pcs.`product_id`
  );

