# Onboarding Developer (1 Halaman)

Dokumen cepat untuk mulai kontribusi di Migunani Motor.

## 1) Baca Dulu (Urutan)

1. `GUIDE_APLIKASI_MIGUNANI_MOTOR.md`
2. `README.md`
3. `back_end/docs/API_Contract.md`
4. `front_end/PAGE_LIST.md`
5. `back_end/sql/README.md`

## 2) Jalankan Project

### Opsi Rekomendasi (Dev Lokal + MySQL Docker)

```bash
cp .env.example .env
npm install
cd back_end && npm install && cd ..
cd front_end && npm install && cd ..

docker-compose up -d mysql
npm run dev
```

Akses:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:5000`

## Seed Data (Opsional tapi sangat membantu)

```bash
npm run seed
```

Akun login dev:

- `superadmin@migunani.com` / `superadmin123`
- `gudang@migunani.com` / `gudang123`
- `finance@migunani.com` / `finance123`
- `kasir@migunani.com` / `kasir123`
- `driver@migunani.com` / `driver123`
- `customer@migunani.com` / `customer123`

## 3) Struktur Kerja Cepat

- Backend routes: `back_end/src/routes`
- Backend logic: `back_end/src/controllers`
- Model + relasi: `back_end/src/models`
- Frontend pages: `front_end/app`
- Frontend API client: `front_end/lib/api.ts`
- Frontend guards role/auth: `front_end/lib/guards.ts`

## 4) Mapping Role ke Dashboard Frontend

- `super_admin` -> `/admin`
- `admin_gudang` -> `/admin/inventory`
- `admin_finance` -> `/admin/finance`
- `kasir` -> `/admin/pos`
- `driver` -> `/driver`
- `customer` -> `/`

## 5) Area yang Sudah Stabil

- Catalog public + detail produk
- Inventory (produk, kategori, supplier, import preview/commit)
- Order admin flow + issue tracking
- Finance verify + expenses + AR + PnL
- POS checkout + hold/resume + shift
- Driver assignment + complete delivery
- Chat admin inbox + web widget + WA status

## 6) Known Gaps (Perlu Diperhatikan)

- `back_end/src/jobs/cron.ts` belum diaktifkan di `server.ts`
- `PAGE_LIST.md` dan `API_Contract.md` harus selalu diupdate saat route berubah
- Beberapa halaman admin masih MVP UI: broadcast, audit log, settings
- Cart frontend masih dominan local state, belum full sinkron endpoint backend
- Checkout UI punya field alamat/catatan, tapi backend belum simpan field tersebut

## 7) Aturan Praktis Saat Menambah Fitur

- Tambah/ubah endpoint: update `back_end/docs/API_Contract.md`
- Tambah/ubah halaman: update `front_end/PAGE_LIST.md`
- Ubah alur bisnis besar: update `GUIDE_APLIKASI_MIGUNANI_MOTOR.md`
- Tambah kolom tabel: update SQL migration docs (`back_end/sql/README.md`)

## 8) Checklist Sebelum PR

- [ ] Endpoint berjalan dan role guard benar
- [ ] UI route dan navigasi sesuai role
- [ ] Error handling API jelas
- [ ] Dokumen terkait sudah diperbarui
