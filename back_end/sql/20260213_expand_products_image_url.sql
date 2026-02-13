-- Ensure products.image_url exists and supports long CDN / signed URLs
-- Safe to run multiple times

SET @schema_name = DATABASE();

SET @image_url_exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @schema_name
    AND table_name = 'products'
    AND column_name = 'image_url'
);

SET @ddl_add = IF(
  @image_url_exists = 0,
  'ALTER TABLE products ADD COLUMN image_url VARCHAR(2048) NULL AFTER description',
  'SELECT "products.image_url already exists"'
);

PREPARE stmt_add FROM @ddl_add;
EXECUTE stmt_add;
DEALLOCATE PREPARE stmt_add;

SET @ddl_modify = 'ALTER TABLE products MODIFY COLUMN image_url VARCHAR(2048) NULL';
PREPARE stmt_modify FROM @ddl_modify;
EXECUTE stmt_modify;
DEALLOCATE PREPARE stmt_modify;
