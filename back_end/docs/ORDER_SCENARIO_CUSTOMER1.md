# End-to-End Scenario: `customer1@migunani.com`

Dokumen ini memetakan state-machine order berdasarkan implementasi backend saat ini (bukan asumsi SOP lama), sekaligus mencatat titik rentan dan urutan patch.

## 1. Aktor & Prasyarat

- Customer: `customer1@migunani.com` (`customer`)
- Kasir: penerbit invoice (`kasir` / `super_admin`)
- Gudang: kirim + assign driver (`admin_gudang`)
- Driver: delivery + record COD (`driver`)
- Finance: verifikasi transfer + settlement COD (`admin_finance`)

## 2. State Machine Order Aktual

Status utama:
- `pending`
- `waiting_invoice`
- `ready_to_ship`
- `shipped`
- `delivered`
- `partially_fulfilled`
- `completed`
- `hold`
- `waiting_admin_verification`
- `canceled`

Transisi umum:
1. Checkout customer -> `pending`
2. Alokasi kasir:
   - ada qty invoiceable -> `waiting_invoice`
   - shortage tetap tercatat via `backorder` (bisa partial)
3. Issue invoice (kasir) -> `ready_to_ship`
4. Gudang assign kurir + kirim -> `shipped`
5. Driver complete delivery:
   - unpaid transfer/cash -> `delivered`
   - COD `cod_pending` atau invoice paid -> `completed`
   - jika backorder aktif -> `partially_fulfilled`
6. Penyelesaian pembayaran:
   - transfer: upload proof -> `waiting_admin_verification`, approve -> `ready_to_ship` / `completed` (jika sudah delivered), reject -> `hold`
   - COD: driver record -> invoice `cod_pending`; finance verify setoran -> invoice `paid`, order `completed`

## 3. Skenario Per Metode Bayar

### A. `transfer_manual`

1. Customer checkout (`pending`)
2. Kasir alokasi (`waiting_invoice`)
3. Kasir issue invoice (`ready_to_ship`, payment `unpaid`)
4. Opsi jalur:
   - Bayar dulu: customer upload proof -> finance approve -> gudang kirim -> driver complete -> `completed`
   - Kirim dulu: gudang kirim -> driver complete (`delivered`) -> finance approve transfer -> `completed`
5. Jika finance reject bukti: `hold` sampai ada tindak lanjut.

### B. `cod`

1. Customer checkout -> alokasi -> invoice (`cod_pending`) -> `ready_to_ship`
2. Gudang kirim (`shipped`)
3. Driver:
   - complete delivery dapat langsung `completed` jika invoice sudah `cod_pending`
   - atau record payment COD dulu/lalu complete (dua urutan didukung)
4. Finance verify setoran COD:
   - update debt driver
   - finalize invoice `paid`
   - finalize order `completed` untuk order yang valid

### C. `cash_store`

1. Flow order sama (`pending` -> `waiting_invoice` -> `ready_to_ship`)
2. Driver complete:
   - jika payment sudah `paid` -> `completed`
   - jika belum -> `delivered` sampai settlement.

## 4. Cabang Edge Case Wajib

- Promo invalid/expired/limit habis -> checkout ditolak.
- Customer status non-aktif/banned -> checkout/auth ditolak.
- Invoice gabungan multi-order:
  - hanya customer + payment method yang sama.
- Partial fulfillment:
  - shortage tercatat di `backorder`.
  - `cancel-backorder` mengubah qty item + total order tanpa harus cancel seluruh order.
- Driver issue report:
  - order dipaksa `hold`.
  - `courier_id` dilepas.
- Missing item complaint (customer):
  - hanya valid setelah delivered/completed.

## 5. Titik Rentan & Patch yang Sudah Diterapkan

Sudah diterapkan pada patch ini:
- `AuthGuard v2`:
  - JWT secret wajib dari env.
  - re-validasi user ke DB (role/status terbaru) pada setiap request autentikasi.
- Upload policy:
  - whitelist MIME `jpeg/png/webp`
  - limit file 5MB
  - filename extension dinormalisasi aman.
- Error handling:
  - business error tidak ditimpa menjadi 500 generik di modul kritikal.
- Promo race:
  - lock row `Setting('discount_vouchers')` saat checkout.
- Allocation safety:
  - status `delivered/completed` tidak lagi editable/reallocatable.
- COD order-id mismatch:
  - `recordPayment` tidak lagi mencampur invoice id sebagai order id.
- Idempotency key (database-backed/shared, TTL 10 menit):
  - aktif pada `checkout`, `driver recordPayment`, `finance verifyDriverCod`.
- Central status transition guard:
  - util `orderTransitions` dipakai pada alur mutasi status utama.

## 6. Residual Risk / Next Patch

- Idempotency payload replay bergantung pada ketersediaan tabel `idempotency_keys` (wajib ada jika `DB_SYNC_MODE=off`).
- Normalisasi status legacy (`waiting_payment`) masih tersebar dan perlu konsolidasi penuh.
- Perlu integrasi transition guard ke endpoint status lain agar seluruh mutasi benar-benar satu pintu.

## 7. Uji Verifikasi Minimum

Happy flow:
1. Transfer manual end-to-end sampai `completed`.
2. COD end-to-end + debt sinkron.
3. Partial fulfillment + cancel backorder.

Negative flow:
1. Token lama untuk user yang dibanned -> ditolak.
2. Upload file non-image atau >5MB -> ditolak.
3. Replay POST dengan idempotency key sama -> tidak duplikasi efek.
4. Driver non-owner ubah payment method -> 403.

Regression:
1. Event `order:status_changed` tetap teremit untuk role target.
2. Jurnal finance tidak double-post karena retry request.
