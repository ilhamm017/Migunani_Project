# Modul Controller: Inventory

Folder yang berisi sub-logic `InventoryController.ts` sebelumnya (2400+ baris). Modul ini sangat vital untuk fungsionalitas Backend karena mengontrol manajemen ketersediaan barang (Stok dan Persediaan Gudang) toko.

### Fungsionalitas Modul
Karena alur bisnis Inventory sangat rapat dan penuh transaksi database yang berpotensi *deadlock*, kode ini telah disederhanakan secara terpusat untuk menjaga konsistensi. Modul yang ada antara lain:
* **`product.ts`**: Modul pusat pengelolaan (*CRUD*) Master Produk yang dijual. Juga mengelola aturan diskon harga jual tier (*Tier Pricing*) berdasarkan jumlah pembelian. Endpoint *Scanning Barcode* saat operasional kasir juga ditangani di sini.
* **`category.ts`**: Fungsionalitas *CRUD* Master Kategori untuk struktur pengelompokan Barang. Diskon berdasarkan kategori (*Tier Discount*) ditangani khusus melalui operasi ini.
* **`supplier.ts`**: Operasi modul *CRUD* Pemasok Utama (*Vendor/Supplier*).
* **`mutation.ts`**: Pusat rekam jejak arus stok barang secara historis (Penyesuaian, Keluar, Masuk) dengan format *StockMutation*.
* **`purchaseOrder.ts`**: Tata kelola siklus Order Pembelian Barang (PO/Purchase Orders) dari supplier untuk Restock. Termasuk alur integrasi ketika Barang PO benar-benar mendarat alias diterima (*Receive PO*).
* **`supplierInvoice.ts`**: Integrasi PO yang disahkan tagihannya dengan Hutang Operasional, termasuk tahap pencatatan pembayaran tagihan itu (melunasi PO).
* **`importLogic.ts`**: Logic yang amat kompleks tentang fitur Impor data Produk via *spreadsheet* (.xlsx, dsb). Skrip di dalamnya mengurai file, melakukan normalisasi baris untuk ditelaah *preview*-nya, sebelum masuk tahap krusial (*commit products*) tanpa memengaruhi transaksional aplikasi yang sedang berjalan.
* **`utils.ts`**: Didedikasikan mutlak untuk seluruh fungsi utilitas pengonversi pecahan persen diskon harga, alat cetak pembulatan koma desimal, serta penangkap eksepsi khusus.
* **`index.ts`**: Barrel perute yang aman digunakan.
