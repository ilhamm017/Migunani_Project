# Backend Production Re-check (Sales + Accounting)

Dokumen ini adalah hasil **cek ulang cepat** sisi backend (berdasarkan review kode di repo ini), dengan fokus pada **alur penjualan** dan **pencatatan (finance/accounting)** untuk 2 metode pembayaran: **Transfer Manual** + **COD**.

> Catatan penting: ini bukan pengganti UAT/staging. “Aman” secara produksi tetap perlu dibuktikan dengan eksekusi skenario end-to-end terhadap DB staging/production-like.

## 1) Auth & RBAC (akses)

Yang dicek:
- `back_end/src/middleware/authMiddleware.ts`:
  - JWT diverifikasi dengan `JWT_SECRET` wajib ada.
  - `req.user` diisi dari DB user (cek status `active`).
  - `authorizeRoles(...)` menolak role di luar daftar.
- Routing utama memakai `authenticateToken` sebelum endpoint sensitif:
  - Finance: `back_end/src/routes/finance.ts` memakai `router.use(authenticateToken)` + per-endpoint `authorizeRoles`.
  - Driver: `back_end/src/routes/driver.ts` memakai `router.use(authenticateToken)` + per-endpoint `authorizeRoles`.
  - Orders: `back_end/src/routes/order.ts` memakai `authenticateToken` + `authorizeRoles` untuk admin routes.
  - Invoices: `back_end/src/routes/invoice.ts` memakai `authenticateToken` (kontrol akses dilakukan di controller).

Kesimpulan:
- Pola RBAC-nya **terlihat konsisten** untuk jalur transaksi/finance/driver.
- Endpoint invoice tidak memakai `authorizeRoles` di router, namun controller menerapkan pemeriksaan akses:
  - `getInvoiceDetail` membatasi akses untuk customer/driver/role admin tertentu.
  - `uploadInvoicePaymentProof` memastikan invoice milik customer & `payment_method=transfer_manual`.
  - `assignInvoiceDriver` membatasi role `super_admin`/`admin_gudang`.

## 2) Transfer Manual (customer upload proof → finance verify)

Komponen kunci:
- Upload bukti transfer (invoice): `back_end/src/controllers/InvoiceController.ts#uploadInvoicePaymentProof`
  - wajib milik customer, method `transfer_manual`, belum `paid`, belum ada proof, dan invoice bukan invoice “lama” (dicek latest invoice per order).
  - update status order terkait ke `waiting_admin_verification`.
- Verifikasi finance: `back_end/src/controllers/finance/payment.ts#verifyPayment`
  - menolak approve untuk COD/Cash Store (harus lewat settlement).
  - untuk transfer manual: wajib ada proof, lalu set invoice `paid` + posting jurnal (AR/cash) + transisi order sesuai backorder (completed vs partially_fulfilled).

Hal yang sudah bagus:
- Keduanya memakai **transaction + row lock**.
- Ada emit event/refresh untuk badge/status.

## 3) COD (driver record payment → finance settlement)

Komponen kunci:
- Driver catat bayar COD: `back_end/src/controllers/driver/payment.ts#recordPayment`
  - cari invoice COD yang unpaid/draft, validasi nominal harus sama total invoice (toleransi 0.01), set `payment_status=cod_pending`, catat `CodCollection`, update debt driver via `calculateDriverCodExposure`.
  - transaksi + retry deadlock.
- Finance settlement COD: `back_end/src/controllers/finance/cod.ts#verifyDriverCod`
  - idempotency, transaksi + lock, membuat `CodSettlement`, ubah collection jadi `settled`, set invoice jadi `paid`, update status order sesuai backorder, posting jurnal cash vs piutang driver.

Hal yang sudah bagus:
- Ada **idempotency** untuk operasi kritikal (driver record payment, finance settlement, issue invoice, void payment, checkout).
- Ada kontrol transisi status (`isOrderTransitionAllowed`) untuk mencegah status “lompat”.

## 4) Pencatatan barang keluar (goods-out) & jurnal

Komponen kunci:
- `back_end/src/services/AccountingPostingService.ts#postGoodsOutForOrder`
  - mencegah double-posting dengan `order.goods_out_posted_at`.
  - posting jurnal revenue + COGS (inventory valuation) via idempotency key per order.
  - membedakan mode `cod` vs `non_cod` (piutang driver vs deferred revenue).

