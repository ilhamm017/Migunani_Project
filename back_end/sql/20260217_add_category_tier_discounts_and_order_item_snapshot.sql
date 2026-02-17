-- Add category-level tier discount columns and order item pricing snapshot
-- Safe to run multiple times

SET @schema_name = DATABASE();

SET @category_regular_exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @schema_name
    AND table_name = 'categories'
    AND column_name = 'discount_regular_pct'
);

SET @ddl = IF(
  @category_regular_exists = 0,
  'ALTER TABLE categories ADD COLUMN discount_regular_pct DECIMAL(5,2) NULL AFTER icon',
  'SELECT "categories.discount_regular_pct already exists"'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @category_gold_exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @schema_name
    AND table_name = 'categories'
    AND column_name = 'discount_gold_pct'
);

SET @ddl = IF(
  @category_gold_exists = 0,
  'ALTER TABLE categories ADD COLUMN discount_gold_pct DECIMAL(5,2) NULL AFTER discount_regular_pct',
  'SELECT "categories.discount_gold_pct already exists"'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @category_premium_exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @schema_name
    AND table_name = 'categories'
    AND column_name = 'discount_premium_pct'
);

SET @ddl = IF(
  @category_premium_exists = 0,
  'ALTER TABLE categories ADD COLUMN discount_premium_pct DECIMAL(5,2) NULL AFTER discount_gold_pct',
  'SELECT "categories.discount_premium_pct already exists"'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @order_item_snapshot_exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @schema_name
    AND table_name = 'order_items'
    AND column_name = 'pricing_snapshot'
);

SET @ddl = IF(
  @order_item_snapshot_exists = 0,
  'ALTER TABLE order_items ADD COLUMN pricing_snapshot JSON NULL AFTER cost_at_purchase',
  'SELECT "order_items.pricing_snapshot already exists"'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
