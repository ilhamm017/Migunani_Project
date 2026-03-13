# Post-Cleanup Smoke Checklist (Per Halaman)

Dokumen ini dipakai untuk validasi cepat setelah cleanup/refactor lint frontend.
Tujuan: memastikan behavior bisnis utama tetap aman.

## 1) Aturan Eksekusi

- Jalankan backend + frontend dengan data seed yang sama seperti environment dev.
- Gunakan akun sesuai role: `super_admin`, `kasir`, `admin_gudang`, `admin_finance`, `driver`, `customer`.
- Untuk setiap item, tandai:
  - `[ ] Pass`
  - `[ ] Fail`
  - `Catatan bug/URL/console error`.

## 2) Global Smoke (Wajib Sekali di Awal)

- [ ] `npm run lint` di `front_end` harus sukses tanpa error/warning.
- [ ] Tidak ada error merah di browser console saat load `/`.
- [ ] Login/logout semua role berjalan tanpa loop redirect.
- [ ] Navigasi antar halaman tidak blank page/hydration mismatch.

## 3) Customer Pages

### `/` (Guest / Member Home)
- [ ] Guest melihat landing page, CTA ke katalog/login/register berfungsi.
- [ ] Setelah login customer, homepage member tampil, data produk termuat.
- [ ] Card invoice customer tampil konsisten (jumlah/total tidak NaN).

### `/catalog`
- [ ] Search produk berjalan (enter + tombol).
- [ ] Infinite load/scroll append tidak duplikasi item.
- [ ] Tombol add-to-cart per kartu produk berfungsi.

### `/catalog/[id]`
- [ ] Detail produk tampil (nama, harga, stok, deskripsi, kategori).
- [ ] Add-to-cart dari detail masuk ke cart dan redirect sesuai flow.
- [ ] Kondisi stok habis mem-disable tombol beli.

### `/cart`, `/checkout`, `/orders`, `/orders/[id]`
- [ ] Cart menampilkan item yang baru ditambahkan.
- [ ] Checkout sukses membuat order baru.
- [ ] Order list tampil status terbaru tanpa salah label.
- [ ] Detail order menampilkan item/total/metode bayar benar.

### `/invoices`, `/invoices/[invoiceId]`
- [ ] Invoice aktif customer tampil dan bisa dibuka.
- [ ] Data tagihan dan status pembayaran sinkron.

### `/profile/addresses`, `/profile/help`
- [ ] Tambah/hapus alamat tersimpan berjalan.
- [ ] Halaman bantuan render normal tanpa karakter rusak.

## 4) Admin Orders & Sales

### `/admin/orders`, `/admin/orders/status/[status]`
- [ ] Filter status, search, date range bekerja.
- [ ] Klik order menuju detail order yang tepat.
- [ ] Badge/tab counts tidak negatif/NaN.

### `/admin/orders/issues`
- [ ] Order bermasalah tampil sesuai status `hold`.
- [ ] Label overdue/sisa waktu tampil sesuai data.
- [ ] Link ke detail order valid.

### `/admin/sales/member-baru`
- [ ] Create member baru berhasil dengan validasi form.
- [ ] Error API tampil sebagai pesan user-friendly.

## 5) Admin Warehouse

### `/admin/warehouse/stok`
- [ ] Tabel render, sorting/filter/search/pagination normal.
- [ ] Pilih produk membuka panel detail.
- [ ] Mode edit + update field tidak merusak data tampil.

### `/admin/warehouse/pesanan`
- [ ] Kanban kolom order tampil.
- [ ] Drag-drop status valid bekerja.
- [ ] Assign courier sebelum `shipped` tetap dipaksa.

### `/admin/warehouse/helper`
- [ ] Picking list memuat item order processing.
- [ ] Konfirmasi ambil item mengubah state kartu.

### `/admin/warehouse/scanner`
- [ ] Scan manual SKU berhasil mencari produk.
- [ ] Camera mode start/stop berjalan (browser support).
- [ ] Device scanner (keyboard-enter pattern) terdeteksi.

### `/admin/warehouse/audit`, `/admin/warehouse/inbound/history`
- [ ] List audit/PO history termuat.
- [ ] Aksi create/open detail berjalan tanpa error runtime.

## 6) Admin Finance

### `/admin/finance/verifikasi`
- [ ] Tab Verify/COD/History memfilter data sesuai status.
- [ ] Preview bukti transfer image tampil.
- [ ] Approve pembayaran memicu refresh data.

### `/admin/finance/retur`, `/admin/finance/retur/[id]`
- [ ] Antrian retur tampil hanya status relevan.
- [ ] Detail retur menampilkan nominal/refund status benar.

### `/admin/finance/piutang`, `/admin/finance/piutang/[invoiceId]`
- [ ] Daftar AR dan detail invoice terbuka normal.
- [ ] Error API ditampilkan sebagai pesan yang jelas.

### `/admin/finance/biaya`, `/admin/finance/biaya/label`
- [ ] CRUD label biaya (tambah, edit, hapus) berjalan.
- [ ] Input biaya menggunakan label baru tanpa reload keras.

### `/admin/finance/laporan/*`
- [ ] PnL, Cashflow, Balance Sheet, Aging AP/AR, Inventory Value load.
- [ ] Filter tanggal/period memicu refresh data.
- [ ] Nilai summary tidak NaN/undefined di UI.

### `/admin/chat/whatsapp`
- [ ] Status WA page bisa load status + refresh.
- [ ] Guard role bekerja (role non-allowed ter-redirect).

## 7) Driver Pages

### `/driver`, `/driver/precheck`
- [ ] List tugas dan checklist status muncul.
- [ ] Badge checklist ready/pending akurat.

### `/driver/orders/[id]`, `/driver/orders/[id]/checklist`
- [ ] Checklist dapat disimpan.
- [ ] Mismatch qty memunculkan warning sesuai flow.
- [ ] Tombol lanjut pengiriman terkunci jika checklist belum valid.

### `/driver/history`
- [ ] Histori pengiriman termuat.
- [ ] Preview bukti pengiriman (zoom image) tampil normal.

### `/driver/retur/[id]`
- [ ] Update status pickup/serah kasir sesuai rule.
- [ ] Tombol chat customer membuka route yang benar.

## 8) Cross-Module Realtime & Notifications

- [ ] Event `order:status_changed` memicu refresh list halaman terkait.
- [ ] Incoming chat notifier muncul untuk role yang relevan.
- [ ] Counter unread chat berubah saat ada pesan masuk.

## 9) Regression Guard (Final)

- [ ] Tidak ada page crash saat hard refresh tiap halaman inti.
- [ ] Tidak ada warning/error kritis baru di browser console.
- [ ] Data finansial/order tidak berubah format akibat refactor typing.

## 10) Template Pelaporan Hasil

Gunakan format ini per bug:

```text
ID:
Halaman:
Role:
Langkah:
Expected:
Actual:
Severity:
Screenshot/Log:
```

