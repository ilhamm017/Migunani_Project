# Modul Controller: Finance

Folder ini merupakan hasil refaktorisasi `FinanceController.ts` super masif (2400+ baris). Dipecah ke dalam modul-modul sub-domain untuk pengorganisasian kode yang kokoh, stabil, dan jauh lebih mudah dikelola. Karena fitur akuntansi (finance) adalah alur bisnis paling berat di aplikasi ini, modularitas sangat diperlukan guna mendukung penskalaan berikutnya.

### Fungsionalitas Modul
* **`invoice.ts`**: Menangani sistem faktur tagihan pelanggan.
* **`payment.ts`**: Otentikasi verifikasi/pembatalan (void) pembayaran tagihan.
* **`expense.ts`**: Modul rekam jejak beban dan pengeluaran harian toko.
* **`expenseLabel.ts`**: Mengatur kategori (label) data operasional *expense*.
* **`tax.ts`**: Mengonfigurasi parameter persentase pajak (PPN/PPh).
* **`receivable.ts`**: Penyediaan laporan piutang pelanggan (*Accounts Receivable*).
* **`reports.ts`**: Modul pelaporan analitik laba rugi (*Profit and Loss*).
* **`cod.ts`**: Memantau dan mengeksekusi penyelesaian tagihan (settlement) yang ditagihkan oleh pengemudi COD.
* **`creditNote.ts`**: Pengelolaan surat potongan tagihan (*Credit Note*).
* **`journal.ts`**: Ekstrak data jurnal entri transaksi umum sistem.
* **`accounting.ts`**: Penutupan bulan pembukuan (closing period) dan penciptaan jurnal kelayakan/penyesuaian (adjustments).
* **`utils.ts`**: Koleksi konstanta dan fungsi utilitas yang dipakai antar file internal di folder ini.
* **`index.ts`**: Pemersatu ekspor kode yang aman untuk router.
