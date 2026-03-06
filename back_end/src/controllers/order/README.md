# Modul Controller: Order

Folder ini mewakili pemisahan modul yang teramat penting dari kerangka `OrderController.ts` raksasa (ukuran mencapai 1300 baris). Modul ini dipisah menurut tingkat izin pengguna yang mereksesuainya (Pelanggan / Admin / Kasir).

### Fokus Fungsionalitas Modul
Pemisahan struktur ini berguna memperjelas letak fungsi API jika sewaktu-waktu terdapat pembaruan rilis e-commerce di aplikasi *frontend*:
* **`checkout.ts`**: Rumah utama untuk transaksi belanja (Order Checkout). Kode kalkulasi *Tier Pricing Multi-level*, validasi Diskon Kategori, dan pengenaan Layanan Kurir bersarang di sini sebelum mencatat Data Order yang tervalidasi ke dalam Database.
* **`customer.ts`**: File *middleware read-only* khusus pelanggan/pengguna ketika mencetak kueri keranjang mereka sendiri (`getMyOrders`), serta proses pelaporan mandiri/konfirmasi Bayar (*Upload Receipt*).
* **`admin.ts`**: Gudang skrip tingkat tinggi milik otoritas Admin & Manajemen. Seperti `getAllOrders` untuk pencarian seluruh transaksi. Bahkan kontrol pengalihan status (*Delivery/Hold/Complete*) hingga fungsionalitas Pelaporan Barang Hilang di jalur Distribusi diselesaikan dari modul ini.
* **`utils.ts`**: Direktori sekunder pengorganisasian `Interfaces` & `Types`. Juga sebagai pengembang *helper variables/enums* dan fungsi Normalisasi data (*Pricing Rule Calculator*).
* **`index.ts`**: Eksportir modular bagi `router`.
