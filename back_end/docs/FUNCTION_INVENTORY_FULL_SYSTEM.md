# Function Inventory Full System

Dokumen ini memetakan fungsi aktif sistem berdasarkan implementasi yang sedang dipakai saat ini.
Source of truth utama:
- route backend aktif di `back_end/src/routes`
- guard akses di `back_end/src/middleware/authMiddleware.ts`
- transisi order di `back_end/src/utils/orderTransitions.ts`
- halaman frontend aktif yang ditemukan di `front_end/app`

## 1. Auth & Access

| Area | Backend/API | Actor | Frontend/Page | Fungsi Utama |
|---|---|---|---|---|
| Register | `POST /api/v1/auth/register` | guest | `/auth/register` | Registrasi customer |
| Login | `POST /api/v1/auth/login` | guest, semua role | `/auth/login` | Login dan penerbitan token |
| Auth guard | middleware `authenticateToken` | semua role | seluruh halaman terproteksi | Revalidasi JWT, role, status user |
| Role guard | middleware `authorizeRoles` | semua role | redirect role-based | Batasi akses endpoint sesuai peran |

## 2. Catalog, Cart, Checkout

| Area | Backend/API | Actor | Frontend/Page | Fungsi Utama |
|---|---|---|---|---|
| Public catalog | `GET /api/v1/catalog` | guest, customer | `/`, `/catalog` | Browse produk |
| Product detail | `GET /api/v1/catalog/:id` | guest, customer | `/catalog/[id]` | Detail produk |
| Promo validate | `GET /api/v1/promos/validate/:code` | guest, customer | `/checkout` | Validasi promo sebelum checkout |
| Cart read/write | `GET/POST/PATCH/DELETE /api/v1/cart` | customer | `/cart` | Tambah, ubah, hapus item cart |
| Checkout | `POST /api/v1/orders/checkout` | customer, admin operasional | `/checkout`, `/admin/orders/create` | Buat order dari cart/items, pilih payment, promo, shipping |

## 3. Customer Profile, Orders, Invoice View

| Area | Backend/API | Actor | Frontend/Page | Fungsi Utama |
|---|---|---|---|---|
| Profile me | `GET /api/v1/profile/me` | customer | `/profile` | Ambil profil aktif |
| Update addresses | `PATCH /api/v1/profile/addresses` | customer | `/profile/addresses` | Simpan alamat customer |
| My orders | `GET /api/v1/orders/my-orders` | customer | `/orders` | List order customer + invoice attach |
| Order detail | `GET /api/v1/orders/:id` | customer, admin | `/orders/[id]`, `/admin/orders/[id]` | Detail order, item summary, timeline event |
| Upload proof | `POST /api/v1/orders/:id/proof` | customer | `/orders/[id]/upload-proof` | Upload bukti transfer |
| Invoice detail | `GET /api/v1/invoices/:id` | authenticated | `/invoices`, `/invoices/[invoiceId]`, `/invoices/[invoiceId]/print` | Detail invoice customer/staff |
| Retur customer | `POST /api/v1/retur/request`, `GET /api/v1/retur/my` | customer | `/orders/[id]/return`, `/retur` | Ajukan retur, lihat daftar retur |

## 4. Order Operations (Kasir, Gudang, Super Admin)

| Area | Backend/API | Actor | Frontend/Page | Fungsi Utama |
|---|---|---|---|---|
| Dashboard stats | `GET /api/v1/orders/admin/stats` | `super_admin`, `admin_gudang`, `admin_finance`, `kasir` | dashboard admin | Ringkasan operasional |
| Order list | `GET /api/v1/orders/admin/list` | role operasional | `/admin/orders`, `/admin/orders/status/[status]`, `/admin/warehouse/pesanan` | List order lintas status |
| Courier list | `GET /api/v1/orders/admin/couriers` | role operasional | assign driver UI | Ambil daftar kurir aktif |
| Update status | `PATCH /api/v1/orders/admin/:id/status` | role operasional | `/admin/orders/[id]`, `/admin/warehouse/pesanan` | Hold, ship, cancel, re-open workflow |
| Order issues | bagian dari detail/status | `admin_gudang`, `super_admin` | `/admin/orders/issues`, `/admin/warehouse/driver-issues` | Tindak lanjut issue order |

## 5. Allocation & Backorder

| Area | Backend/API | Actor | Frontend/Page | Fungsi Utama |
|---|---|---|---|---|
| Pending allocations | `GET /api/v1/allocation/pending` | `super_admin`, `kasir` | issue invoice/allocation UI | List order menunggu alokasi |
| Product allocations | `GET /api/v1/allocation/product/:productId` | `super_admin`, `kasir` | allocation drill-down | Lihat antrean shortage per produk |
| Allocate order | `POST /api/v1/allocation/:id` | `super_admin`, `kasir` | invoice/allocation UI | Alokasi manual stok ke order |
| Order allocation detail | `GET /api/v1/allocation/:id` | `super_admin`, `kasir` | allocation detail | Detail order dan shortage summary |
| Cancel backorder | `POST /api/v1/allocation/:id/cancel-backorder` | `super_admin`, `kasir` | allocation detail | Kurangi qty open backorder tanpa cancel full order |

