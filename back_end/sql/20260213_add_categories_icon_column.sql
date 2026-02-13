-- Add optional icon key for category cards in frontend
-- Safe to run multiple times

SET @schema_name = DATABASE();

SET @icon_exists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @schema_name
    AND table_name = 'categories'
    AND column_name = 'icon'
);

SET @ddl = IF(
  @icon_exists = 0,
  'ALTER TABLE categories ADD COLUMN icon VARCHAR(50) NULL AFTER description',
  'SELECT "categories.icon already exists"'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
