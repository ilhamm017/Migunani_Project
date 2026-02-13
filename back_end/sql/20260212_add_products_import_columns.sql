-- Manual migration for legacy inventory import fields.
-- Run this before deploying import endpoint:
--   mysql -u <user> -p <db_name> < back_end/sql/20260212_add_products_import_columns.sql

SET @db_name = DATABASE();

SET @ddl = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `products` ADD COLUMN `description` TEXT NULL',
    'SELECT "skip description"'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'products'
    AND COLUMN_NAME = 'description'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `products` ADD COLUMN `image_url` VARCHAR(255) NULL',
    'SELECT "skip image_url"'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'products'
    AND COLUMN_NAME = 'image_url'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `products` ADD COLUMN `keterangan` TEXT NULL',
    'SELECT "skip keterangan"'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'products'
    AND COLUMN_NAME = 'keterangan'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `products` ADD COLUMN `tipe_modal` VARCHAR(50) NULL',
    'SELECT "skip tipe_modal"'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'products'
    AND COLUMN_NAME = 'tipe_modal'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `products` ADD COLUMN `varian_harga` JSON NULL',
    'SELECT "skip varian_harga"'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'products'
    AND COLUMN_NAME = 'varian_harga'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `products` ADD COLUMN `grosir` JSON NULL',
    'SELECT "skip grosir"'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'products'
    AND COLUMN_NAME = 'grosir'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE `products` ADD COLUMN `total_modal` DECIMAL(15,2) NULL',
    'SELECT "skip total_modal"'
  )
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'products'
    AND COLUMN_NAME = 'total_modal'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