## 6. Driver Operations

| Area | Backend/API | Actor | Frontend/Page | Fungsi Utama |
|---|---|---|---|---|
| Assigned orders | `GET /api/v1/driver/orders` | `driver`, `admin_gudang`, `super_admin` | `/driver`, `/driver/history`, `/driver/precheck` | List tugas driver |
| Delivery complete | `POST /api/v1/driver/orders/:id/complete` | `driver` | `/driver/orders/[id]` | Selesaikan delivery + proof |
| COD record payment | `POST /api/v1/driver/orders/:id/payment` | `driver` | `/driver/orders/[id]` | Rekam uang COD yang diterima |
| Change payment method | `PATCH /api/v1/driver/orders/:id/payment-method` | `driver` | `/driver/orders/[id]` | Koreksi metode pembayaran di lapangan |
| Report issue | `POST /api/v1/driver/orders/:id/issue` | `driver` | `/driver/orders/[id]`, `/driver/orders/[id]/checklist` | Laporan shortage/masalah delivery |
| Wallet/debt | `GET /api/v1/driver/wallet` | `driver`, `admin_finance`, `super_admin` | `/finance/cod/[driverId]`, driver surfaces | Lihat eksposur COD/debt |
| Driver retur | `GET/PATCH /api/v1/driver/retur*` | `driver` | `/driver/retur/[id]` | Pickup retur customer |

## 7. Finance

| Area | Backend/API | Actor | Frontend/Page | Fungsi Utama |
|---|---|---|---|---|
| Issue invoice per order | `POST /api/v1/admin/finance/orders/:id/issue-invoice` | `kasir`, `super_admin` | `/admin/finance/issue-invoice` | Terbitkan invoice order |
| Issue invoice batch | `POST /api/v1/admin/finance/invoices/issue-batch` | `kasir`, `super_admin` | `/admin/finance/issue-invoice` | Invoice gabungan multi-order |
| Issue invoice by items | `POST /api/v1/admin/finance/invoices/issue-items` | `kasir`, `super_admin` | `/admin/finance/issue-invoice` | Invoice parsial per item |
| Verify transfer | `PATCH /api/v1/admin/finance/orders/:id/verify` | `admin_finance`, `super_admin` | `/admin/finance/verifikasi` | Approve/reject bukti transfer |
| Void payment | `POST /api/v1/admin/finance/invoices/:id/void` | `admin_finance`, `super_admin` | finance surfaces | Void pembayaran yang sudah paid |
| AR | `GET /api/v1/admin/finance/ar`, `GET /api/v1/admin/finance/ar/:id` | `admin_finance`, `super_admin` | `/admin/finance/piutang`, `/admin/finance/piutang/[invoiceId]` | Daftar dan detail piutang |
| COD verify | `GET /api/v1/admin/finance/driver-cod`, `POST /api/v1/admin/finance/driver-cod/verify` | `admin_finance`, `super_admin` | `/admin/finance/cod`, `/finance/cod/[driverId]` | Verifikasi setoran COD driver |
| Credit note | `POST /api/v1/admin/finance/credit-notes`, `POST /api/v1/admin/finance/credit-notes/:id/post` | `admin_finance`, `super_admin` | `/admin/finance/credit-note` | Buat dan posting credit note |
| Journals/periods | `GET /journals`, `GET /periods`, `POST /periods/close`, `POST /journals/adjustment` | finance | `/admin/finance/jurnal/adjustment` | Penyesuaian dan tutup periode |
| Tax settings | `GET/PUT /settings/tax` | finance | `/admin/finance/settings/tax` | Konfigurasi pajak |
| Expenses | `GET/POST /expenses`, approve, pay, expense labels CRUD | finance | `/admin/finance/biaya`, `/admin/finance/biaya/label`, `/finance/expenses` | Pengeluaran operasional |
| Reports | `/reports/*` | finance, kasir tertentu | `/admin/finance/laporan/*`, `/finance/reports` | PnL, cashflow, backorder, aging, tax summary |

## 8. Inventory & Purchasing

