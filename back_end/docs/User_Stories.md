# User Stories - Master Document

**Proyek:** E-Commerce, WMS, POS & Omnichannel Chat
**Versi:** Final Consolidated

Dokumen ini mencakup seluruh kebutuhan fungsional sistem, menggabungkan fitur web, bot WhatsApp, manajemen gudang, keuangan, serta operasional toko fisik (POS) dan logistik.

## Modul Pelanggan (Web & WhatsApp)
*Fokus: Kemudahan transaksi dan loyalitas.*

*   **US-C01:** Sebagai **Pelanggan Baru**, saya ingin **mendaftar via Web**, agar tercatat di sistem dan mendapat tier loyalitas awal.
    *   *Kriteria Penerimaan:* Registrasi valid (Email/WA unik). Tier default "Reguler". Profil terbuat.
*   **US-C02:** Sebagai **Pelanggan**, saya ingin **melihat harga sesuai Tier**, agar saya mendapat keuntungan sebagai member loyal.
    *   *Kriteria Penerimaan:* Katalog menampilkan harga diskon otomatis (Premium/Gold/Platinum) dibanding harga reguler.
*   **US-C03:** Sebagai **Pelanggan**, saya ingin **Checkout di Web dengan opsi Manual/COD**, karena saya tidak memakai payment gateway.
    *   *Kriteria Penerimaan:* Pilihan bayar: "Transfer Bank" (harus upload bukti) atau "COD" (bayar ke kurir).
*   **US-C04:** Sebagai **Pelanggan**, saya ingin **Upload Bukti Transfer**, agar pesanan saya diproses admin.
    *   *Kriteria Penerimaan:* Form upload gambar tersedia di detail order. Status berubah menjadi "Menunggu Verifikasi".
*   **US-C05:** Sebagai **Pelanggan**, saya ingin **Memesan via WhatsApp Bot (!order)**, agar lebih cepat tanpa membuka web.
    *   *Kriteria Penerimaan:* Bot memvalidasi SKU & Stok, menghitung total harga (termasuk diskon tier), dan membalas dengan ringkasan order.
*   **US-C06:** Sebagai **Pelanggan**, saya ingin **Tracking & Cek Poin via WA (!status/!poin)**.
    *   *Kriteria Penerimaan:* Bot merespons dengan data real-time dari database mengenai posisi paket dan saldo poin.
*   **US-C07:** Sebagai **Pelanggan**, saya ingin **Klaim Garansi**, agar barang rusak bisa diperbaiki/tukar.
    *   *Kriteria Penerimaan:* Portal klaim di web. Input nomor invoice/serial number untuk validasi masa garansi.
*   **US-C08:** Sebagai **Pelanggan**, saya ingin **Live Chat**, agar bisa bertanya ke CS.
    *   *Kriteria Penerimaan:* Chat terkirim real-time. Jika admin membalas, bot otomatis diam (Takeover).

## Modul Admin CS (Omnichannel Chat)
*Fokus: Sentralisasi komunikasi dan efisiensi respon.*

*   **US-A01:** Sebagai **Admin CS**, saya ingin **Shared Inbox (Web & WA)**, agar tidak perlu pindah aplikasi.
    *   *Kriteria Penerimaan:* Dashboard menampilkan pesan dari Widget Web dan WhatsApp dalam satu list terpadu.
*   **US-A02:** Sebagai **Admin CS**, saya ingin **Chat Takeover**, agar bot tidak mengganggu saat saya membalas manual.
    *   *Kriteria Penerimaan:* Saat admin kirim pesan, bot "Pause" untuk user tersebut selama 120 menit.
*   **US-A03:** Sebagai **Admin CS**, saya ingin **Sync Mobile WA**, agar balasan saya dari HP tetap terekam di sistem.
    *   *Kriteria Penerimaan:* Sistem menangkap pesan keluar dari HP Admin dan menyimpannya di history chat dashboard.
*   **US-A04:** Sebagai **Admin CS**, saya ingin **Broadcast Notifikasi**, untuk info promo.
    *   *Kriteria Penerimaan:* Kirim pesan massal ke segmen tertentu (misal: Tier Gold) via antrean (Queue) aman.
*   **US-A05:** Sebagai **Admin CS**, saya ingin **Ban User**, untuk memblokir pelanggan bermasalah.
    *   *Kriteria Penerimaan:* User yang diban tidak bisa login web dan diabaikan oleh Bot WA.

## Modul Gudang (Inventory & Logistik)
*Fokus: Akurasi stok dan efisiensi data.*

*   **US-G01:** Sebagai **Admin**, saya ingin **Import Data Excel Lama**, agar migrasi cepat.
    *   *Kriteria Penerimaan:* Mapping kolom CSV (Nama, SKU, Harga Beli, Stok) masuk ke database dengan tepat.
*   **US-G02:** Sebagai **Staf Gudang**, saya ingin **Proses Barang Masuk (PO)**.
    *   *Kriteria Penerimaan:* Input stok masuk wajib pilih Supplier. Sistem mencatat mutasi Type: IN.
*   **US-G03:** Sebagai **Staf Gudang**, saya ingin **Scan Barcode**, untuk cari barang/opname.
    *   *Kriteria Penerimaan:* Web admin akses kamera/scanner untuk membaca SKU dan membuka detail produk.
