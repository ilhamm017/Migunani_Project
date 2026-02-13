# Desain Teknis - Master Architecture

**Versi:** Final Consolidated
**Lingkup:** E-Commerce, WMS, POS, Logistics, & Omnichannel Chat.

Dokumen ini menjabarkan struktur database (ERD), arsitektur sistem, dan alur data untuk seluruh modul.

## 0. Technology Stack (Prasyarat Sistem)

Daftar teknologi yang wajib diinstal dan dikonfigurasi.

*   **Runtime & Language:** Node.js (v18+) & TypeScript.
*   **Backend Framework:** Express.js (Dipilih karena ringan dan fleksibel).
*   **Frontend Framework:** Next.js (App Router) + Tailwind CSS.
*   **Database:** MySQL 8.0 (Relational) dengan Sequelize ORM.
*   **State Management:** Zustand (untuk POS Cart & Chat Session).
*   **Real-time Engine:** Socket.io (Websocket untuk Web Chat) & whatsapp-web.js (WA Bridge).
*   **Utilities:**
    *   `pdfkit` (Generate Invoice).
    *   `exceljs` (Import/Export Laporan).
    *   `html5-qrcode` (Scanner Barcode Web).
*   **Infrastructure:** Oracle Cloud Compute (Ubuntu 22.04), PM2 Process Manager.

## 1. Entity Relationship Diagram (ERD)

Struktur database final untuk MySQL (Sequelize).

### A. Core & Auth
*   **Users:** id (UUID), email, password, whatsapp_number (Unique), role (Admin/Gudang/Kasir/Driver/Customer), status (Active/Ban).
*   **CustomerProfiles:** user_id, tier (Regular/Premium/Gold), points, saved_addresses (JSON).

### B. Inventory (Gudang)
*   **Products:** id, sku (Unique), barcode, name, base_price (HPP), price (Jual), stock, min_stock, category_id.
*   **Categories:** id, name.
*   **Suppliers:** id, name, contact.
*   **StockMutations:** id, product_id, type (In/Out/Adjust/Initial), qty, reason, created_at.
*   **PurchaseOrders:** id, supplier_id, status (Pending/Received), total_cost.

### C. Transactions (Web & POS)
*   **Orders:** id, customer_id, courier_id (Driver), source (Web/WA/POS), status (Pending/Processing/Shipped/Delivered/Completed/Expired/Hold), total_amount, expiry_date.
*   **OrderItems:** order_id, product_id, qty, price_at_purchase, cost_at_purchase (Snapshot HPP).
*   **Invoices:** order_id, payment_method (Transfer/COD/Cash), payment_status (Unpaid/Paid/CODPending), payment_proof_url, verified_by.

### D. Omnichannel Chat
*   **ChatSessions:** whatsapp_number, platform (WA/Web), is_bot_active, last_message_at.
*   **Messages:** session_id, sender_type (Bot/Admin/Customer), body, attachment_url, is_read.

### E. Finance
*   **Expenses:** category (Gaji/Listrik), amount, date, note.

## 2. Arsitektur & Alur Sistem

### A. Omnichannel Chat Sync (Socket.io)
**Arsitektur:** Socket.io berjalan satu proses dengan Express.js Server (Monolith).
`Code: const server = http.createServer(app); const io = new Server(server);`

**Inbound (Pesan Masuk):**
*   **Dari WA:** whatsapp-web.js menerima pesan -> Emit event internal -> Socket.io mem-broadcast ke room admin-dashboard.
*   **Dari Web:** Client (Browser) emit event client:message ke Server -> Server simpan DB -> Emit ke room admin-dashboard.
*   **Logika Bot:** Middleware mengecek prefix ! . Jika ada, bot membalas langsung tanpa notifikasi "Action Needed" ke admin.

**Outbound (Pesan Keluar):**
*   **Via Dashboard:** Admin ketik pesan -> Server mendeteksi platform sesi user.
    *   Jika WA: Server menyuruh whatsapp-web.js kirim pesan.
    *   Jika Web: Server emit event server:message ke socket ID user tersebut.
*   **Via HP Admin (Sync):** whatsapp-web.js deteksi message_create dari me -> Simpan ke DB -> Socket.io update tampilan Dashboard Admin.

