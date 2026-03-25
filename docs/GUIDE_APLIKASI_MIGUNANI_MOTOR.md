# Guide Aplikasi Migunani Motor

Dokumen ini adalah panduan handover untuk memahami arah aplikasi saat ini: data, database, relasi, fitur, kegunaan, tema UI, alur proses, dan routing.

## 1) Ringkasan Aplikasi

Migunani Motor adalah aplikasi omnichannel toko suku cadang motor dengan cakupan:

- E-commerce pelanggan (catalog, cart, checkout, order tracking)
- Operasional admin gudang (inventory, kategori, supplier, PO, import produk, scanner)
- Operasional admin finance (verifikasi transfer, biaya operasional, piutang, P&L)
- POS kasir toko (checkout kasir, hold/resume, shift)
- Driver flow (ambil tugas kirim, konfirmasi selesai + bukti)
- Chat omnichannel (Web chat + WhatsApp) dengan real-time update

## 2) Arsitektur Sistem

### Backend

- Stack: Express + TypeScript + Sequelize + MySQL + Socket.io + whatsapp-web.js
- Base API: `/api/v1`
- Auth: JWT Bearer
- File upload: bukti bayar, chat attachment, gambar produk

### Frontend

- Stack: Next.js App Router + TypeScript + Tailwind + Zustand + Socket.io-client
- API frontend menggunakan proxy rewrite `'/api/*' -> NEXT_PUBLIC_API_URL/*`
- Websocket URL dari `NEXT_PUBLIC_WS_URL`

### Infra Docker (docker-compose)

- `mysql` (MySQL 8)
- `back_end` (port host default `5000`)
- `front_end` (port host default `3500`)
- `seed` profile terpisah

## 3) Kegunaan Aplikasi (Per Role)

- `customer`: belanja produk, checkout, upload bukti transfer, pantau pesanan
- `super_admin`: akses penuh semua modul
- `admin_gudang`: inventory, order operasional, assign driver, scanner, chat
- `admin_finance`: verifikasi pembayaran, biaya, piutang
- `kasir`: POS + shift + chat
- `driver`: lihat order ditugaskan, konfirmasi pengiriman/COD

## 4) Data Domain

### Master Data

- `users`
- `customer_profiles`
- `categories`
- `suppliers`
- `expense_labels`
- `settings`

### Data Operasional Inventori

- `products`
- `product_categories` (pivot many-to-many produk-kategori)
- `stock_mutations`
- `purchase_orders`

### Data Transaksi

- `carts`
- `cart_items`
- `orders`
- `order_items`
- `invoices`
- `order_issues`
- `shifts`

### Data Omnichannel

- `chat_sessions`
- `messages`

### Data Keuangan

- `expenses`

## 5) Database dan Relasi Utama

### Entitas dan Relasi Inti

- `User` 1-1 `CustomerProfile`
- `User` 1-1 `Cart`
- `Cart` 1-N `CartItem`
- `Product` 1-N `CartItem`
- `Category` 1-N `Product` (primary category)
- `Product` N-M `Category` via `product_categories`
- `Supplier` 1-N `PurchaseOrder`
- `Product` 1-N `StockMutation`
- `User(customer)` 1-N `Order` (`customer_id`)
- `User(driver)` 1-N `Order` (`courier_id`)
- `Order` 1-N `OrderItem`
- `Order` 1-1 `Invoice`
- `Order` 1-N `OrderIssue`
- `ChatSession` 1-N `Message`
- `User` 1-N `Message` (`sender_id`)
- `User` 1-N `Expense` (`created_by`)
- `User(kasir)` 1-N `Shift`

### Enum Penting

- `users.role`: `super_admin`, `admin_gudang`, `admin_finance`, `kasir`, `driver`, `customer`
- `orders.source`: `web`, `whatsapp`, `pos_store`
- `orders.status`: `pending`, `waiting_payment`, `processing`, `debt_pending`, `shipped`, `delivered`, `completed`, `canceled`, `expired`, `hold`
- `invoices.payment_method`: `transfer_manual`, `cod`, `cash_store`
- `invoices.payment_status`: `unpaid`, `paid`, `cod_pending`

## 6) Tema dan Pendekatan UI

UI saat ini konsisten ke tema:

- Warna utama: emerald + slate
- Font: Inter (UI) + JetBrains Mono (teks teknis)
- Mobile-first dengan bottom navigation
- Komponen admin dan customer memakai pola card-based
- Real-time indikator chat di admin bottom nav

## 7) Alur Bisnis Inti

