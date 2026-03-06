# Modul Controller: Order Allocation

Folder ini adalah direktori tereduksi dari sub-logic spesifik pendistribusian/alokasi barang ke pesanan (`OrderAllocationController.ts` sebelumnya). Proses pemisahan file pesanan yang belum teralokasi (seperti Pre-Order/Backorder) sangat dibutuhkan guna menghindari *timeout* ketika kasir bekerja di *queue*.

### Tujuan dan Fungsionalitas
Sub-modul yang berada di folder ini berfungsi mengatur perputaran dan relokasi inventaris gudang yang *out-of-stock* namun ditunggu oleh pesanan berjalan:
* **`list.ts`**: Skrip pengambilan kueri daftar item pesanan berstatus *pending allocation* secara asinkron dari tumpukan DB, maupun alokasi-alokasi rinci pada setiap level Produk tertentu.
* **`detail.ts`**: Fungsionalitas untuk mengekstrak informasi total rinci suatu data PO pesanan dengan barang penundaan (Backorder).
* **`mutation.ts`**: Proses sangat krusial yang digunakan saat restock PO berhasil. Operasi ini menembakkan pembaruan antrean (queue processing) ke order yang siap dikirim (*allocateOrder*). Tak hanya maju, ada pula pembatalan *backorder* jika Supplier tak mampu memenuhinya.
* **`utils.ts`**: Modul yang memuat fungsi *builder shortcut* di saat kita ingin menganalisa jumlah Barang yang Kekurangan Alokasi (`buildShortageSummary`). Menyimpan daftar status pesanan tipe terminal/konstan.
* **`index.ts`**: Pintu gerbang pemanggil aman file-file alokasi.
