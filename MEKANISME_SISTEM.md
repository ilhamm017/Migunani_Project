# Dokumentasi Sistem Migunani Motor: Alur Keuangan, Pesanan, dan Antisipasi Stok

## 1. Tentang Aplikasi Migunani Motor

Aplikasi ini adalah sistem manajemen operasional menyeluruh (ERP sederhana) yang dirancang khusus untuk bisnis sparepart "Migunani Motor". Sistem ini mengintegrasikan fungsi **Point of Sales (POS)**, **Manajemen Inventaris**, **Order Fulfillment**, dan **Pencatatan Keuangan** dalam satu platform.

### Fitur Utama:
-   **Multi-User**: Memiliki role spesifik untuk Admin Gudang, Admin Finance, Kasir, dan Driver.
-   **Omnichannel Orders**: Menerima pesanan dari Website dan WhatsApp secara terpusat.
-   **Manajemen Stok Real-time**: Stok fisik vs Stok teralokasi (booking) dipisahkan untuk mencegah overselling.
-   **Keuangan Otomatis**: Laporan Laba Rugi (P&L) dihasilkan otomatis dari transaksi harian.

---

## 2. Mekanisme Pencatatan Keuangan

Sistem keuangan dalam aplikasi ini bekerja secara otomatis berdasarkan aktivitas operasional, meminimalkan input manual untuk pendapatan.

### A. Pemasukan (Revenue)
Pencatatan pemasukan **tidak dilakukan secara manual**, melainkan otomatis dari **Invoice** yang berstatus `paid` (lunas).

1.  **Sumber Data**: Tabel `Invoices`.
2.  **Pemicu Pencatatan**:
    *   **Transfer**: Saat Admin Finance memverifikasi bukti transfer dan mengubah status menjadi `approve`.
    *   **COD**: Saat Driver menyetorkan uang tunai ke Finance dan Finance melakukan konfirmasi "Terima Setoran".
    *   **Toko Fisik**: Saat Kasir menyelesaikan transaksi langsung.
3.  **Perhitungan**: Total dari kolom `amount_paid` pada invoice yang valid.

### B. Pengeluaran (Expenses)
Pengeluaran dicatat secara **manual** oleh Admin Finance melalui menu "Expenses".

1.  **Input Data**:
    *   **Kategori**: Listrik, Gaji Pegawai, Operasional, Bensin, dll.
    *   **Nominal**: Jumlah uang keluar.
    *   **Tanggal**: Tanggal transaksi.
    *   **Catatan**: Detail keperluan.
2.  **Dampak**: Mengurangi Net Profit secara langsung pada periode tersebut.

### C. Laporan Laba Rugi (Profit & Loss)
Sistem menghitung profitabilitas secara *real-time* dengan rumus:

1.  **Revenue (Omzet)**: Total uang masuk dari pesanan lunas.
2.  **COGS (HPP)**: Harga modal barang (`cost_at_purchase`) dari barang yang *terjual* (bukan barang yang dibeli untuk stok).
3.  **Gross Profit (Laba Kotor)**: `Revenue - COGS`.
4.  **Net Profit (Laba Bersih)**: `Gross Profit - Total Expenses`.

---

## 3. Flow Sistem Penanganan Pesanan

Alur pesanan dirancang dengan status bertingkat untuk memastikan kontrol stok dan pembayaran.

### Alur Normal (Happy Flow)
1.  **Order Masuk** (`pending`): Customer checkout via Web atau Admin input via WA.
2.  **Alokasi Stok** (`allocated`): Admin Gudang memverifikasi ketersediaan fisik barang dan "mengunci" stok untuk pesanan ini.
3.  **Penagihan** (`waiting_payment`):
    *   Sistem menerbitkan Invoice.
    *   Customer melakukan transfer dan upload bukti.
4.  **Verifikasi** (`ready_to_ship`): Finance cek mutasi bank & approve pembayaran.
5.  **Pengiriman** (`shipped`): Gudang packing barang & assign ke Driver.
6.  **Selesai** (`completed`): Barang sampai ke customer.

---

## 4. Sistem Antisipasi & Penanganan Shortage (Kekurangan Stok)

Ini adalah fitur unggulan untuk menangani situasi di mana **Stok di Sistem ada, tapi Fisik tidak ada (Selisih Stok)**, atau saat pesanan melebihi stok yang tersedia.

### A. Deteksi Masalah (Saat Alokasi)
Saat Admin Gudang memproses order baru di menu "Alokasi":
1.  Sistem membandingkan **Jumlah Dipesan** vs **Stok Fisik Tersedia**.
2.  Jika stok kurang, sistem akan menandai item tersebut sebagai **Shortage** (Kekurangan).