Ini penting untuk produksi karena dampaknya langsung ke akuntansi.

## 5) Upload policy & audit log (operasional)

Yang dicek:
- Upload policy: `back_end/src/utils/uploadPolicy.ts`
  - limit size, whitelist mime types/ext, file disimpan under `uploads/<userId>/<folder>`.
- Audit log: `back_end/src/middleware/auditLogMiddleware.ts`
  - redact key sensitif (`password`, `token`, `payment_proof_url`, `delivery_proof_url`, dll).

Catatan operasional:
- Pastikan folder `uploads/` writable di server produksi (permission + disk space).

## 6) Database schema (FK/unique) & “aman” untuk DB kosong

Catatan:
- Setelah update migrasi Wave A–C, banyak relasi penting sudah dikunci di level DB dengan **foreign key**, **index**, dan beberapa **unique constraint** (contoh: cart, backorder, COD collection, inventory reservations/consumptions, purchasing, delivery handover, chat).
- Kalau **database benar-benar kosong (fresh)**, maka migrasi Wave A–C biasanya **aman dijalankan** karena tidak ada risiko data “orphan/duplikat” yang menghalangi pembuatan FK/unique index.

Checklist minimum supaya bisa disebut “aman” dari sisi schema:
- Jalankan migrasi sampai tidak ada yang pending:
  - `npm -C back_end run migrate:up`
  - `npm -C back_end run migrate:status`
- (Opsional, tapi direkomendasikan) Setelah DB benar-benar running, jalankan audit FK/index untuk laporan:
  - `npm -C back_end run db:fk-audit -- --out=/tmp/migunani_fk_audit.json`

Catatan produksi:
- Disarankan set `DB_SYNC_MODE=off` di production dan jalankan migrasi lewat pipeline (hindari DDL runtime berulang).
- Gunakan kredensial DB dengan prinsip **least privilege** (user aplikasi tidak perlu hak `DROP`/`ALTER` jika migrasi dijalankan terpisah).

## 7) Yang masih wajib dibuktikan (sebelum go-live)

Walaupun kode terlihat “cukup aman”, hal berikut tetap harus dilakukan:
- Jalankan UAT staging end-to-end untuk 2 jalur:
  - Transfer manual: upload proof → approve/reject → status order & jurnal.
  - COD: driver record payment → finance settlement → status order & jurnal.
- Jalankan regression scripts terhadap staging (server harus running):
  - `back_end/src/scripts/regression_finance_replay.ts`
  - `back_end/src/scripts/regression_ownership_matrix.ts`
  - `back_end/src/scripts/regression_upload_policy.ts`

## 8) Quick “go/no-go” backend (ringkas)

Go lebih aman jika:
- Tidak ada error di log saat skenario UAT.
- Tidak ada jurnal dobel (cek idempotency + `goods_out_posted_at`).
- COD exposure/debt driver konsisten sebelum & sesudah settlement.
- Upload proof transfer tidak bisa dilakukan untuk invoice “lama” (sudah digantikan).

## 9) WhatsApp testing mode (isolated)

Untuk testing sementara (mis. ambil data grup/chat pribadi) tanpa nyimpen status koneksi ke sistem:
- Pakai env `WA_SESSION_PATH=./.wwebjs_auth_test` supaya session LocalAuth terpisah.
- Set `WA_PERSIST_STATUS_TO_DB=false` supaya `settings.key='whatsapp_session'` tidak di-update.
- Jalankan `back_end/scripts/start_wa_test.sh` (buat `back_end/.env.wa_test` dari `back_end/.env.wa_test.example`).

Ambil daftar nama grup (tanpa nyimpen ke DB):
- Jalankan dari `back_end/`:
  - `ENV_FILE=.env.wa_test npm run wa:export-groups`
- Output JSON tersimpan di `back_end/testing/wa_groups_<timestamp>.json` (folder ini di-ignore git).

Fitur scraping grup order (admin-only):
- Set env `WA_SCRAPE_ENABLED=true` untuk mengaktifkan endpoint scraping.
- Daftar grup via `GET /api/v1/whatsapp/groups` lalu buat scrape session via `POST /api/v1/whatsapp/scrape/sessions`.
