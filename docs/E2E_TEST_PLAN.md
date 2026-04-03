# Rencana End-to-End Testing (E2E) — Migunani Motor

Dokumen ini adalah rencana praktis untuk membuat **E2E testing** yang repeatable untuk Migunani Motor (frontend Next.js + backend Express + MySQL), dengan memaksimalkan artefak test yang **sudah ada** di repo.

## 1) Definisi & Tujuan

**E2E (di project ini)** = validasi alur bisnis lintas layer:
UI (Next.js) → API (Express `/api/v1`) → DB (MySQL) + side-effect kritikal (stok, jurnal, status, ownership, upload policy, socket refresh).

Tujuan utama:
- Menjaga flow **P0** (uang, stok, auth/ownership, status order) dari regresi.
- Mengurangi smoke manual sebelum release (ganti jadi suite otomatis).
- Menyediakan evidence PASS/FAIL yang konsisten untuk `go / no-go`.

Non-goal (tetap butuh manual/terpisah):
- E2E “real” WhatsApp (login QR, koneksi perangkat, inbound message real).
- Validasi bank/mutasi real (cukup lewat contract + replay/idempotency).

## 2) Gambaran Sistem yang Diuji (SUT)

Entry point run:
- Dev lokal: `npm run dev` (root) + MySQL via Docker (`docker compose up -d mysql`).
- Bootstrap clean DB + seed: `npm run docker:bootstrap`.
- Start helper: `./start.sh` (menyalakan DB + optional seed + `npm run dev`).

Service utama:
- Frontend: Next.js (dev default `http://localhost:3000`; docker prod-like lihat `FRONTEND_PORT`/compose).
- Backend: Express `http://localhost:5000` (base API: `/api/v1`).
- DB: MySQL `localhost:3306`.

Role & akun seed (dipakai sebagai test actor):
- `superadmin@migunani.com` / `superadmin123`
- `gudang@migunani.com` / `gudang123`
- `finance@migunani.com` / `finance123`
- `kasir@migunani.com` / `kasir123`
- `driver@migunani.com` / `driver123`
- `customer@migunani.com` / `customer123`

Referensi kontrak:
- API & RBAC: `back_end/docs/API_Contract.md`
- Contract state map transaksi: `back_end/docs/TRANSACTION_CONTRACT_MAP.md`
- Daftar halaman frontend: `front_end/PAGE_LIST.md`

## 3) Artefak Test yang Sudah Ada (Wajib Dimanfaatkan)

Backend runtime regression/gate (sudah siap pakai):
- Runner: `back_end/src/scripts/transaction_assurance.ts`
- Command: `cd back_end && npm run test:transaction-assurance`
- Isi gate: action matrix, ownership, finance replay, notification soft-fail, boundary read, upload policy.

Matriks eksekusi & evidence:
- `back_end/docs/TRANSACTION_EXECUTION_MATRIX.md`
- `back_end/docs/RELEASE_GATE_EXECUTION_SHEET.md`
- `back_end/docs/SYSTEM_READINESS_SUMMARY.md`
- Skenario lengkap: `back_end/docs/FULL_SYSTEM_SCENARIO_MATRIX.md`

Frontend smoke manual (baseline sekarang):
- `front_end/POST_CLEANUP_SMOKE_CHECKLIST.md`

## 4) Strategi E2E: 2 Jalur (API Gate + UI E2E)

### A. Gate cepat (wajib di PR/merge)

Target: < 10–15 menit, repeatable, fokus P0.

Komponen:
1) Frontend lint: `cd front_end && npm run lint`
2) Backend compile: `cd back_end && ./node_modules/.bin/tsc --noEmit --pretty false`
3) Backend transaction gate: `cd back_end && API_BASE_URL=http://127.0.0.1:5000/api/v1 npm run test:transaction-assurance`
4) UI smoke E2E (otomasi) untuk halaman yang saat ini masih “PENDING MANUAL” di release gate:
   - `/driver`
     - Validasi: jika 1 customer punya >1 invoice aktif (mis. split invoice), halaman harus menampilkan semua invoice (count “Invoice” tidak collapse jadi 1).
   - `/driver/orders/[id]`
   - `/admin/finance/*` (minimal COD/settlement area yang dipakai operasional)
   - `/admin/orders/customer/[customerId]?section=checker` & `?section=pengiriman` (badge “Qty dialokasikan / SKU dialokasikan” harus ikut terhitung, tidak stuck `0`)
   - `/admin/orders/customer/[customerId]?section=allocated`
     - Validasi: saat masih ada order `waiting_invoice`, panel “Terbitkan Invoice” menampilkan tombol **Issue Invoice** (bukan hint invoice tambahan).
     - Validasi: jika tidak ada `waiting_invoice` tapi ada alokasi baru (invoice tambahan), panel menampilkan hint **Issue Invoice Tambahan**.
   - `/admin/orders?section=gudang` (atau lane “Proses Gudang”)
     - Validasi: setelah “Tunjuk Driver” untuk beberapa invoice, kartu invoice pindah ke lane checker tanpa hard refresh.
   - `/orders/[id]`
   - `/invoices/[invoiceId]` (jika route aktif di UI build terbaru)

Catatan penting:
- UI smoke suite **boleh setup data via API** (lebih cepat/stabil) lalu UI hanya memverifikasi render + guard + data utama tidak `NaN/undefined`.
- UI smoke suite **tidak perlu** menjalankan seluruh workflow di UI (itu masuk nightly).

