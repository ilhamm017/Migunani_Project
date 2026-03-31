# Rencana Perbaikan: Diskon Tier vs Master Price (2026-03-31)

## Ringkasan Masalah
Kasus: `customer1@migunani.com` (tier **gold**) melihat diskon hanya ~**5%** untuk produk `BL IRC TT 275-17 NR 60`, padahal kategori mengatur diskon gold **29%**.

### Dampak
- Katalog customer menampilkan diskon yang salah.
- Manual order / POS admin bisa menghitung harga tier yang salah (karena logika pemilihan sumber diskon terblokir oleh “tier price” placeholder).

## Akar Masalah (Root Cause)
Di DB, banyak produk menyimpan `varian_harga.prices.gold` (dan tier lain) yang **sama persis** dengan `varian_harga.prices.regular` (placeholder), sementara `products.price` bisa berbeda (mis. naik karena update harga jual).

Resolver harga sebelumnya memprioritaskan “direct tier price” (`varian_harga.prices.<tier>`) tanpa mendeteksi bahwa nilainya hanya duplikasi regular. Akibatnya:
- Resolver berhenti di `prices.gold` → diskon jadi `(products.price - prices.gold) / products.price`.
- Diskon kategori (`categories.discount_gold_pct`) tidak pernah dipakai.

## Status Perbaikan Kode (Sudah)
1. Backend: `resolveEffectiveTierPricing(...)` sekarang **mengabaikan** “direct tier price” yang nilainya sama dengan harga regular varian (placeholder), sehingga diskon kategori bisa terpakai.
2. Frontend Admin (POS + Manual Order): logika client-side yang memilih “direct tier price” disamakan dengan backend (mengabaikan placeholder tier price).

## Rencana Deploy (1 hari)
1. Deploy backend + frontend ke environment yang dipakai (docker compose).
2. Smoke test minimal:
   - Katalog customer (login customer gold) cari SKU/produk tersebut → diskon tampil 29%.
   - Manual order create `/admin/orders/create?customerId=...` tambah produk tersebut → unit price otomatis sesuai kategori 29%.
   - POS `/admin/pos` tambah produk tersebut untuk customer gold → harga sesuai kategori.

## Audit Data (Wajib sebelum “data fix”)
Jalankan audit untuk mengukur seberapa luas mismatch `products.price` vs `varian_harga.prices.regular`, dan seberapa banyak `prices.<tier>` hanya placeholder.

- Gunakan: `scripts/sql/audit_tier_pricing.sql`
- Tambahan (estimasi impact lebih “langsung” untuk kasus placeholder): `scripts/sql/audit_tier_pricing_impact.sql`
- Output penting:
  - Produk dengan `products.price != varian_harga.prices.regular`
  - Produk dengan `prices.gold == prices.regular` (placeholder)
  - Kategori yang punya diskon tier (non-null) dan terdampak oleh placeholder

## Audit Transaksi (Disarankan karena berdampak ke pembayaran)
Jika bug sempat terjadi di production, dampaknya bukan cuma tampilan katalog, tapi juga bisa “snap” ke transaksi (order) karena `order_items.price_at_purchase` + `pricing_snapshot` disimpan saat checkout.

- Gunakan shortlist ini untuk verifikasi manual + rencana kompensasi:
  - `scripts/sql/audit_order_items_tier_pricing_overcharge.sql`
- Catatan:
  - Script ini bersifat **heuristic** (menandai kandidat). Kalau ada produk yang memang sengaja punya override tier-per-item, bisa ikut ter-flag.
  - Untuk POS, saat ini data snapshot yang disimpan lebih terbatas (tidak selengkap `order_items.pricing_snapshot`), jadi audit POS yang presisi membutuhkan penambahan snapshot (opsional improvement).

## Opsi Perbaikan Data (Opsional, setelah audit)
Tujuan: membuat data lebih “bersih” dan mengurangi kebingungan di masa depan.

### Opsi A (Aman): Biarkan data, bergantung pada guard logic
- Tidak mengubah DB massal.
- Mengandalkan resolver yang sudah “tahan placeholder”.
- Cocok jika `varian_harga` dipakai hanya sebagai arsip/legacy.

### Opsi B (Sedang): Normalisasi `varian_harga` placeholder
- Untuk produk yang:
  - `prices.gold == prices.regular` dan `discounts_pct.gold == 0`, dst.
- Ubah struktur JSON agar tier placeholder tidak dianggap override (mis. hapus key tier atau set `null`).
- Wajib lakukan backup + dry-run + sampling sebelum apply massal.
- Script siap pakai: `scripts/sql/normalize_varian_harga_placeholder_tier_prices.sql` (idempotent).

### Opsi C (Lebih besar): Tegaskan “single source of truth”
Putuskan dan dokumentasikan:
- `products.price` adalah “master selling price (regular)”, dan tier dihitung dari kategori/override; atau
- `varian_harga` adalah “master harga tier”, dan `products.price` hanya cache regular.

Lalu rapikan semua writer (import/bulk update/update tier pricing) agar konsisten.

## Guardrails (Disarankan)
1. Saat `bulkUpdateTierDiscounts` / import menulis `varian_harga`:
   - Jika tier price sama dengan regular dan diskon 0 → pertimbangkan tidak menulis tier tersebut (atau tandai sebagai placeholder).
2. Tambah endpoint/admin banner di modul “Tier Pricing”:
   - Warning jika `products.price` berbeda dari `varian_harga.prices.regular` (indikasi mismatch).

## Regression Checklist
Tambahkan test/cek otomatis (minimal integration-ish) untuk skenario:
- `products.price` berubah, `varian_harga.prices.*` tetap regular, kategori punya diskon tier → diskon kategori harus menang.
- Tier override yang benar-benar berbeda dari regular → tier override harus menang.

## Rollback Plan
Jika setelah deploy ada harga salah:
1. Rollback image backend + frontend ke versi sebelumnya.
2. Karena perubahan utama bersifat “pemilihan sumber diskon”, tidak ada perubahan skema DB → rollback aman.
