# Production Go-Live Runbook (Sales + Accounting)

Dokumen ini adalah checklist eksekusi **go-live** untuk memastikan alur **penjualan** dan **pencatatan** aman, khusus untuk metode pembayaran **Transfer Manual + COD**.

Scope:
- Frontend: `front_end/`
- Backend: `back_end/`

Target utama:
1) Tidak ada transaksi dobel / status “regress”.
2) Status order/invoice konsisten dari customer → admin/finance → driver.
3) Posting akuntansi & settlement COD tercatat benar.

---

## A. Gates (wajib hijau sebelum rilis)

### A1) Frontend gates
- `npm -C front_end run typecheck`
- `npm -C front_end run build`
- `npm -C front_end run lint` (target ideal: **0 warning**)

Catatan:
- Jika masih ada warning lint, tentukan apakah warning tersebut diterima sebagai risiko. Untuk “aplikasi siap jadi”, rekomendasi: **0 warning**.

### A2) Backend gates
- `npm -C back_end run build`
- Regression (staging/prod-like):
  - `npm -C back_end run test:upload-policy`
  - `npm -C back_end run test:ownership-matrix`
  - `npm -C back_end run test:finance-replay`
  - (opsional tapi sangat disarankan) `npm -C back_end run test:transaction-assurance`

### A3) Konfigurasi environment (wajib benar)
- Backend:
  - `JWT_SECRET` terisi dan aman.
  - `DB_*` sesuai env produksi.
  - WA/notification (jika dipakai) kredensial benar.
- Frontend:
  - `NEXT_PUBLIC_API_URL` benar.
  - `NEXT_PUBLIC_IMAGE_HOSTS` benar (jika ada host eksternal).
  - Rewrites `/api/*` dan `/uploads/*` bekerja di domain produksi.

### A4) Rollback readiness
- Artifact rollback siap (image/tag/commit).
- Prosedur rollback 1 halaman: siapa yang mengeksekusi + langkah cepat + verifikasi setelah rollback.

---

## B. Observability (wajib aktif saat go-live)

Minimal yang harus terlihat:
- Backend log untuk request error (4xx/5xx) pada endpoint transaksi.
- Frontend error monitoring (minimal error boundary + capture route checkout/order/invoice).

Alert yang disarankan:
- Lonjakan HTTP 409 pada endpoint kritikal (idempotency conflict / transition not allowed).
- Gagal upload proof (invoice/order).
- Gagal settlement COD.
- Gagal posting jurnal / goods-out.

---

## C. SOP Teknis: Idempotency & Double Submit

Tujuan: mencegah transaksi ganda saat user klik ulang / koneksi buruk.

### C1) Header yang dipakai
- Untuk request kritikal, kirim `Idempotency-Key` yang unik per aksi.

### C2) Aksi yang wajib idempotent
- Checkout order (customer).
- Issue invoice (kasir).
- Verify / void payment (admin finance).
- Driver record payment COD.
- Finance settlement COD.

### C3) Aturan operasional
- Jika UI menampilkan “sedang memproses”, jangan refresh/klik ulang.
- Jika terjadi 409 (conflict), ulangi dengan key yang benar atau tunggu proses selesai.

---

## D. UAT Staging (wajib) — Per Role

> Jalankan di staging dengan DB mirror (production-like). Catat hasil di bagian “Hasil UAT”.

### D1) Customer — Transfer Manual
1. Buat order dari `catalog → cart → checkout`.
2. Pastikan order tercatat dan bisa dibuka di `/orders/[id]`.
3. Setelah invoice ada:
   - Buka `/invoices/[invoiceId]`.
   - Upload bukti transfer di `/invoices/[invoiceId]/upload-proof`.
4. Pastikan status berubah ke `waiting_admin_verification` (atau indikator “menunggu verifikasi”).
5. **Negative test:** coba upload proof untuk invoice lama (jika invoice sudah diganti) → harus ditolak.
6. **Negative test:** coba upload proof ketika order sudah `shipped/delivered/completed` → harus ditolak (status tidak boleh “mundur”).

### D2) Finance — Verifikasi Transfer Manual
1. Temukan invoice yang sudah ada proof.
2. Verifikasi **approve**:
   - invoice `paid`
   - order menjadi `completed` atau `partially_fulfilled` (tergantung backorder)
   - jurnal verifikasi payment terbentuk (AR → cash/bank).
3. Verifikasi **reject**:
   - invoice kembali `unpaid` dan proof dihapus (atau status sesuai kebijakan)
   - order masuk `hold` (tidak boleh lanjut gudang)
   - tidak boleh ada jurnal paid.

### D3) Driver — COD (collect)
1. Ambil order COD yang sudah “siap dikirim”.
2. Pastikan driver bisa melihat invoice/order di `/driver` dan `/driver/orders/[id]`.
3. Setelah delivered:
   - catat pembayaran COD (nominal harus tepat total)
   - pastikan invoice `cod_pending`
   - pastikan wallet/eksposur driver berubah (`/driver/verifikasi-dana` / endpoint wallet).
4. **Negative test:** nominal tidak sama total → harus ditolak.

### D4) Finance — Settlement COD
1. Buka daftar COD pending driver.
2. Lakukan settlement:
   - invoice `paid`
   - `CodCollection` menjadi `settled`
   - `CodSettlement` terbentuk
   - jurnal cash vs piutang driver terbentuk
   - status order finalized (`completed`/`partially_fulfilled`).
3. **Negative test:** coba “verifyPayment” jalur finance untuk invoice COD → harus ditolak (harus lewat settlement).

### D5) Admin Gudang/Kasir — Issue Invoice + Shipping
1. Pastikan hanya order “waiting_invoice” yang bisa diterbitkan invoice.
2. Issue invoice batch:
   - order_ids benar (tidak bercampur customer)
   - payment_method invoice sesuai (transfer_manual/cod).
3. Assign driver:
   - memastikan posting goods-out terjadi sekali (cek `goods_out_posted_at` dan jurnal idempotent).

---

## E. Smoke checks produksi (30–60 menit pertama)

- 1 transaksi transfer manual end-to-end (real/limited).
- 1 transaksi COD end-to-end (real/limited).
- Cek:
  - status order/invoice konsisten di customer + admin/finance + driver
  - angka total dan qty tidak berubah aneh
  - jurnal/settlement tercatat (minimal sampling 1 case).

---

## F. Hasil UAT (isi saat eksekusi)

Tanggal UAT:
- Env:
- Versi deploy:

### Transfer Manual
- Checkout: PASS/FAIL
- Upload proof: PASS/FAIL
- Finance approve: PASS/FAIL
- Finance reject: PASS/FAIL
- Negative test “status regression”: PASS/FAIL

### COD
- Driver record payment: PASS/FAIL
- COD pending exposure/wallet: PASS/FAIL
- Finance settlement: PASS/FAIL
- Negative test “verifyPayment COD blocked”: PASS/FAIL

### Catatan
- Error log:
- Anomali ditemukan:
- Keputusan: GO / NO-GO

