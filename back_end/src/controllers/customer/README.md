# Modul Controller: Customer

Direktori ini memuat seluruh logika pengontrol (controller) spesifik untuk urusan pelanggan (Customer). Modul ini dipisahkan dari `CustomerController.ts` yang monolitik agar pengembangan lebih terfokus dan menghindari file yang membengkak.

### Tujuan dan Fungsionalitas
Folder ini menangani operasi terkait manajemen profil, otentikasi, hingga manajemen status pelanggan.

### Daftar Berkas
* **`auth.ts`**: Menangani seluruh alur otentikasi mulai dari pendaftaran (registrasi), login kredensial, hingga verifikasi token (OTP) pelanggan baru.
* **`query.ts`**: Menangani pengambilan data daftar pelanggan oleh admin, dan proses query detail informasi/profil pelanggan individu.
* **`status.ts`**: Mengalokasikan kontrol admin dalam mengatur (edit, blokir, aktifkan) akses dan persetujuan pelanggan.
* **`utils.ts`**: Menampung fungsionalitas bantuan/helper seperti enkripsi kata sandi dan fungsi format validasi data pelanggan.
* **`index.ts`**: Titik keluar (barrel) yang merangkum (export) semua fungsi pada folder ini agar diimpor terpusat oleh perute (router).
