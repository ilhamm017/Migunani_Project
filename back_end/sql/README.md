# Manual SQL Migrations

## TL;DR (recommended)

Mulai Tahap 2, migrasi schema sebaiknya dijalankan lewat runner (idempotent) agar deployment terkontrol:

Dev (ts-node):

```bash
cd back_end
npm run migrate:up:with-sql
```

Production (Node dist / image `runner`):

```bash
cd back_end
npm run build
npm run migrate:up:with-sql:prod
```

`--with-sql` akan tetap menjalankan seluruh SQL legacy di folder ini (pakai tabel tracker `manual_sql_migrations`) supaya tidak perlu menjalankan file satu per satu.

Catatan:
- File-file SQL di folder ini masih dipertahankan untuk kompatibilitas, tapi cara pakai yang disarankan adalah lewat runner di atas.

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

## Add category tier discounts + order item pricing snapshot

Run this SQL to enable category-level tier discounts with tier fallback snapshot on checkout:

```bash
mysql -u root -p migunani_motor_db < back_end/sql/20260217_add_category_tier_discounts_and_order_item_snapshot.sql
```

## Repoint transaksi dari SKU lama ke SKU baru

Jika ada transaksi yang masih menunjuk ke produk dengan SKU yang salah/lama, gunakan SQL ini untuk memindahkan semua `product_id` di tabel transaksi ke produk SKU baru:

```bash
mysql -u root -p migunani_motor_db < back_end/sql/20260325_repoint_product_transactions_by_sku.sql
```

## Add retur handover driver debt snapshot

Jalankan SQL ini untuk menambah kolom snapshot hutang driver pada tabel `retur_handovers` (dipakai untuk audit riwayat serah-terima retur dan halaman riwayat setoran driver):

```bash
mysql -u root -p migunani_motor_db < back_end/sql/20260325_add_retur_handovers_driver_debt_snapshot.sql
```

Catatan:
- Migrasi ini dijalankan **sekali per database** (production/staging/local). Deploy ulang backend tidak otomatis menjalankan migrasi.
- Model Sequelize **tidak** otomatis menambah kolom di DB (kecuali kamu sengaja mengaktifkan mode sync/alter), jadi migrasi SQL tetap diperlukan.
- Backend juga memiliki startup check yang akan mencoba menambahkan kolom ini secara otomatis saat start (butuh hak `ALTER`), tapi tetap disarankan menjalankan SQL migrasi agar proses deployment terkontrol.

## Add COD settlements audit columns

Jalankan SQL ini untuk menambah kolom audit pada tabel `cod_settlements` (dipakai oleh endpoint `/admin/driver-deposit/history`):

```bash
mysql -u root -p migunani_motor_db < back_end/sql/20260325_add_cod_settlements_audit_columns.sql
```

## Add order pricing override note (nego)

Jalankan SQL ini untuk menambah kolom catatan nego level order (`orders.pricing_override_note`) yang dipakai saat admin/kasir membuat order manual dengan harga deal:

```bash
mysql -u root -p migunani_motor_db < back_end/sql/20260326_add_orders_pricing_override_note.sql
```

## Add POS sales tables (Kasir Offline)

Jalankan SQL ini untuk menambah tabel POS kasir offline (`pos_sales`, `pos_sale_items`) untuk transaksi eceran di toko:

```bash
mysql -u root -p migunani_motor_db < back_end/sql/20260326_add_pos_sales_tables.sql
```

## Add POS discount percent (Kasir Offline)

Jalankan SQL ini untuk menambah kolom diskon persen pada `pos_sales`:

```bash
mysql -u root -p migunani_motor_db < back_end/sql/20260326_add_pos_sales_discount_percent.sql
```

## Add POS customer link (Kasir Offline)

Jalankan SQL ini untuk menambah `customer_id` pada `pos_sales` (wajib dipilih jika transaksi POS kurang bayar / hutang):

```bash
mysql -u root -p migunani_motor_db < back_end/sql/20260326_add_pos_sales_customer_id.sql
```

## Add POS journaling status fields (Kasir Offline)

Jalankan SQL ini untuk menambah kolom status journaling pada `pos_sales` (untuk audit jika posting jurnal gagal):

```bash
mysql -u root -p migunani_motor_db < back_end/sql/20260326_add_pos_sales_journaling_fields.sql
```

## Add stock mutations reference type (Traceability)

Jalankan SQL ini untuk menambah `reference_type` pada `stock_mutations` (agar mutasi stok bisa ditelusuri lintas modul):

