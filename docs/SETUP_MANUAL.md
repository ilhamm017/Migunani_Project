# Panduan Menjalankan Sistem (Semi-Manual)

Karena Anda menggunakan **Docker** untuk MySQL namun ingin menjalankan aplikasi secara manual untuk memudahkan perbaikan (terutama halaman Finance), ikuti langkah-langkah berikut:

## 1. Persiapan Database (Docker)
Jalankan perintah ini di root folder project untuk menyalakan database dan phpmyadmin saja:

```bash
docker compose up -d mysql phpmyadmin
```

Tunggu hingga status database "Healthy".

## 2. Menjalankan Backend (Manual)
Bukan terminal baru, masuk ke folder backend, dan jalankan:

```bash
cd back_end
# Pastikan .env sudah ada (Copy dari .env.example jika belum)
cp .env.example .env
npm run dev
```

Server akan berjalan di `http://localhost:5000`. Pastikan muncul pesan:
`Database connection established successfully.`

## 3. Menjalankan Frontend (Manual)
Buka terminal baru lagi, masuk ke folder frontend, dan jalankan:

```bash
cd front_end
# Pastikan .env sudah ada (Jika diperlukan)
npm run dev
```

Frontend akan berjalan di `http://localhost:3000` (atau port lain yang muncul di terminal).

---

### Kenapa Halaman Finance Sebelumnya Error?
1.  **Backend tidak jalan**: Karena ini environment baru dan belum di `npm install`.
2.  **Auth Hydration**: Saya sudah memperbaiki `front_end/store/authStore.ts`. Sebelumnya ada kode `skipHydration: true` yang membuat sistem "lupa" status login setiap kali halaman di-refresh. Sekarang status login akan tersimpan dengan benar di `sessionStorage`.

### Cara Cek Koneksi
Buka `http://localhost:5000` di browser. Jika muncul tulisan **"Migunani Motor Backend Running"**, berarti backend Anda sudah siap menerima koneksi dari frontend.