*   **US-G04:** Sebagai **Sistem**, saya ingin **Hapus Pesanan Gantung (>30 Hari)**.
    *   *Kriteria Penerimaan:* Cron job otomatis membatalkan pesanan pending > 30 hari dan mengembalikan stok.
*   **US-G05:** Sebagai **Staf Gudang**, saya ingin **Cetak Label Pengiriman**.
    *   *Kriteria Penerimaan:* Generate label siap cetak berisi Nama, Alamat, No HP, dan List Barang.

## Modul Finance & Owner (Keuangan)
*Fokus: Laba rugi dan validasi pembayaran.*

*   **US-F01:** Sebagai **Admin Finance**, saya ingin **Validasi Bukti Transfer**, agar barang bisa dikirim.
    *   *Kriteria Penerimaan:* Lihat foto bukti di dashboard. Tombol "Terima" ubah status jadi "Proses". Tombol "Tolak" minta upload ulang.
*   **US-F02:** Sebagai **Admin Finance**, saya ingin **Input Biaya Operasional**.
    *   *Kriteria Penerimaan:* Catat gaji, listrik, sewa untuk pengurang laba kotor.
*   **US-F03:** Sebagai **Owner**, saya ingin **Laporan Laba Rugi (P&L)**.
    *   *Kriteria Penerimaan:* Hitung: (Omzet Penjualan) - (HPP Barang Terjual) - (Biaya Operasional). HPP diambil dari harga beli saat transaksi.
*   **US-F04:** Sebagai **Admin Finance**, saya ingin **Laporan Piutang (AR)**.
    *   *Kriteria Penerimaan:* List invoice belum lunas beserta umur piutangnya (Aging Report).
*   **US-F05:** Sebagai **Owner**, saya ingin **Export Excel**, untuk arsip luring.
    *   *Kriteria Penerimaan:* Download data penjualan, stok, dan keuangan dalam format .xlsx.

## Modul Toko Fisik (Point of Sales / Kasir)
*Fokus: Efisiensi kasir, akurasi uang tunai, dan fleksibilitas.*

*   **US-K01:** Sebagai **Kasir**, saya ingin **Input Transaksi Walk-in**, untuk pembeli yang datang langsung.
    *   *Kriteria Penerimaan:* UI POS Fullscreen. Scan barang, input jumlah bayar tunai, hitung kembalian, cetak struk.
*   **US-K02:** Sebagai **Kasir**, saya ingin **Cari Member di POS**, agar pembeli toko dapat poin.
    *   *Kriteria Penerimaan:* Lookup member by No HP/Nama. Transaksi tersambung ke akun user tersebut.
*   **US-K03:** Sebagai **Kasir**, saya ingin **Menunda Transaksi (Hold Order)**, agar saya bisa melayani pelanggan lain saat pelanggan saat ini masih memilih barang tambahan.
    *   *Kriteria Penerimaan:* Tombol "Hold" menyimpan keranjang sementara. Tombol "Resume" memanggil kembali keranjang tersebut.
*   **US-K04:** Sebagai **Kasir**, saya ingin **Membatalkan Item/Transaksi (Void)**, jika pelanggan berubah pikiran sebelum bayar.
    *   *Kriteria Penerimaan:* Hapus item dari list belanja atau batalkan seluruh sesi sebelum struk keluar. Stok tidak terpotong.
*   **US-K05:** Sebagai **Kasir**, saya ingin **Tutup Kasir (Closing Shift)**, untuk mencocokkan uang di laci dengan sistem.
    *   *Kriteria Penerimaan:* Sistem menampilkan ringkasan total uang tunai yang seharusnya ada (System Total) vs input fisik (Actual Cash).

## Modul Kurir (Driver App)
*Fokus: Validasi pengiriman, penanganan COD, dan bukti serah terima.*

*   **US-D01:** Sebagai **Supir**, saya ingin **List Pengiriman Hari Ini**.
    *   *Kriteria Penerimaan:* Tampilan mobile sederhana berisi alamat tujuan, urutan rute, dan link Google Maps.
*   **US-D02:** Sebagai **Supir**, saya ingin **Konfirmasi COD & Upload Bukti**, agar uang tercatat dan barang valid diterima.
    *   *Kriteria Penerimaan:* Tombol "Terima Uang" wajib input nominal dan upload foto serah terima barang. Status invoice jadi "Paid".
*   **US-D03:** Sebagai **Supir**, saya ingin **Update Status Terkirim (Non-COD)**.
    *   *Kriteria Penerimaan:* Tombol "Selesai" wajib upload foto bukti penerima. Status order jadi "Completed".
*   **US-D04:** Sebagai **Supir**, saya ingin **Melaporkan Gagal Kirim**, jika rumah kosong atau alamat salah.
    *   *Kriteria Penerimaan:* Tombol "Gagal". Input alasan (Rumah Kosong/Ditolak/Alamat Salah). Order status jadi "Failed Delivery" & barang kembali ke stok gudang (manual restock).
*   **US-D05:** Sebagai **Supir**, saya ingin **Setor Tunai COD ke Admin**, untuk menutup tugas harian.
    *   *Kriteria Penerimaan:* List uang COD yang dipegang supir. Admin Finance memvalidasi penerimaan fisik uang tersebut di sistem (Closing Driver).
