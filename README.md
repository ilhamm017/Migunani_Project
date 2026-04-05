# Migunani Motor - Sistem Omnichannel Sparepart Motor

Aplikasi full-stack untuk operasional toko suku cadang motor: e-commerce, inventory, POS, finance, driver, dan chat omnichannel (Web + WhatsApp).

## Dokumen Utama

- Panduan menyeluruh aplikasi: `GUIDE_APLIKASI_MIGUNANI_MOTOR.md`
- Onboarding cepat developer: `ONBOARDING_DEVELOPER.md`
- Backup database MySQL: `docs/BACKUP_DATABASE.md`
- Kontrak API (aktual): `back_end/docs/API_Contract.md`
- Daftar halaman frontend (aktual): `front_end/PAGE_LIST.md`
- Catatan migrasi SQL manual: `back_end/sql/README.md`

## Tech Stack

### Backend

- Express.js + TypeScript
- Sequelize + MySQL 8
- Socket.io
- whatsapp-web.js
- JWT + bcrypt

### Frontend

- Next.js App Router + TypeScript
- Tailwind CSS v4
- Zustand
- Socket.io Client

## Menjalankan Aplikasi

### Opsi A - Full Docker Compose

Cocok untuk menjalankan semua service dalam container.

```bash
cp .env.example .env
docker compose up -d --build
```

Yang terjadi saat `docker compose up`:
- `mysql` start
- `migrate` menjalankan migrasi schema (`node dist/scripts/migrate.js up --with-sql`)
- `seed` mengisi data awal minimal (Chart of Accounts + akun staff)
- `back_end` start (default `DB_SYNC_MODE=safe`)

Akses:

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:5000`
- MySQL: `localhost:3306`

Catatan:
- Mode **production** (build `target: runner`) berjalan lewat `docker-compose.yml`.
- Mode **development** (hot reload) gunakan gabungan `docker-compose.yml` + `docker-compose.dev.yml`.

### Opsi C - Dev di Docker (hot reload tanpa rebuild terus-menerus)

Cocok kalau kamu ingin tetap coding di host, tapi backend/frontend jalan di container (auto reload).

```bash
cp .env.example .env

# pertama kali (atau saat dependency/Dockerfile berubah)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build

# berikutnya cukup:
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Catatan:
- Rebuild hanya perlu kalau `Dockerfile`, `docker-compose*.yml`, `package*.json`, atau dependency berubah.
- Mode dev ini membuat service `seed` menjadi no-op supaya tidak mengubah schema saat kamu coding.

### Opsi B - Dev Lokal + MySQL Docker (direkomendasikan saat coding)

Cocok untuk hot reload backend/frontend di mesin lokal.

```bash
cp .env.example .env
npm install
cd back_end && npm install && cd ..
cd front_end && npm install && cd ..

docker compose up -d mysql
npm run dev
```

Akses:

- Frontend (Next dev): `http://localhost:3000`
- Backend API (local dev): `http://localhost:5000`
- MySQL: `localhost:3306`

## Seeder Data

Seeder mengisi data awal minimal (Chart of Accounts + akun staff). Seeder **tidak** melakukan drop/reset DB.

```bash
# aman: hentikan backend dulu, jalankan seed one-off, lalu nyalakan backend lagi
npm run docker:seed
```

Akun default dari seeder:

- `superadmin@migunani.com` / `superadmin123` (`super_admin`)
- `gudang@migunani.com` / `gudang123` (`admin_gudang`)
- `finance@migunani.com` / `finance123` (`admin_finance`)
- `kasir@migunani.com` / `kasir123` (`kasir`)
- `driver@migunani.com` / `driver123` (`driver`)
- `customer@migunani.com` / `customer123` (`customer`)

## Struktur Proyek

```text
Migunani_Motor_Project/
├── back_end/
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── services/
│   │   └── server.ts
│   ├── docs/
│   └── sql/
├── front_end/
│   ├── app/
│   ├── components/
│   ├── lib/
│   └── store/
├── docker-compose.yml
├── GUIDE_APLIKASI_MIGUNANI_MOTOR.md
└── ONBOARDING_DEVELOPER.md
```

## Script Penting

### Root

```bash
npm run dev
npm run docker:up
npm run docker:down
npm run docker:logs
npm run docker:seed
npm run docker:bootstrap
npm run seed
```

### Backend

```bash
cd back_end
npm run dev
npm run build
npm run start
```

### Frontend

```bash
cd front_end
npm run dev
npm run build
npm run start
```

## Database Schema & Migrations (Tahap 2)

Tujuan: schema dikelola lewat migrasi eksplisit (bukan “auto alter” saat startup), dan FK/index bisa ditambah bertahap.

### Audit (read-only)

```bash
cd back_end
npm run db:fk-audit
```

Output detail akan tersimpan di `/tmp/migunani_fk_audit.json`.

### Menjalankan migrasi (recommended)

Local dev (ts-node):

```bash
cd back_end
npm run migrate:up:with-sql
```

Production / container runner (Node dist):

```bash
cd back_end
npm run build
npm run migrate:up:with-sql:prod
```

### DB_SYNC_MODE=off (freeze runtime DDL)

Jika `DB_SYNC_MODE=off`, backend tidak akan menjalankan `sequelize.sync()` / `alter` / `ensure*` yang melakukan `ALTER TABLE`.
Backend akan fail-fast bila schema belum siap, dan meminta kamu menjalankan migrasi.

## Catatan Penting

- Endpoint frontend diarahkan ke backend lewat Next rewrite (`/api/*`).
- Beberapa migrasi masih manual SQL, cek `back_end/sql/README.md`.
- Untuk pemahaman modul dan gap implementasi, gunakan `GUIDE_APLIKASI_MIGUNANI_MOTOR.md` sebagai sumber utama.
- Jangan jalankan seeder paralel dengan backend (`seed` dan backend sama-sama mengubah schema).
