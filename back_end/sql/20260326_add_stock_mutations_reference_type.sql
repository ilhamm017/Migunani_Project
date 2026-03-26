-- Stock mutations: add reference_type for better traceability
-- Date: 2026-03-26

ALTER TABLE `stock_mutations`
  ADD COLUMN `reference_type` VARCHAR(64) NULL AFTER `qty`,
  ADD KEY `idx_stock_mutations_reference` (`reference_type`, `reference_id`);

