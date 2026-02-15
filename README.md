# Migunani Motor - Sistem Omnichannel Sparepart Motor

Aplikasi full-stack untuk operasional toko suku cadang motor: e-commerce, inventory, POS, finance, driver, dan chat omnichannel (Web + WhatsApp).

## Dokumen Utama

- Panduan menyeluruh aplikasi: `GUIDE_APLIKASI_MIGUNANI_MOTOR.md`
- Onboarding cepat developer: `ONBOARDING_DEVELOPER.md`
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
docker-compose up -d --build
```

Akses:

- Frontend: `http://localhost:3500`
- Backend API: `http://localhost:5000`
- MySQL: `localhost:3306`

### Opsi B - Dev Lokal + MySQL Docker (direkomendasikan saat coding)

Cocok untuk hot reload backend/frontend di mesin lokal.

```bash
cp .env.example .env
npm install
cd back_end && npm install && cd ..
cd front_end && npm install && cd ..

docker-compose up -d mysql
npm run dev
```

Akses:

- Frontend (Next dev): `http://localhost:3000`
- Backend API (local dev): `http://localhost:5000`
- MySQL: `localhost:3306`

## Seeder Data

Seeder akan reset database (`sequelize.sync({ force: true })`) dan mengisi data awal.

```bash
npm run seed
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

## Catatan Penting

- Endpoint frontend diarahkan ke backend lewat Next rewrite (`/api/*`).
- Beberapa migrasi masih manual SQL, cek `back_end/sql/README.md`.
- Untuk pemahaman modul dan gap implementasi, gunakan `GUIDE_APLIKASI_MIGUNANI_MOTOR.md` sebagai sumber utama.