### B. Mekanisme "Order Issue"
Jika terjadi kekurangan (shortage/backorder), sistem otomatis melakukan tindakan preventif:
1.  **Status Backorder**: Order tidak bisa lanjut ke pembayaran/pengiriman. Status tertahan.
2.  **Pembuatan Tiket Masalah (`OrderIssue`)**:
    *   Sistem membuat record isu tipe `shortage`.
    *   **SLA (Deadline)**: Diberikan waktu (default 48 jam) untuk penyelesaian.
    *   **Pencatatan**: Tercatat detail produk apa yang kurang dan berapa jumlahnya.

### C. Solusi / Penyelesaian
Admin memiliki dua opsi untuk menyelesaikan antisipasi ini:

**Opsi 1: Restock (Barang Datang)**
1.  Toko melakukan pembelian barang ke supplier.
2.  Admin update stok di inventaris.
3.  Admin kembali ke menu Alokasi order tersebut.
4.  Sistem mendeteksi stok sudah cukup -> Alokasi Berhasil -> Order lanjut ke flow normal.
5.  Tiket `OrderIssue` otomatis berubah jadi `resolved`.

**Opsi 2: Batal Sebagian/Full (Cancel Backorder)**
1.  Jika barang tidak bisa dipenuhi dalam waktu SLA.
2.  Admin memilih "Cancel Backorder".
3.  Item yang kurang dihapus dari pesanan / pesanan dibatalkan.
4.  Stok yang sempat teralokasi (jika ada sebagian) dikembalikan ke gudang.
5.  `OrderIssue` ditutup dengan catatan pembatalan.

### Ringkasan Flow Antisipasi:
> **Order Masuk** -> **Cek Stok** -> **Kurang?** -> **Buat Isu (Hold Order)** -> **Restock/Batal** -> **Lanjut Proses**.

---

## 5. Dokumentasi Skema Database

Berikut adalah detail lengkap mengenai struktur database, tipe data, dan penjelasan fungsi dari setiap kolom penting dalam sistem Aplikasi Migunani Motor.

### 1. User & Auth (`users`, `customer_profiles`)

#### `users`
Tabel utama untuk semua pengguna sistem (Admin, Driver, Customer).
*   **`id`** (UUID): Primary Key.
*   **`role`**: Peran pengguna.
    *   `super_admin`: Akses penuh.
    *   `admin_gudang`: Mengurus stok, alokasi order, dan pengiriman.
    *   `admin_finance`: Mengurus invoice, verifikasi pembayaran, dan expense.
    *   `kasir`: Point of sales toko fisik.
    *   `driver`: Mengantar barang dan menerima uang COD.
    *   `customer`: Pelanggan belanja.
*   **`whatsapp_number`**: Digunakan sebagai pengganti username/email untuk login (unik).
*   **`debt`**: (Decimal) Jumlah uang COD yang dibawa driver tapi belum disetor ke Finance.
*   **`status`**: `active` atau `banned`.

#### `customer_profiles`
Data tambahan khusus untuk role `customer`.
*   **`tier`**: Level pelanggan (`regular`, `gold`, `platinum`). Bisa digunakan untuk diskon otomatis kedepannya.
*   **`points`**: Poin loyalitas dari belanja.
*   **`credit_limit`**: Batas hutang (bon) jika diperbolehkan.
*   **`saved_addresses`**: (JSON) Daftar alamat pengiriman yang disimpan customer.

#### `shifts`
Mencatat sesi kerja kasir/admin toko.
*   **`start_cash`**: Uang modal di laci kasir saat buka shift.
*   **`end_cash`**: Uang fisik yang dihitung saat tutup shift.
*   **`expected_cash`**: Uang yang seharusnya ada berdasarkan hitungan sistem (Start + Sales - Expense).
*   **`difference`**: Selisih (`end_cash` - `expected_cash`). Jika minus berarti uang hilang.

---

### 2. Produk & Inventaris (`products`, `inventory`)

#### `products`
Master data barang sparepart.
*   **`sku`**: Kode unik barang (Stock Keeping Unit).
*   **`price`**: Harga jual ke customer.
*   **`base_price`**: Harga modal rata-rata (HPP) saat ini.
*   **`stock_quantity`**: **Stok Fisik Total** yang ada di gudang.
*   **`allocated_quantity`**: Jumlah stok yang **sudah dipesan orang** tapi belum dikirim.
    *   *Stok Tersedia untuk Dijual* = `stock_quantity` - `allocated_quantity`.
*   **`min_stock`**: Batas aman. Jika stok di bawah ini, admin harus restock.
*   **`bin_location`**: Lokasi rak di gudang (misal: "Rak A3-Baris 2").

#### `categories` & `product_categories`
Kategori barang (Ban, Oli, Busi, dll). Satu produk bisa masuk ke banyak kategori (Many-to-Many).

