# Modul Controller: Driver

Direktori ini dirancang khusus untuk memisah logika `DriverController.ts` monolitik sebelumnya (700+ baris). Modul ini difokuskan pada pengoperasian antarmuka aplikasi dari sisi Sopir/Kurir (*Driver*) di lapangan.

### Fungsionalitas Modul
Karena alur kerja kurir (*pick-up* dan *delivery* di tempat) merupakan proses bisnis yang cukup krusial, kodenya dipisah menjadi spesifik untuk:
* **`orders.ts`**: Menangani permintaan daftar pengiriman barang/pesanan (`getAssignedOrders`) yang diberikan ke staf kurir bersangkutan.
* **`delivery.ts`**: Menangani sinkronisasi status ketika pesanan telah dikirim dan tiba di pelanggan (dengan dukungan pengunggahan bukti pengiriman/foto).
* **`payment.ts`**: Modul fungsional untuk merekam ketika kurir menerima uang dari pelanggan di tempat (metode pembayaran COD), kemudian mencatat cicilan utang setor kurir ke gudang/kasir.
* **`wallet.ts`**: Menangani kalkulasi eksposur tunai/piutang sementara seorang driver yang dilaporkan secara real-time.
* **`issues.ts`**: Sarana pelaporan khusus bila terjadi masalah dalam rute pengiriman (contohnya melaporkan kekurangan barang dengan memotret *checklist snapshot* barang tidak ada).
* **`retur.ts`**: Mengurus eksekusi barang cacat rusak yang dikembalikan pelanggan ke toko (*process return/back to warehouse*).
* **`utils.ts`**: Mengisolasi *array* status statis (semacam Enum) dan menangkap *Error codes* dari database untuk keandalan.
* **`index.ts`**: Re-ekspor modul-modul lain di folder ini untuk disuplai ke berkas perute `routes/driver.ts`.
