# Database Schema (Final Consolidated)

Dokumen ini mencakup seluruh struktur tabel untuk sistem E-Commerce, WMS, POS, dan Chat Omnichannel.

## User & Authentication Module

### Table: Users
*Tabel induk untuk semua pengguna sistem.*
*   `id` (UUID, PK): Identifier unik.
*   `name` (String): Nama lengkap.
*   `email` (String, Unique): Untuk login web.
*   `password` (String): Hashed password (bcrypt).
*   `whatsapp_number` (String, Unique, Index): Kunci utama untuk integrasi Bot WA.
*   `role` (Enum): 'super_admin', 'admin_gudang', 'admin_finance', 'kasir', 'driver', 'customer'.
*   `status` (Enum): 'active', 'banned'.
*   `created_at`, `updated_at` (DateTime).

### Table: CustomerProfiles
*Data tambahan khusus pelanggan.*
*   `user_id` (UUID, FK -> Users).
*   `tier` (Enum): 'regular', 'premium', 'gold', 'platinum'.
*   `points` (Integer): Saldo poin loyalitas.
*   `saved_addresses` (JSON): Array objek alamat `[{ label, recipient, phone, full_address, coordinates }]`.

## Inventory Module (Logistik)
*Sinkron dengan kolom pada file CSV Import.*

### Table: Categories
*   `id` (Integer, PK, Auto Increment).
*   `name` (String): Nama kategori (misal: "Oli", "Sparepart").

### Table: Products
*   `id` (UUID, PK).
*   `sku` (String, Unique, Index): Kode barang (dari CSV).
*   `barcode` (String, Nullable, Index): Kode barcode scan (dari CSV).
*   `name` (String): Nama barang.
*   `base_price` (Decimal 15,2): HARGA BELI (HPP untuk hitung laba).
*   `price` (Decimal 15,2): HARGA JUAL (Harga retail).
*   `unit` (String): Satuan (Pcs, Box, Set).
*   `stock_quantity` (Integer): Stok fisik saat ini.
*   `min_stock` (Integer): Batas peringatan stok menipis.
*   `category_id` (Integer, FK -> Categories).
*   `status` (Enum): 'active', 'inactive'.

### Table: StockMutations
*Riwayat pergerakan barang (Kartu Stok).*
*   `id` (BigInt, PK).
*   `product_id` (UUID, FK -> Products).
*   `type` (Enum): 'in' (Masuk/PO), 'out' (Terjual), 'adjustment' (Opname/Rusak), 'initial' (Import Awal).
*   `qty` (Integer): Jumlah berubah (positif/negatif).
*   `reference_id` (String, Nullable): No PO atau Order ID.
*   `note` (Text): Alasan mutasi (misal: "Barang rusak air", "Selisih opname").
*   `created_at`: Tanggal mutasi.

### Table: Suppliers
*   `id` (Integer, PK).
*   `name` (String).
*   `contact` (String).
*   `address` (Text).

### Table: PurchaseOrders (PO)
*   `id` (UUID, PK).
*   `supplier_id` (Integer, FK -> Suppliers).
*   `status` (Enum): 'pending', 'received', 'canceled'.
*   `total_cost` (Decimal 15,2).
*   `created_by` (UUID, FK -> Users).

## Transaction & POS Module

### Table: Orders
*Header transaksi penjualan.*
*   `id` (UUID, PK).
*   `customer_id` (UUID, FK -> Users, Nullable untuk Walk-in Guest).
*   `customer_name` (String): Snapshot nama pembeli (penting untuk Guest).
*   `source` (Enum): 'web', 'whatsapp', 'pos_store'.
*   `status` (Enum): 'pending', 'waiting_payment', 'processing', 'shipped', 'delivered', 'completed', 'canceled', 'expired', 'hold'.
*   `total_amount` (Decimal 15,2).
*   `discount_amount` (Decimal 15,2): Potongan tier/poin.
*   `courier_id` (UUID, FK -> Users, Nullable): Driver yang ditugaskan.
*   `expiry_date` (DateTime): Batas waktu bayar (Logika 30 hari).
*   `created_at` (DateTime).

### Table: OrderItems
*Detail barang per transaksi.*
*   `id` (BigInt, PK).
*   `order_id` (UUID, FK -> Orders).
*   `product_id` (UUID, FK -> Products).
*   `qty` (Integer).
*   `price_at_purchase` (Decimal 15,2): Harga saat transaksi terjadi (Snapshot).
*   `cost_at_purchase` (Decimal 15,2): HPP saat transaksi (Snapshot untuk Laba Rugi).

### Table: Invoices (Payments)
*Detail pembayaran.*
*   `id` (UUID, PK).
*   `order_id` (UUID, FK -> Orders).
*   `invoice_number` (String, Unique): Format INV/YYYYMMDD/XXXX.
*   `payment_method` (Enum): 'transfer_manual', 'cod', 'cash_store'.
*   `payment_status` (Enum): 'unpaid', 'paid', 'cod_pending'.
*   `amount_paid` (Decimal 15,2): Uang yang diterima (Penting untuk POS).
*   `change_amount` (Decimal 15,2): Uang kembalian (Penting untuk POS).
*   `payment_proof_url` (String, Nullable): Link gambar bukti transfer.
*   `verified_by` (UUID, FK -> Users): Admin/Driver yang konfirmasi uang diterima.
*   `verified_at` (DateTime).

## Omnichannel Chat Module

### Table: ChatSessions
*   `id` (UUID, PK).
*   `user_id` (UUID, FK -> Users, Nullable).
*   `whatsapp_number` (String, Index).
*   `platform` (Enum): 'web', 'whatsapp'.
*   `is_bot_active` (Boolean): true = Bot membalas; false = Admin membalas (Takeover).
*   `last_message_at` (DateTime).

### Table: Messages
*   `id` (BigInt, PK).
*   `session_id` (UUID, FK -> ChatSessions).
*   `sender_type` (Enum): 'customer', 'admin', 'bot'.
*   `sender_id` (UUID, FK -> Users, Nullable).
*   `body` (Text): Isi pesan.
*   `attachment_url` (String, Nullable): Gambar/Dokumen.
*   `is_read` (Boolean).
*   `created_via` (Enum): 'system', 'wa_mobile_sync', 'admin_panel'.

## Finance Module

### Table: Expenses
*Pengeluaran operasional (OPEX).*
*   `id` (BigInt, PK).
*   `category` (String): "Gaji", "Listrik", "Sewa", "Marketing".
*   `amount` (Decimal 15,2).
*   `date` (Date).
*   `note` (Text).
*   `created_by` (UUID, FK -> Users).

## Catatan Implementasi Sequelize
*   **Relation Options:** Gunakan `onDelete: 'CASCADE'` untuk `OrderItems -> Orders`. Jangan gunakan cascade pada `Orders -> Users`.
*   **Indexing:** Tambahkan index pada kolom `sku`, `whatsapp_number`, `invoice_number`.
*   **HPP Snapshot:** Kolom `cost_at_purchase` di `OrderItems` WAJIB diisi saat insert.
