# Production Readiness Improvements (Frontend)

Dokumen ini merangkum hal-hal yang **masih perlu ditingkatkan** agar aplikasi lebih aman untuk **alur penjualan + pencatatan** saat masuk produksi.

Konteks keputusan yang sudah dikunci:
- Build engine: **Webpack** (`next build --webpack`).
- Validasi data: **TypeScript-only** (tanpa Zod/runtime validation).
- Payment method yang dipakai: **Transfer Manual + COD**.

## 0) Status build saat ini (baseline)
Target teknis sudah tercapai di mesin ini:
- `npx -C front_end tsc --noEmit --pretty false`: **0 error**
- `npm -C front_end run build`: **sukses** (webpack)
- `typescript.ignoreBuildErrors`: **sudah dihapus** dari `front_end/next.config.ts`
- `npm -C front_end run lint`: **exit 0**, namun masih ada **warning** (lihat bagian 1)

Jika target “aplikasi siap jadi” = **0 warning lint**, maka poin-poin di bawah wajib dibereskan.

---

## 1) Kualitas code (wajib untuk 0 warning lint)

### 1.1. Hapus bypass `no-explicit-any`
Saat ini beberapa file memakai:
`/* eslint-disable @typescript-eslint/no-explicit-any */`

File yang terdampak:
- `front_end/components/orders/AdminOrdersWorkspace.tsx`
- `front_end/app/orders/[id]/page.tsx`
- `front_end/app/admin/finance/issue-invoice/page.tsx`
- `front_end/app/driver/page.tsx`
- `front_end/app/driver/precheck/page.tsx`
- `front_end/app/driver/verifikasi-dana/page.tsx`
- `front_end/app/driver/orders/[id]/page.tsx`
- `front_end/app/driver/orders/[id]/checklist/page.tsx`

Peningkatan yang dibutuhkan:
- Ganti `any` → tipe yang lebih tepat (minimal `unknown` + type guard, atau DTO spesifik dari `front_end/lib/apiTypes.ts`).
- Cabut comment disable per file setelah `any` habis.

Kenapa ini penting untuk produksi:
- `any` membuat akses field “selalu dianggap benar” → bug UI bisa lolos review dan baru muncul saat transaksi nyata.

### 1.2. Bereskan warning lint yang tersisa (saat ini)
Di `front_end/components/orders/AdminOrdersWorkspace.tsx` masih ada:
- `@typescript-eslint/no-unused-vars`: `hasAllocationShortage` tidak dipakai.
- `react-hooks/exhaustive-deps`: `useMemo` missing dependency `backorderTopupDrafts`.

Peningkatan yang dibutuhkan:
- Hapus/ gunakan `hasAllocationShortage`.
- Perbaiki dependency array `useMemo` (atau refactor agar stabil tanpa melanggar rules of hooks).

Acceptance untuk bagian ini:
- `npm -C front_end run lint` → **0 warning, 0 error**.

---

## 2) Risiko fungsional (penjualan + pencatatan) dan mitigasinya

Karena kita **tidak menambah runtime validation**, maka mitigasi harus dilakukan via:
- typing yang lebih ketat di UI (minim `unknown` + guard),
- normalisasi value sebelum dipakai (String/Number/Array.isArray),
- dan UAT end-to-end yang disiplin.

### 2.1. Jalur Transfer Manual (customer → finance)
Risiko yang perlu dijaga:
- Invoice/Order salah status (misread `payment_status`, `waiting_admin_verification`).
- Upload bukti transfer salah target invoice (invoiceId salah / halaman salah).
- UI menampilkan total/qty salah → customer/finance salah ambil keputusan.

Wajib diuji di staging:
- Customer membuat order → invoice terbit → buka `/invoices/[invoiceId]`.
- Upload bukti: `/invoices/[invoiceId]/upload-proof` (file upload berhasil, refresh status).
- Finance verifikasi (pastikan UI customer berubah sesuai status yang benar).
- Pastikan halaman order detail `/orders/[id]` mengikuti status invoice (tidak bertentangan).

Data yang harus dicek konsisten:
- `invoice.total`, `payment_status`, `payment_method`, `payment_proof_url`.

### 2.2. Jalur COD (driver → finance)
Risiko yang perlu dijaga:
- COD dianggap lunas di sisi customer, tapi dana belum disettle di sisi internal.
- Salah agregasi invoice COD (menggabungkan order yang tidak semestinya).
- Nilai “cash_on_hand” driver salah tampil → salah keputusan settlement.

Wajib diuji di staging:
- Order berstatus COD → shipped/delivered → masuk `cod_pending`.
- Driver buka:
  - `/driver/verifikasi-dana` (list invoice COD + total dana benar)
  - `/driver/history` (riwayat delivered/complete)
- Finance menyettle COD (pastikan perubahan status tercermin di UI driver & finance).

Data yang harus dicek konsisten:
- `invoice.payment_method = cod`
- `invoice.payment_status = cod_pending` (atau status final sesuai desain)
- `wallet.cash_on_hand` sesuai agregasi invoice COD yang belum disettle.

---

## 3) Halaman kritikal yang harus “paling ketat”
Jika waktu terbatas, fokus pengetatan typing + guard runtime pada:
- Checkout & pembuatan order: `front_end/app/checkout/page.tsx`
- Order detail customer: `front_end/app/orders/[id]/page.tsx`
- Issue invoice (finance/admin): `front_end/app/admin/finance/issue-invoice/page.tsx`
- Invoice detail & print: `front_end/app/invoices/[invoiceId]/page.tsx`, `front_end/app/invoices/[invoiceId]/print/page.tsx`
- Admin order workspace (alokasi, backorder): `front_end/components/orders/AdminOrdersWorkspace.tsx`
- Driver precheck + checklist: `front_end/app/driver/precheck/page.tsx`, `front_end/app/driver/orders/[id]/checklist/page.tsx`

Target peningkatan:
- minimalkan `any`,
- pastikan null/undefined aman,
- dan pastikan angka (`qty`, `total`) selalu diparsing dengan benar sebelum dihitung/ditampilkan.

---

## 4) Go-live checklist (praktis)

### 4.1. CI/command gate
Wajib hijau:
- `npm -C front_end run typecheck`
- `npm -C front_end run build`
- `npm -C front_end run lint` (**0 warning** sesuai target)

### 4.2. Environment produksi
Pastikan value berikut benar:
- `NEXT_PUBLIC_API_URL` (origin + `/api/v1`)
- `NEXT_PUBLIC_IMAGE_HOSTS` (host gambar eksternal jika ada)
- Rewrites `/api/*` dan `/uploads/*` bekerja di domain produksi.

### 4.3. Observability & rollback
Minimal:
- Error monitoring untuk halaman checkout/order/invoice (Sentry atau setara).
- Rencana rollback (tag image/commit terakhir yang stabil).
- Freeze window deploy + 1 orang on-call saat jam transaksi.

---

## 5) Roadmap singkat menuju “siap jadi”
Urutan yang disarankan:
1) Jadikan lint **0 warning** (hapus unused + hook deps warning).
2) Hapus semua `eslint-disable no-explicit-any` dengan mengganti `any` → tipe aman.
3) Jalankan UAT staging untuk 2 jalur: **Transfer Manual** dan **COD** (bagian 2).
4) Pasang monitoring + jalankan go-live checklist (bagian 4).