| Area | Backend/API | Actor | Frontend/Page | Fungsi Utama |
|---|---|---|---|---|
| Products | `/api/v1/admin/products*` | `super_admin`, `admin_gudang`, `kasir` tertentu | `/admin/inventory`, `/admin/warehouse/stok` | CRUD produk, tier pricing, upload image |
| Categories | `/api/v1/admin/categories*` | `super_admin`, `admin_gudang`, `kasir` tertentu | `/admin/warehouse/categories` | CRUD kategori + tier discount |
| Suppliers | `/api/v1/admin/suppliers*` | `super_admin`, `admin_gudang`, `kasir` | `/admin/warehouse/suppliers` | CRUD supplier |
| Stock mutation | `POST /api/v1/admin/inventory/mutation` | `super_admin`, `admin_gudang` | stock/admin pages | Penyesuaian stok |
| Product mutation history | `GET /api/v1/admin/inventory/mutation/:product_id` | `super_admin`, `admin_gudang` | stock detail | Riwayat mutasi |
| Purchase order | `GET/POST/PATCH /api/v1/admin/inventory/po*` | `super_admin`, `admin_gudang`, `kasir` tertentu | `/admin/warehouse/inbound`, `/admin/warehouse/inbound/[id]`, `/admin/warehouse/inbound/history` | Buat dan receive PO |
| Import inventory | `/import/preview`, `/import/commit`, `/import`, `/import-from-path` | `super_admin`, `admin_gudang` | `/admin/warehouse/import` | Preview dan commit import produk |
| Barcode scan | `/api/v1/admin/inventory/scan*` | `super_admin`, `admin_gudang`, `kasir` | `/admin/warehouse/scanner` | Scan SKU/barcode |
| Supplier invoice | `/api/v1/admin/finance/supplier-invoice*` | finance | finance surfaces | Catat hutang supplier dan pembayaran |
| Stock opname | `/api/v1/inventory/audit*` | `super_admin`, `admin_gudang` | `/admin/warehouse/audit`, `/admin/warehouse/audit/[id]` | Audit stok berkala |

## 9. Customer Admin & Master Data

| Area | Backend/API | Actor | Frontend/Page | Fungsi Utama |
|---|---|---|---|---|
| Customer list/detail | `/api/v1/admin/customers*` | `super_admin`, `admin_gudang`, `admin_finance`, `kasir` | customer/admin surfaces | Cari, lihat, ringkasan order customer |
| Customer create + OTP | `/otp/send`, `/create` | `super_admin`, `kasir` | `/admin/sales/member-baru` | Buat customer oleh admin |
| Customer tier/status | `PATCH /:id/tier`, `PATCH /:id/status` | `super_admin`, `kasir` | sales/admin pages | Ubah tier atau blokir customer |
| Staff | `/api/v1/admin/staff*` | `super_admin` | `/admin/staff*` | CRUD staff |
| Shipping methods | `/api/v1/admin/shipping-methods*` | `super_admin`, `kasir` | `/admin/sales/shipping-methods` | Master ongkir/metode kirim |
| Discount vouchers | `/api/v1/admin/discount-vouchers*` | `super_admin`, `kasir` | `/admin/sales/discount-vouchers` | Master voucher promo |
| Accounts | `/api/v1/admin/accounts*` | `super_admin`, `admin_finance` | finance/accounting surfaces | Chart of accounts |

## 10. Chat & WhatsApp

| Area | Backend/API | Actor | Frontend/Page | Fungsi Utama |
|---|---|---|---|---|
| Web attachment | `POST /api/v1/chat/web/attachment` | guest, customer | web chat widget | Upload lampiran chat publik |
| Web session read | `/web/messages`, `/web/session/*` | customer | chat widget | Ambil sesi chat customer |
| Threads | `/api/v1/chat/threads*` | staff, driver, customer | `/chat`, `/admin/chat`, `/driver/chat` | List thread, open thread, send, read |
| Legacy sessions | `/api/v1/chat/sessions*` | staff, driver | admin/driver chat | Baca dan reply chat lama |
| WhatsApp status | `/api/v1/whatsapp/*` | `super_admin`, `kasir` | `/admin/chat/whatsapp` | QR, connect, logout, status |
| Socket events | websocket server | seluruh permukaan terkait | multiple pages | `order:status_changed`, chat badge, WA status |

## 11. Role Matrix Ringkas

| Role | Domain Utama |
|---|---|
| `customer` | catalog, cart, checkout, orders, invoice view, retur, profile, chat |
| `kasir` | invoice issuance, allocation, customer creation, shipping/voucher master, backorder ops |
| `admin_gudang` | order shipping, courier assignment, stock, scanner, PO receive, audit |
| `driver` | assigned delivery, COD collection, issue report, retur pickup, chat |
| `admin_finance` | payment verification, COD settlement, AR, reports, tax, expense, refund disbursement |
| `super_admin` | seluruh domain + staff/accounts/period close |

## 12. Cross-Module State / Event Surface

- Order lifecycle aktif: `pending`, `waiting_invoice`, `ready_to_ship`, `shipped`, `delivered`, `partially_fulfilled`, `completed`, `hold`, `waiting_admin_verification`, `canceled`, plus alias legacy `waiting_payment`.
- Event operasional penting:
  - `order:status_changed`
  - `retur:status_changed`
  - `cod:settlement_updated`
  - `chat:unread_badge_updated`
  - `admin:refresh_badges`
- Endpoint rawan efek ganda yang relevan untuk uji retry/idempotency:
  - checkout
  - driver COD record payment
  - finance verify driver COD
  - invoice issuance / payment verify / void / refund / stock mutation tetap perlu uji retry walau tidak semua sudah jelas idempotent
