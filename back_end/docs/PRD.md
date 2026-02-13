# Product Requirements Document (PRD)

**Proyek:** E-Commerce, WMS, POS & Omnichannel Chat System
**Versi:** 2.0
**Status:** Final Consolidated

## 1. Visi Produk

Menciptakan ekosistem perdagangan hibrida (Online & Offline) yang terintegrasi penuh, menghubungkan stok gudang, penjualan toko fisik (POS), layanan pesan antar (Kurir), dan loyalitas pelanggan dalam satu platform terpusat.

## 2. Target Pengguna

*   **Administrator/Owner:** Mengelola keuangan (Laba Rugi), stok, dan kebijakan strategis.
*   **Staff Gudang:** Mengelola barang masuk/keluar, opname, dan cetak label.
*   **Kasir Toko:** Menangani transaksi walk-in dan pembayaran tunai.
*   **Kurir (Driver):** Mengantar pesanan dan menangani pembayaran COD.
*   **Admin CS:** Mengelola komunikasi omnichannel (Web & WhatsApp).
*   **Pelanggan:** Melakukan pembelian, tracking, dan manajemen poin via Web/WA.

## 3. Ruang Lingkup Fitur (Comprehensive)

### A. Modul Administrasi & Gudang (Back-Office)

*   **Inventory Control:** Import data Excel lama, manajemen SKU, mutasi stok, dan scan barcode.
*   **Procurement:** Sistem Purchase Order (PO) kepada Supplier.
*   **Order Management:** Tracking pesanan dengan aturan otomatis hangus 30 hari.
*   **Finance:** Verifikasi bukti transfer manual, input biaya operasional, laporan piutang (AR), dan Laporan Laba Rugi (P&L) otomatis.

### B. Modul Operasional Toko & Logistik

*   **Point of Sales (POS):** Antarmuka kasir fullscreen untuk transaksi tunai, scan barcode cepat, dan cetak struk.
*   **Driver App:** Aplikasi mobile untuk supir melihat rute, konfirmasi barang diterima, dan setoran uang COD.

### C. Modul Komunikasi (Omnichannel)

*   **Shared Inbox:** Dashboard tunggal untuk membalas pesan dari Widget Web dan WhatsApp.
*   **WhatsApp Bot:** Otomasi pemesanan (!order), cek stok, dan info poin.
*   **Chat Takeover:** Mekanisme pengambilalihan percakapan dari bot ke admin manusia.

### D. Modul Pelanggan (Front-End)

*   **Shopping Experience:** Katalog dengan harga bertingkat (Tier), checkout dengan opsi Transfer Manual/COD.
*   **Loyalty System:** Akumulasi poin terintegrasi (Online & Offline).
*   **Self-Service:** Unduh invoice PDF, upload bukti bayar, dan portal klaim garansi.

## 4. Aturan Bisnis (Business Rules)

*   **30-Day Expiry:** Pesanan pending > 30 hari otomatis dibatalkan (Expired) dan stok dikembalikan.
*   **Payment Verification:** Pesanan transfer manual hanya diproses setelah Admin Finance memvalidasi bukti bayar.
*   **COD Protocol:** Pesanan COD baru dianggap lunas (Paid) setelah Driver mengkonfirmasi penerimaan uang di aplikasi.
*   **Role-Based Discount:** Harga produk otomatis menyesuaikan Tier pelanggan (Premium/Gold/Platinum) di Web dan POS.
*   **Chat Takeover:** Bot otomatis pause selama 120 menit jika Admin mengirim pesan manual ke pelanggan.

## 5. Parameter Keberhasilan (KPI)

*   **Data Integrity:** Akurasi stok 100% antara sistem POS, Web, dan Gudang Fisik.
*   **Operational Efficiency:** Waktu proses verifikasi pembayaran manual < 10 menit.
*   **Response Time:** Penurunan waktu tunggu pelanggan berkat Bot dan Shared Inbox.
*   **Financial Accuracy:** Laporan Laba Rugi yang dihasilkan secara real-time dan akurat.