#### `stock_mutations`
Audit log (riwayat) setiap perubahan stok.
*   **`product_id`**: Barang apa yang berubah.
*   **`type`**:
    *   `in`: Masuk (Pembelian/Retur).
    *   `out`: Keluar (Penjualan/Rusak).
    *   `adjustment`: Koreksi manual/Opname.
*   **`qty`**: Jumlah perubahan.
*   **`reference_id`**: ID Order atau ID Purchase Order penyebab perubahan.

#### `stock_opnames` & `stock_opname_items`
Sesi cek stok fisik massal (Stock Opname).
*   **`system_qty`**: Stok menurut komputer saat opname dimulai.
*   **`physical_qty`**: Stok hasil hitungan admin.
*   **`difference`**: Selisihnya. Otomatis membuat `stock_mutation` tipe adjustment saat opname diselesaikan.

---

### 3. Pesanan & Transaksi (`orders`, `allocations`)

#### `orders`
Header dari sebuah transaksi pembelian.
*   **`status`**:
    *   `pending`: Baru dibuat.
    *   `waiting_invoice`: (Internal) Menunggu admin terbitkan tagihan.
    *   `waiting_payment`: Invoice terbit, menunggu customer bayar.
    *   `ready_to_ship`: Sudah bayar/COD approved, siap dipacking.
    *   `allocated`: (Internal) Stok sudah diamankan admin gudang.
    *   `shipped`: Sedang dibawa kurir.
    *   `delivered`: Sampai di lokasi (COD belum setor uang).
    *   `completed`: Selesai (Uang masuk, barang diterima).
    *   `canceled`: Batal.
*   **`source`**: `web` (customer checkout sendiri) atau `whatsapp` (admin inputkan).
*   **`total_amount`**: Nilai total belanja.
*   **`stock_released`**: Boolean pengaman. Jika order batal, memastikan stok yang dialokasikan sudah dikembalikan ke gudang.

#### `order_items`
Daftar barang dalam pesanan.
*   **`price_at_purchase`**: Harga jual saat itu (mengunci harga meski master product berubah).
*   **`cost_at_purchase`**: Harga modal saat itu (penting untuk laporan laba rugi akurat).

#### `order_allocations` (**Fitur Kunci!**)
Tabel yang menautkan stok fisik ke pesanan tertentu.
*   **`product_id`**: Produk yang dibooking.
*   **`allocated_qty`**: Jumlah yang dibooking.
*   **`status`**: `pending` (terpesan), `picked` (sudah diambil dari rak), `shipped` (sudah keluar gudang).

#### `order_issues`
Tiket masalah jika stok fisik kurang.
*   **`issue_type`**: `shortage` (Stok kurang).
*   **`status`**: `open` (belum beres), `resolved` (sudah direstock/dicancel).
*   **`due_at`**: Tenggat waktu penyelesaian (SLA).

---

### 4. Keuangan (`invoices`, `expenses`)

#### `invoices`
Tagihan pembayaran.
*   **`payment_method`**: `transfer_manual`, `cod` (bayar di tempat), `cash_store` (tunai di toko).
*   **`payment_status`**:
    *   `unpaid`: Belum bayar.
    *   `paid`: Lunas (Transfer verified).
    *   `cod_pending`: Barang dikirim tapi uang belum disetor driver.
*   **`verified_by`**: Admin Finance yang menyetujui pembayaran.

#### `expenses`
Pengeluaran operasional kantor/toko.
*   **`category`**: Listrik, Air, Gaji, Bensin, dll.
*   **`amount`**: Nominal.
*   Note: Data ini langsung mengurangi Net Profit di laporan P&L.

---

### 5. Layanan & Retur (`chat`, `retur`)

#### `chat_threads`, `chat_sessions`, `messages`
Sistem chat Omnichannel (Web + WA).
*   **`is_bot_active`**: Apakah bot yang membalas atau manusia (admin CS).
*   **`thread_type`**: `staff_customer` (CS dengan Client), `support_omni` (General Support).

#### `returs`
Manajemen pengembalian barang rusak/salah.
*   **`status`**: Flow retur (`pending` -> `approved` -> `pickup_assigned` -> `received` -> `completed`).
*   **`refund_amount`**: Nominal uang yang dikembalikan ke customer (jika refund dana).
*   **`is_back_to_stock`**: Apakah barang yang diretur layak dijual lagi (masuk stok) atau dibuang (write-off).

---

### 6. Supplier & Restock (`purchase_orders`)

#### `suppliers`
Database vendor/distributor sparepart.

#### `purchase_orders` (PO)
Pesanan toko ke supplier ("Kulakan").
*   **`status`**: `pending` -> `received` (barang datang, stok bertambah otomatis).