### A. Customer Web Checkout

1. User melihat katalog (`/catalog`)
2. Tambah item ke cart
3. Checkout membuat `order` + `order_items` + `invoice`
4. Untuk transfer manual, customer upload bukti bayar (`/orders/[id]/upload-proof`)
5. Finance approve/reject dari modul verifikasi
6. Gudang proses -> kirim -> selesai

### B. Verifikasi Pembayaran (Finance)

1. Finance membuka `/admin/finance/verifikasi`
2. Review bukti transfer
3. `approve` -> `invoice.payment_status = paid`, order ke `processing`
4. `reject` -> reset bukti + order kembali `waiting_payment`

### C. Alur Gudang & Order Issue

1. Admin update status order dari detail `/admin/orders/[id]`
2. Jika barang kurang, status `hold` + buat `order_issues`
3. SLA issue ditampilkan pada `/admin/orders/issues`

### D. Alur POS

1. Kasir cari produk + susun cart POS
2. Pilih metode bayar: `cash` / `transfer` / `debt`
3. Checkout POS membuat order source `pos_store`
4. Shift dimulai/ditutup pada modul shift report

### E. Alur Driver

1. Driver lihat order assignment (`/driver`)
2. Buka detail tugas (`/driver/orders/[id]`)
3. Upload bukti + complete delivery
4. COD status diinvoice ditangani sebagai `cod_pending`

### F. Alur Chat Omnichannel

1. Web chat customer kirim lewat socket event `client:message`
2. Backend simpan sesi + pesan ke DB
3. Admin balas dari `/admin/chat` (bisa attachment)
4. WhatsApp bridge memakai `whatsapp-web.js`, status via `/api/v1/whatsapp/*`

## 8) Routing Frontend (App Router)

Total route aktif dari file `front_end/app/**/page.tsx`: **43 route**.

### Public / Customer

- `/`
- `/catalog`
- `/catalog/[id]`
- `/cart`
- `/checkout`
- `/orders`
- `/orders/[id]`
- `/orders/[id]/upload-proof`
- `/profile`
- `/auth/login`
- `/auth/register`

### Driver

- `/driver`
- `/driver/history`
- `/driver/orders/[id]`

### Admin Core

- `/admin`
- `/admin/orders`
- `/admin/orders/status/[status]`
- `/admin/orders/[id]`
- `/admin/orders/issues`
- `/admin/chat`
- `/admin/chat/whatsapp`
- `/admin/chat/broadcast`
- `/admin/settings`
- `/admin/audit-log`

### Admin Inventory

- `/admin/inventory`
- `/admin/inventory/categories`
- `/admin/inventory/suppliers`
- `/admin/inventory/import`
- `/admin/inventory/scanner`
- `/admin/inventory/purchase-order`

### Admin Finance

- `/admin/finance`
- `/admin/finance/verifikasi`
- `/admin/finance/biaya`
- `/admin/finance/biaya/label`
- `/admin/finance/piutang`
- `/admin/finance/piutang/[invoiceId]`
- `/admin/finance/pnl`

### Admin Staff

- `/admin/staff`
- `/admin/staff/daftar`
- `/admin/staff/tambah`
- `/admin/staff/[id]`

## 9) Routing Backend (API)

Base: `/api/v1`

### Auth

- `POST /auth/register`
- `POST /auth/login`

### Catalog (Public)

- `GET /catalog`
- `GET /catalog/categories`
- `GET /catalog/:id`

### Cart (Auth)

- `GET /cart`
- `POST /cart`
- `PATCH /cart/item/:id`
- `DELETE /cart/item/:id`
- `DELETE /cart`

### Orders

- `POST /orders/checkout`
- `GET /orders/my-orders`
- `GET /orders/:id`
- `POST /orders/:id/proof`
- `GET /orders/admin/list`
- `GET /orders/admin/couriers`
- `PATCH /orders/admin/:id/status`

### Inventory Admin

- `GET /admin/products`
- `POST /admin/products`
- `PUT /admin/products/:id`
- `POST /admin/products/upload-image`
- `GET /admin/categories`
- `POST /admin/categories`
- `PUT /admin/categories/:id`
- `DELETE /admin/categories/:id`
- `GET /admin/suppliers`
- `POST /admin/suppliers`
- `PUT /admin/suppliers/:id`
- `DELETE /admin/suppliers/:id`
- `POST /admin/inventory/mutation`
- `POST /admin/inventory/po`
- `POST /admin/inventory/import/preview`
- `POST /admin/inventory/import/commit`
- `POST /admin/inventory/import`
- `POST /admin/inventory/import-from-path`
- `GET /admin/inventory/scan`
- `GET /admin/inventory/scan/:sku`

