# API Contract & Security Matrix (Aktual)

Dokumen ini disesuaikan dengan implementasi route backend saat ini.

## Konvensi Dasar

- Base URL: `/api/v1`
- Auth: Bearer JWT (`Authorization: Bearer <token>`)
- Content-Type default: `application/json`
- Upload file: `multipart/form-data`

## Daftar Endpoint

Format akses role:

- `Public`: tanpa login
- `Auth`: user login role apa pun
- Role spesifik ditulis eksplisit

## A) Authentication

| Method | Endpoint | Access | Keterangan |
|---|---|---|---|
| `POST` | `/auth/register` | Public | Registrasi customer |
| `POST` | `/auth/login` | Public | Login user/staff |

## B) Catalog (Public)

| Method | Endpoint | Access | Keterangan |
|---|---|---|---|
| `GET` | `/catalog` | Public | List produk aktif + filter/search |
| `GET` | `/catalog/categories` | Public | List kategori publik |
| `GET` | `/catalog/:id` | Public | Detail produk (id/sku) |

## C) Cart

| Method | Endpoint | Access | Keterangan |
|---|---|---|---|
| `GET` | `/cart` | Auth | Ambil cart user |
| `POST` | `/cart` | Auth | Tambah item ke cart |
| `PATCH` | `/cart/item/:id` | Auth | Update qty cart item |
| `DELETE` | `/cart/item/:id` | Auth | Hapus cart item |
| `DELETE` | `/cart` | Auth | Kosongkan cart |

## D) Orders

| Method | Endpoint | Access | Keterangan |
|---|---|---|---|
| `POST` | `/orders/checkout` | Auth | Checkout customer |
| `GET` | `/orders/my-orders` | Auth | List order milik customer login |
| `GET` | `/orders/:id` | Auth | Detail order (customer hanya order miliknya) |
| `POST` | `/orders/:id/proof` | Auth | Upload bukti transfer |
| `GET` | `/orders/admin/list` | `super_admin`, `admin_gudang`, `admin_finance` | List order admin |
| `GET` | `/orders/admin/couriers` | `super_admin`, `admin_gudang`, `admin_finance` | List driver aktif |
| `PATCH` | `/orders/admin/:id/status` | `super_admin`, `admin_gudang` | Update status order admin |

## E) Inventory & Product Admin

| Method | Endpoint | Access | Keterangan |
|---|---|---|---|
| `GET` | `/admin/products` | `super_admin`, `admin_gudang`, `admin_finance`, `kasir` | List produk admin/order intake |
| `POST` | `/admin/products` | `super_admin`, `admin_gudang` | Create produk |
| `PUT` | `/admin/products/:id` | `super_admin`, `admin_gudang` | Update produk |
| `PATCH` | `/admin/products/:id/tier-pricing` | `super_admin`, `kasir` | Update harga tier (regular, gold, premium/platinum) |
| `PATCH` | `/admin/products/tier-pricing/bulk-discount` | `super_admin`, `kasir` | Terapkan diskon tier (%) ke semua produk aktif |
| `POST` | `/admin/products/upload-image` | `super_admin`, `admin_gudang` | Upload gambar produk |
| `GET` | `/admin/categories` | `super_admin`, `admin_gudang` | List kategori |
| `POST` | `/admin/categories` | `super_admin`, `admin_gudang` | Create kategori |
| `PUT` | `/admin/categories/:id` | `super_admin`, `admin_gudang` | Update kategori |
| `DELETE` | `/admin/categories/:id` | `super_admin`, `admin_gudang` | Delete kategori |
| `GET` | `/admin/suppliers` | `super_admin`, `admin_gudang` | List supplier |
| `POST` | `/admin/suppliers` | `super_admin`, `admin_gudang` | Create supplier |
| `PUT` | `/admin/suppliers/:id` | `super_admin`, `admin_gudang` | Update supplier |
| `DELETE` | `/admin/suppliers/:id` | `super_admin`, `admin_gudang` | Delete supplier |
| `POST` | `/admin/inventory/mutation` | `super_admin`, `admin_gudang` | Mutasi stok manual |
| `POST` | `/admin/inventory/po` | `super_admin`, `admin_gudang` | Create purchase order |
| `POST` | `/admin/inventory/import/preview` | `super_admin`, `admin_gudang` | Preview import file |
| `POST` | `/admin/inventory/import/commit` | `super_admin`, `admin_gudang` | Commit import dari rows draft |
| `POST` | `/admin/inventory/import` | `super_admin`, `admin_gudang` | Import file langsung |
| `POST` | `/admin/inventory/import-from-path` | `super_admin` | Import dari path local (opsional env) |
| `GET` | `/admin/inventory/scan` | `super_admin`, `admin_gudang`, `kasir` | Scan by query `code` |
| `GET` | `/admin/inventory/scan/:sku` | `super_admin`, `admin_gudang`, `kasir` | Scan by param sku |

## F) Finance

