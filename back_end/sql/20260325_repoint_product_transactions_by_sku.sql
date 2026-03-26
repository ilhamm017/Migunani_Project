-- Repoint product references in transaction tables from one SKU to another.
-- Edit the two SKU values below, then run:
--   mysql -u root -p migunani_motor_db < back_end/sql/20260325_repoint_product_transactions_by_sku.sql
--
-- MANUAL_ONLY: This is a data-fix script and is intentionally excluded from automated migration runners.

START TRANSACTION;

SET @from_sku := 'SR-1CB3AA14AD';
SET @to_sku := '550049044';

SET @from_product_id := (SELECT id FROM products WHERE sku = @from_sku LIMIT 1);
SET @to_product_id := (SELECT id FROM products WHERE sku = @to_sku LIMIT 1);

-- Sanity check (should show both IDs as NOT NULL)
SELECT
  @from_sku AS from_sku,
  @from_product_id AS from_product_id,
  @to_sku AS to_sku,
  @to_product_id AS to_product_id;

UPDATE order_items
SET product_id = @to_product_id
WHERE product_id = @from_product_id;

UPDATE order_allocations
SET product_id = @to_product_id
WHERE product_id = @from_product_id;

UPDATE cart_items
SET product_id = @to_product_id
WHERE product_id = @from_product_id;

UPDATE stock_mutations
SET product_id = @to_product_id
WHERE product_id = @from_product_id;

UPDATE stock_opname_items
SET product_id = @to_product_id
WHERE product_id = @from_product_id;

UPDATE purchase_order_items
SET product_id = @to_product_id
WHERE product_id = @from_product_id;

UPDATE returs
SET product_id = @to_product_id
WHERE product_id = @from_product_id;

UPDATE inventory_cost_ledger
SET product_id = @to_product_id
WHERE product_id = @from_product_id;

UPDATE credit_note_lines
SET product_id = @to_product_id
WHERE product_id = @from_product_id;

COMMIT;