```bash
mysql -u root -p migunani_motor_db < back_end/sql/20260326_add_stock_mutations_reference_type.sql
```

## Add POS sale items override audit fields (Kasir Offline)

Jalankan SQL ini untuk menambah kolom audit override harga pada `pos_sale_items`:

```bash
mysql -u root -p migunani_motor_db < back_end/sql/20260326_add_pos_sale_items_override_audit.sql
```

## Add POS refund fields (Kasir Offline)

Jalankan SQL ini untuk menambah field refund pada `pos_sales` (pengganti tombol void di POS):

```bash
mysql -u root -p migunani_motor_db < back_end/sql/20260328_add_pos_sales_refund_fields.sql
```

## Link POS sales to invoices (POS punya invoice_id + nomor invoice khusus)

Jalankan SQL ini untuk menambah:
- `invoices.sales_channel` (`app` vs `pos`)
- `invoices.pos_sale_id` + FK ke `pos_sales`

```bash
mysql -u root -p migunani_motor_db < back_end/sql/20260331_add_invoices_sales_channel_and_pos_sale_link.sql
```

## Track POS underpay (hutang) in customer balance entries

Jalankan SQL ini untuk menambah enum `entry_type` pada `customer_balance_entries` agar hutang POS ikut tampil di halaman Info Customer (Saldo Customer):

```bash
mysql -u root -p migunani_motor_db < back_end/sql/20260331_add_customer_balance_entries_pos_underpay_types.sql
```

Jika kamu sudah punya transaksi POS kurang bayar sebelum patch ini, jalankan backfill (one-shot) berikut agar hutang lama ikut muncul di Info Customer:

```bash
mysql -u root -p migunani_motor_db < back_end/sql/20260331_backfill_customer_balance_entries_pos_underpay.sql
```

## Bootstrap FIFO inventory batches dari stok legacy (fix "Insufficient inventory batches")

Jika kamu sudah punya stok di `products.stock_quantity` / `products.allocated_quantity`, tapi modul FIFO baru (tabel `product_cost_states` + `inventory_batches`) masih kosong, posting goods out bisa gagal dengan pesan:

`Insufficient inventory batches ... Run SQL migration bootstrap if needed.`

Jalankan SQL ini untuk melakukan bootstrap **konservatif** (hanya untuk produk yang belum punya batch sama sekali):

```bash
mysql -u root -p migunani_motor_db < back_end/sql/20260328_bootstrap_inventory_batches_from_products.sql
```

## One-shot: run all safe SQL migrations (recommended)

Jika ingin deploy ulang tanpa menjalankan file SQL satu per satu, gunakan runner ini. Runner akan:
- Menjalankan semua file `*.sql` di folder ini secara berurutan (berdasarkan nama file).
- Men-skip file yang ditandai `MANUAL_ONLY` atau yang termasuk data-fix manual.
- Menyimpan histori di tabel `manual_sql_migrations` agar tidak double-run.

Dev (ts-node):

```bash
cd back_end
npm run migrate:sql
```

Production (setelah `npm run build` / image `runner`):

```bash
cd back_end
npm run migrate:sql:prod
```

Catatan:
- Jalankan runner ini hanya untuk migrasi yang idempotent & aman. Untuk skrip data-fix, tetap jalankan manual sesuai instruksi file masing-masing.
- Runner ini menggunakan tabel `manual_sql_migrations` untuk mencegah double-run.

## Add FIFO cost layers + clearance promos (Promo "Cepat Habis")

Jalankan SQL ini untuk menambah:
- `inventory_batches` + `inventory_batch_consumptions` (cost layer FIFO)
- `clearance_promos` (promo cepat habis berbasis modal)
- Kolom `clearance_promo_id` pada `order_items` dan `pos_sale_items`

```bash
mysql -u root -p migunani_motor_db < back_end/sql/20260327_inventory_batches_and_clearance_promos.sql
```

Catatan:
- File migrasi ini juga melakukan bootstrap awal `inventory_batches` dari `product_cost_states` (moving average) untuk stok yang sudah ada, agar sistem tetap bisa berjalan setelah migrasi.

## Optional internal endpoint for local file path import

Set in `.env` (backend):

```env
IMPORT_LOCAL_PATH_ENABLED=true
IMPORT_LOCAL_PATH_ALLOWLIST=/home/thouka/Migunani_Motor_Project,/mnt/c/Users/Administrator/Downloads
```

`IMPORT_LOCAL_PATH_ALLOWLIST` is optional. If provided, `file_path` must be inside one of those directories.