| Method | Endpoint | Access | Keterangan |
|---|---|---|---|
| `GET` | `/admin/finance/expenses` | `super_admin`, `admin_finance` | List expense |
| `POST` | `/admin/finance/expenses` | `super_admin`, `admin_finance` | Create expense |
| `GET` | `/admin/finance/expense-labels` | `super_admin`, `admin_finance` | List label expense |
| `POST` | `/admin/finance/expense-labels` | `super_admin`, `admin_finance` | Create label expense |
| `PUT` | `/admin/finance/expense-labels/:id` | `super_admin`, `admin_finance` | Update label expense |
| `DELETE` | `/admin/finance/expense-labels/:id` | `super_admin`, `admin_finance` | Delete label expense |
| `PATCH` | `/admin/finance/orders/:id/verify` | `super_admin`, `admin_finance` | Approve/reject pembayaran |
| `GET` | `/admin/finance/ar` | `super_admin`, `admin_finance` | Laporan piutang |
| `GET` | `/admin/finance/ar/:id` | `super_admin`, `admin_finance` | Detail piutang |
| `GET` | `/admin/finance/pnl` | `super_admin` | Laporan laba rugi |

## G) POS

| Method | Endpoint | Access | Keterangan |
|---|---|---|---|
| `POST` | `/pos/shift/start` | `kasir`, `admin_gudang`, `super_admin` | Mulai shift |
| `POST` | `/pos/shift/end` | `kasir`, `admin_gudang`, `super_admin` | Tutup shift |
| `GET` | `/pos/customers/search` | `kasir`, `admin_gudang`, `super_admin` | Cari customer |
| `POST` | `/pos/checkout` | `kasir`, `admin_gudang`, `super_admin` | Checkout POS |
| `POST` | `/pos/hold` | `kasir`, `admin_gudang`, `super_admin` | Hold transaksi |
| `GET` | `/pos/hold` | `kasir`, `admin_gudang`, `super_admin` | List hold |
| `GET` | `/pos/resume/:id` | `kasir`, `admin_gudang`, `super_admin` | Resume hold |
| `DELETE` | `/pos/void/:id` | `kasir`, `admin_gudang`, `super_admin` | Void transaksi |

## H) Driver

| Method | Endpoint | Access | Keterangan |
|---|---|---|---|
| `GET` | `/driver/orders` | `driver`, `admin_gudang`, `super_admin` | List assignment driver |
| `POST` | `/driver/orders/:id/complete` | `driver` | Selesaikan pengiriman + bukti |
| `GET` | `/driver/wallet` | `driver`, `admin_finance`, `super_admin` | Rekap COD pending |

## I) Chat

| Method | Endpoint | Access | Keterangan |
|---|---|---|---|
| `POST` | `/chat/web/attachment` | Public | Upload lampiran web widget |
| `GET` | `/chat/web/messages` | Public (guard session) | Ambil histori chat web |
| `GET` | `/chat/sessions` | `super_admin`, `admin_gudang`, `admin_finance`, `kasir` | List sesi chat |
| `GET` | `/chat/sessions/:id/messages` | `super_admin`, `admin_gudang`, `admin_finance`, `kasir` | Detail pesan per sesi |
| `POST` | `/chat/sessions/:id/reply` | `super_admin`, `admin_gudang`, `admin_finance`, `kasir` | Reply chat + lampiran |

## J) WhatsApp Integration

| Method | Endpoint | Access | Keterangan |
|---|---|---|---|
| `GET` | `/whatsapp/qr` | `super_admin`, `admin_gudang` | Ambil QR login WA |
| `GET` | `/whatsapp/status` | `super_admin`, `admin_gudang` | Status WA client |
| `POST` | `/whatsapp/connect` | `super_admin`, `admin_gudang` | Start koneksi WA |
| `POST` | `/whatsapp/logout` | `super_admin` | Logout session WA |

## K) Staff Management

| Method | Endpoint | Access | Keterangan |
|---|---|---|---|
| `GET` | `/admin/staff` | `super_admin` | List staff |
| `GET` | `/admin/staff/:id` | `super_admin` | Detail staff |
| `POST` | `/admin/staff` | `super_admin` | Create staff |
| `PATCH` | `/admin/staff/:id` | `super_admin` | Update staff |
| `DELETE` | `/admin/staff/:id` | `super_admin` | Deactivate staff |

## Security Matrix (Ringkas per Modul)

| Modul | Super Admin | Admin Gudang | Admin Finance | Kasir | Driver | Customer |
|---|---:|---:|---:|---:|---:|---:|
| Auth (`/auth`) | Y | Y | Y | Y | Y | Y |
| Catalog Public (`/catalog`) | Y | Y | Y | Y | Y | Y |
| Cart + Customer Orders | Y | Y | Y | Y | Y | Y |
| Order Admin (`/orders/admin/*`) | Y | Y | Y | - | - | - |
| Inventory (`/admin/*`, inventory) | Y | Y | - | Scanner only | - | - |
| Finance (`/admin/finance/*`) | Y | - | Y | - | - | - |
| POS (`/pos/*`) | Y | Y | - | Y | - | - |
| Driver (`/driver/*`) | Y (sebagian) | Y (sebagian) | Wallet only | - | Y | - |
| Chat Admin (`/chat/sessions*`) | Y | Y | Y | Y | - | - |
| WhatsApp Config (`/whatsapp/*`) | Y | Y | - | - | - | - |
| Staff (`/admin/staff/*`) | Y | - | - | - | - | - |

## Catatan

- Dokumen ini merefleksikan route `back_end/src/routes/*.ts` saat ini.
- Jika menambah route baru, update dokumen ini bersamaan dengan perubahan kode.
