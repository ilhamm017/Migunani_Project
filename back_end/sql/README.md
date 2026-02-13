# Manual SQL Migrations

## Add product columns for legacy inventory import and admin product editing

Run this SQL before deploying import feature:

```bash
mysql -u <user> -p <db_name> < back_end/sql/20260212_add_products_import_columns.sql
```

Example (local default):

```bash
mysql -u root -p migunani_motor_db < back_end/sql/20260212_add_products_import_columns.sql
```

## Add product-category pivot table (multi-category support)

Run this SQL to allow one product to have multiple categories:

```bash
mysql -u root -p migunani_motor_db < back_end/sql/20260213_add_product_categories_table.sql
```

## Add optional category icon field

Run this SQL to store optional icon key for category cards:

```bash
mysql -u root -p migunani_motor_db < back_end/sql/20260213_add_categories_icon_column.sql
```

## Expand `products.image_url` length

Run this SQL if update produk gagal saat menyimpan URL gambar panjang:

```bash
mysql -u root -p migunani_motor_db < back_end/sql/20260213_expand_products_image_url.sql
```

## Optional internal endpoint for local file path import

Set in `.env` (backend):

```env
IMPORT_LOCAL_PATH_ENABLED=true
IMPORT_LOCAL_PATH_ALLOWLIST=/home/thouka/Migunani_Motor_Project,/mnt/c/Users/Administrator/Downloads
```

`IMPORT_LOCAL_PATH_ALLOWLIST` is optional. If provided, `file_path` must be inside one of those directories.
