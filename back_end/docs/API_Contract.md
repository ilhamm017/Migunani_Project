# API Contract & Security Matrix (Final Comprehensive)

Dokumen ini adalah acuan tunggal untuk seluruh endpoint Backend Node.js.

## Tech Stack & Environment
*   **Base URL:** `/api/v1`
*   **Auth:** Bearer Token (JWT).
*   **Content-Type:** `application/json` (kecuali upload file: `multipart/form-data`).

## API Endpoints (Lengkap)
*Format: METHOD Endpoint -- Fungsi [Akses]*

### A. Authentication & User Management
*   `POST /auth/login` -- Login user/admin/driver & generate token [Public]
*   `POST /auth/register` -- Registrasi pelanggan baru [Public]
*   `GET /users/profile` -- Ambil data profil sendiri [Authenticated]
*   `GET /admin/users` -- List semua user & pelanggan [Admin]
*   `PATCH /admin/users/:id/ban` -- Ban/Unban pelanggan [Admin]
*   `PATCH /admin/users/:id/role` -- Update tier (Gold/Platinum) [Admin]

### B. Product & Inventory (Gudang)
*   `GET /products` -- Katalog produk (Filter, Search, Pagination) [Public]
*   `GET /products/:sku` -- Detail produk & stok [Public]
*   `POST /admin/products` -- Tambah produk baru manual [Admin/Gudang]
*   `PUT /admin/products/:id` -- Update data produk [Admin/Gudang]
*   `POST /admin/inventory/import` -- Import CSV/Excel Data Lama [Admin]
*   `GET /admin/inventory/template` -- Download template CSV [Admin]
*   `POST /admin/inventory/po` -- Buat Purchase Order (Barang Masuk) [Admin/Gudang]
*   `POST /admin/inventory/mutation` -- Input mutasi/opname manual [Admin/Gudang]
*   `GET /admin/inventory/scan/:sku` -- Ambil data produk via barcode scanner [Admin/Gudang/Kasir]

### C. Orders (Web & WhatsApp)
*   `POST /orders/checkout` -- Buat pesanan (Support: Transfer/COD) [Customer]
*   `GET /orders/my-orders` -- List pesanan pelanggan [Customer]
*   `GET /orders/:id` -- Detail pesanan & Invoice [Customer]
*   `POST /orders/:id/proof` -- Upload Bukti Transfer (Image) [Customer]
*   `GET /admin/orders` -- List semua pesanan masuk [Admin]
*   `PATCH /admin/orders/:id/status` -- Update status (Proses/Kirim/Selesai) [Admin]
*   `PATCH /admin/orders/:id/verify` -- Verifikasi Bukti Transfer (ACC) [Admin Finance]

### D. Point of Sales (Kasir Toko) - NEW
*   `GET /pos/products` -- Pencarian cepat produk untuk kasir [Kasir/Admin]
*   `GET /pos/members` -- Cari member by Phone/Name [Kasir/Admin]
*   `POST /pos/transaction` -- Buat Order Walk-in (Cash) [Kasir/Admin]
*   `POST /pos/hold` -- Hold pesanan sementara [Kasir/Admin]

### E. Logistics & Driver (Kurir) - NEW
*   `GET /driver/deliveries` -- List pengiriman ditugaskan hari ini [Driver]
*   `PATCH /driver/orders/:id/complete` -- Tandai barang diterima customer [Driver]
*   `PATCH /driver/orders/:id/cod-acc` -- Konfirmasi Terima Uang COD [Driver]

### F. Finance & Reporting
*   `GET /admin/finance/ar` -- Laporan piutang (Aging Report) [Super Admin]
*   `GET /admin/finance/expenses` -- List pengeluaran [Admin]
*   `POST /admin/finance/expenses` -- Input biaya operasional [Admin]
*   `GET /admin/finance/pnl` -- Laporan Laba Rugi periodik [Super Admin]
*   `GET /admin/finance/export` -- Download laporan Excel [Super Admin]

### G. WhatsApp Bot & Chat
*   `POST /bot/broadcast` -- Kirim pesan massal [Admin]
*   `GET /bot/status` -- Cek status koneksi WA [Admin]
*   `POST /chat/takeover` -- Pause bot untuk sesi user tertentu [Admin]

## Security & Access Control Matrix (RBAC)
*Tabel Hak Akses berdasarkan Role User. (Y = Ya/Boleh, - = Tidak Boleh)*

| Fitur | Super Admin | Gudang | Finance | Kasir | Driver | Customer |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| Import Data | Y | Y | - | - | - | - |
| Input PO | Y | Y | - | - | - | - |
| Transaksi POS | Y | - | - | Y | - | - |
| Verifikasi Transfer | Y | - | Y | - | - | - |
| Terima Uang COD | - | - | - | - | Y | - |
| Lihat Laba Rugi | Y | - | - | - | - | - |
| Order via Web/WA | - | - | - | - | - | Y |
