# Tutorial Menjalankan Server dengan Docker Compose

Dokumen ini untuk menjalankan seluruh stack:
- `mysql`
- `back_end` (Express + Socket + WhatsApp service)
- `front_end` (Next.js)

## 1. Prasyarat

Pastikan sudah terpasang:
- Docker
- Docker Compose (plugin `docker compose` atau legacy `docker-compose`)

Cek versi:

```bash
docker --version
docker compose version || docker-compose --version
```

## 2. Siapkan Environment

Dari root project:

```bash
cp .env.example .env
```

Nilai default sudah bisa dipakai untuk local. Jika perlu, edit:
- `FRONTEND_PORT`
- `BACKEND_PORT`
- `MYSQL_PORT`
- `JWT_SECRET`

## 3. Build dan Jalankan Semua Service

Gunakan salah satu:

```bash
# Compose v2
docker compose up -d --build

# Compose v1 (fallback)
docker-compose up -d --build
```

Jika ingin sekaligus auto-run seeder saat startup pertama:

```bash
# Compose v2
docker compose --profile seed up -d --build

# Compose v1 (fallback)
docker-compose --profile seed up -d --build
```

Catatan:
- Service `seed` akan jalan sekali lalu exit.
- Seeder melakukan reset data (`force: true`), jadi jangan dipakai di production.

## 4. Cek Status Container

```bash
docker compose ps || docker-compose ps
```

Pastikan service ini statusnya `Up`:
- `migunani_mysql`
- `migunani_backend`
- `migunani_frontend`

## 5. Cek Log Jika Ada Error

```bash
# Semua service
docker compose logs -f || docker-compose logs -f

# Spesifik service
docker compose logs -f back_end || docker-compose logs -f back_end
docker compose logs -f front_end || docker-compose logs -f front_end
docker compose logs -f mysql || docker-compose logs -f mysql
```

## 6. Akses Aplikasi

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:5000`
- MySQL: `localhost:3306`

Jika Anda ubah port di `.env`, sesuaikan URL-nya.

## 7. (Opsional) Seed Data Awal

Jika ingin isi data dummy (admin/customer/kategori/produk), jalankan:

```bash
docker compose exec back_end node dist/seeders/index.js || docker-compose exec back_end node dist/seeders/index.js
```

Catatan:
- Seeder melakukan reset data (`force: true`), jangan jalankan di data production.
- Alternatif auto-run saat startup: pakai `--profile seed` di langkah 3.

## 8. Perintah Operasional Harian

```bash
# Stop service (container tetap ada)
docker compose stop || docker-compose stop

# Start lagi
docker compose start || docker-compose start

# Restart service tertentu
docker compose restart back_end || docker-compose restart back_end

# Stop dan hapus container + network
docker compose down || docker-compose down

# Hapus juga volume database (DATA AKAN HILANG)
docker compose down -v || docker-compose down -v
```

## 9. Troubleshooting Cepat

### A. Port bentrok (`already allocated`)

Ubah port di `.env`, contoh:

```env
FRONTEND_PORT=3001
BACKEND_PORT=5001
MYSQL_PORT=3307
```

Lalu jalankan ulang:

```bash
docker compose up -d --build || docker-compose up -d --build
```

### B. Backend tidak bisa konek ke DB

1. Pastikan MySQL sehat:

```bash
docker compose ps || docker-compose ps
```

2. Lihat log MySQL:

```bash
docker compose logs -f mysql || docker-compose logs -f mysql
```

3. Jika perlu reset total:

```bash
docker compose down -v || docker-compose down -v
docker compose up -d --build || docker-compose up -d --build
```

### C. WhatsApp tidak auto-connect

Pastikan variabel ini di `.env`:

```env
WA_AUTO_INIT=true
WA_AUTO_RECONNECT=true
```

Lalu restart backend:

```bash
docker compose restart back_end || docker-compose restart back_end
```