### Finance Admin

- `GET /admin/finance/expenses`
- `POST /admin/finance/expenses`
- `GET /admin/finance/expense-labels`
- `POST /admin/finance/expense-labels`
- `PUT /admin/finance/expense-labels/:id`
- `DELETE /admin/finance/expense-labels/:id`
- `PATCH /admin/finance/orders/:id/verify`
- `GET /admin/finance/ar`
- `GET /admin/finance/ar/:id`
- `GET /admin/finance/pnl`

### POS

- `POST /pos/shift/start`
- `POST /pos/shift/end`
- `GET /pos/customers/search`
- `POST /pos/checkout`
- `POST /pos/hold`
- `GET /pos/hold`
- `GET /pos/resume/:id`
- `DELETE /pos/void/:id`

### Driver

- `GET /driver/orders`
- `POST /driver/orders/:id/complete`
- `GET /driver/wallet`

### Chat

- `POST /chat/web/attachment` (public)
- `GET /chat/web/messages` (public, guarded by session/guest check)
- `GET /chat/sessions`
- `GET /chat/sessions/:id/messages`
- `POST /chat/sessions/:id/reply`

### WhatsApp

- `GET /whatsapp/qr`
- `GET /whatsapp/status`
- `POST /whatsapp/connect`
- `POST /whatsapp/logout`

### Staff

- `GET /admin/staff`
- `GET /admin/staff/:id`
- `POST /admin/staff`
- `PATCH /admin/staff/:id`
- `DELETE /admin/staff/:id`

## 10) Yang Sudah Sesuai

- Struktur role dan modul utama sudah terbagi jelas.
- Skema data inti omnichannel sudah mencakup e-commerce + POS + finance + driver + chat.
- Support multi-kategori produk (`product_categories`) sudah ada.
- Import produk Excel/CSV sudah punya mode preview + commit + validasi.
- Real-time chat via Socket.io sudah terhubung dengan dashboard admin.
- WhatsApp client sudah punya status, QR flow, reconnect strategy, dan persistence metadata.

## 11) Yang Perlu Disesuaikan / Diperbaiki

### Prioritas Tinggi

- `back_end/src/jobs/cron.ts` tidak di-import di `server.ts`, jadi cron tidak jalan.
- Di cron, filter status order memakai `'Pending'` (huruf besar), sementara enum pakai `'pending'`.
- Dokumen `back_end/docs/API_Contract.md` tidak sinkron dengan route aktual.
- Dokumen `front_end/PAGE_LIST.md` masih menyebut 35 halaman, padahal route aktif 43.
- `README.md` akun default login sudah tidak sinkron dengan seeder terbaru.

### Prioritas Menengah

- Frontend cart masih dominan local state; endpoint backend `getCart/update/remove/clear` belum dipakai UI.
- Form checkout menyimpan alamat/notes di UI, tapi backend checkout belum menyimpan field tersebut.
- Halaman `broadcast`, `audit-log`, `settings` masih MVP/placeholder (belum endpoint penuh).
- `MemberHome` masih memakai data produk statis (belum dari API dinamis).
- `Profile` poin loyalty masih hardcoded (belum ambil `customer_profiles`).

### Prioritas Teknis Lanjutan

- Endpoint `POST /whatsapp/connect` frontend kirim `{ force }`, tetapi controller belum meneruskan argumen force ke service.
- `start.sh` saat ini berpotensi konflik dengan compose karena compose juga menyalakan backend/frontend.
- Strategi migrasi masih campuran `sequelize.sync()` + SQL manual; perlu standar migrasi tunggal.

## 12) Checklist Lanjutan Pengembangan

Gunakan checklist ini saat melanjutkan aplikasi:

- Samakan seluruh dokumentasi ke route/model terbaru (README, API contract, page list).
- Aktifkan cron job + perbaiki query status order expired.
- Finalisasi sync cart frontend-backend dua arah.
- Simpan data shipping address/notes ke order schema.
- Selesaikan modul yang masih placeholder (broadcast, audit log, settings).
- Hubungkan loyalty profile dan tier pricing real ke UI.
- Rapikan strategi deployment (mode docker full vs mode dev lokal) agar tidak konflik port.

---

Dokumen ini disusun berdasarkan implementasi aktual pada source code saat ini, bukan hanya dokumen desain lama.