### B. Workflow suite (nightly / pre-release)

Target: cover full alur bisnis end-to-end yang kritikal dan berpotensi regresi.

Minimal nightly:
- Transfer manual: checkout → upload proof → finance approve → ship → driver complete → order selesai.
- COD: checkout COD → ship → driver complete → finance settlement → order selesai.
- Allocation/backorder: alokasi parsial → cancel backorder → issue invoice parsial → status tetap konsisten.
- Retur/refund: create retur → approve/pickup assigned → refund disburse → received/complete.
- RBAC/ownership spot-check: akses resource orang lain harus 403/404 sesuai contract.
- Upload policy: MIME/size invalid untuk proof/attachment wajib 400 (UI menampilkan error yang jelas).

## 5) Environment & Data Strategy (agar tes tidak flaky)

### Rekomendasi standar “clean run”

Untuk run yang butuh deterministik (CI/nightly):
- Start dari DB fresh: `npm run docker:bootstrap` (ini `down -v` + seed + start service).
- Pastikan WhatsApp tidak menghambat tes:
  - set `WA_AUTO_INIT=false` saat tes (env/compose override).

### Prinsip data test

- Gunakan akun seed sebagai actor; buat data transaksi (order/invoice/retur) **secara terkontrol**.
- Pilih 1 dari 2 pendekatan (boleh kombinasi):
  1) **API-driven fixture**: tes membuat order/invoice lewat endpoint yang sama seperti UI (cepat, minim selector brittle).
  2) **DB fixture**: script khusus untuk membuat “1 order per status” (lebih cepat untuk UI smoke, tapi butuh disiplin migrasi).
- Reset strategy harus jelas:
  - Suite gate: boleh re-use DB seeded, tapi wajib “namespace” data via marker (mis. `customer_note`/`note` mengandung prefix test run).
  - Suite nightly: prefer DB fresh per run.

## 6) Tooling yang Disarankan (untuk UI E2E)

UI E2E:
- Disarankan: **Playwright** (headless, trace, parallel, stabil untuk Next.js).
- Lokasi proyek test: pilih salah satu:
  - Root `e2e/` (lebih netral lintas frontend/backend), atau
  - `front_end/e2e/` (lebih dekat ke Next).

Konvensi yang wajib agar selector stabil:
- Tambahkan `data-testid` pada tombol/field kritikal (login, checkout, approve, ship, complete).
- Hindari selector berbasis teks yang sering berubah (wording/SOP).

Reporting:
- Simpan artefak pada failure: screenshot + trace + console error.
- Minimal output yang dicari: “PASS/FAIL + link report”.

## 7) Pemetaan Prioritas (apa yang diotomasi dulu)

Urutan implementasi yang paling berdampak (mengurangi manual release gate):
1) UI smoke untuk halaman yang ada di `back_end/docs/RELEASE_GATE_EXECUTION_SHEET.md` (driver + finance + customer detail).
2) Full workflow transfer manual end-to-end.
3) Full workflow COD + settlement end-to-end (ingat contract note COD).
4) Retur/refund end-to-end.
5) Inventory import (preview/commit) + purchase order.
6) Chat (web widget) + admin inbox (tanpa WA real).

Referensi skenario/detail step-by-step:
- `back_end/docs/TRANSACTION_CONTRACT_MAP.md`
- `back_end/docs/TRANSACTION_EXECUTION_MATRIX.md`
- `back_end/docs/FULL_SYSTEM_SCENARIO_MATRIX.md`

## 8) Definition of Done (DoD) untuk E2E yang “siap jadi gate”

Sebuah test boleh masuk gate PR kalau:
- Tidak pakai `sleep()` untuk nunggu state (pakai wait-for response/selector).
- Tidak tergantung jam lokal / data random tanpa seed.
- Gagalnya test memberi info root-cause cepat (URL, actor, status terakhir, screenshot/trace).
- Lulus stabil minimal 3x rerun berturut-turut di environment yang sama.

## 9) Roadmap Implementasi (disarankan)

Milestone 1 — “Gate siap jalan”:
- Standarkan env E2E (WA off, DB fresh).
- Jadikan `test:transaction-assurance` + lint sebagai gate wajib.
- Tambah UI smoke otomatis untuk 3–5 halaman release-gate (render + guard + data inti).

Milestone 2 — “Workflow P0 aman”:
- Otomasi 2 workflow penuh: transfer manual + COD settlement.
- Tambah satu skenario backorder/parsial + satu skenario retur/refund.

Milestone 3 — “Coverage melebar tanpa menambah flakiness”:
- Tambah RBAC/ownership spot-check lintas modul.
- Tambah inventory import/PO + chat web widget (tanpa WA real).

## 10) Runbook Eksekusi (lokal/CI)

Baseline clean run (direkomendasikan):
1) `cp .env.example .env`
2) `npm run docker:bootstrap`
3) Jalankan app (pilih salah satu):
   - Dev lokal: `npm run dev`
   - Docker prod-like: `docker compose up -d --build`
4) Jalankan backend gate:
   - `cd back_end && API_BASE_URL=http://127.0.0.1:5000/api/v1 npm run test:transaction-assurance`

Catatan CI:
- Untuk CI, jalankan DB fresh per run (`docker compose down -v` di awal job) supaya hasil deterministik.
- Matikan WA auto init saat CI (`WA_AUTO_INIT=false`) agar tidak menunggu Chromium/QR.