### B. Point of Sales (POS) Logic
Sistem kasir toko fisik.
*   **Mode Operasi:** Online-first. Membutuhkan koneksi untuk validasi stok real-time.
*   **State Management:** Menggunakan Zustand (Frontend) untuk menampung cart sementara sebelum checkout.
*   **Flow Transaksi:**
    1.  Kasir scan Barcode -> Tambah ke Cart.
    2.  Kasir input "Uang Diterima" -> Server validasi -> Orders dibuat dengan source POS.
    3.  Server response sukses -> Trigger window.print() untuk struk thermal.

### C. Logistics & Driver Flow
Logika pengantaran dan COD.
*   **Assignment:** Admin Gudang memilih courier_id pada pesanan yang statusnya Processing. Status berubah jadi Shipped.
*   **Driver View:** Driver melihat list order Shipped yang ditugaskan padanya.
*   **COD Settlement:**
    1.  Driver tiba -> Terima Uang -> Klik "Terima COD".
    2.  System update Invoice.payment_status = 'Paid'.
    3.  System update Order.status = 'Delivered'.

### D. Manual Payment Verification
Pengganti Payment Gateway.
*   **Customer:** Checkout -> Upload Bukti Transfer -> Invoice.payment_proof_url terisi.
*   **Admin Finance:**
    1.  Buka menu "Verifikasi".
    2.  Cek mutasi bank manual.
    3.  Klik "Terima" -> Order.status jadi Processing.
    4.  Klik "Tolak" -> Notifikasi ke User untuk upload ulang.

## 3. Strategi Migrasi & Integrasi

### A. Import Data Excel Lama
Pemetaan kolom disesuaikan dengan header CSV: NAMA BARANG, VARIAN, KATEGORI BARANG, HARGA BELI, HARGA JUAL, SKU, UNIT, BARCODE, STATUS, STOK.

**Detail Logika Pemrosesan per Kolom:**
*   **NAMA BARANG -> DB: name**
    *   Logic: Jika VARIAN ada isinya, gabungkan: NAMA BARANG + VARIAN.
*   **KATEGORI BARANG -> DB: category_id**
    *   Logic: Find by name, jika tidak ada -> Create Category baru.
*   **HARGA BELI -> DB: base_price**
    *   Logic: Clean format currency (hapus Rp/koma). Default 0 jika kosong.
*   **HARGA JUAL -> DB: price**
    *   Logic: Harga jual retail.
*   **SKU -> DB: sku**
    *   Logic: Primary Identifier. Jika kosong di CSV, gunakan data dari NAMA BARANG (jika formatnya kode) atau BARCODE.
*   **BARCODE -> DB: barcode**
    *   Logic: Untuk keperluan scan. Jika kosong, samakan dengan SKU.
*   **UNIT -> DB: unit**
    *   Logic: Satuan (Pcs/Set/Box). Default: 'Pcs'.
*   **STATUS -> DB: status**
    *   Logic: Map: 'ACTIVE' -> active, lainnya -> inactive.
*   **STOK -> DB: stock**
    *   Logic: Masukkan sebagai Initial Import di tabel StockMutations.

### B. SEO Strategy (Next.js)
*   **SSR (Server-Side Rendering):** Halaman katalog produk di-render di server agar Google Bot bisa membaca harga dan deskripsi tanpa JavaScript.
*   **Sitemap:** Dibuat otomatis harian berdasarkan produk yang status = 'active'.

## 4. Otomasi Sistem (Cron Jobs)

### A. The 30-Day Reaper
Script berjalan setiap pukul 00:00.
**Query:**
```sql
UPDATE orders
SET status = 'Expired', stock_released = TRUE
WHERE status = 'Pending' AND created_at < NOW() - INTERVAL 30 DAY;
```
**Fungsi:** Mengembalikan stok yang tertahan di keranjang "Pending" ke inventory aktif.

### B. Bot Session Timeout
Script berjalan setiap 5 menit. Mengecek `ChatSessions` dimana `is_bot_active = false` DAN `last_message_at > 120 menit`. Mengubah kembali `is_bot_active = true`.
