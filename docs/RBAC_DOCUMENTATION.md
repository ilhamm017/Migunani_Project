# Dokumentasi Role-Based Access Control (RBAC) - Migunani Motor Project

Dokumen ini menjelaskan implementasi Role-Based Access Control (RBAC) pada sistem Migunani Motor Project. Sistem ini membatasi akses ke fitur dan data berdasarkan peran (role) pengguna untuk menjaga keamanan dan integritas data.

## 1. Daftar Role User

Sistem mendefinisikan peran-peran berikut dalam model User (`back_end/src/models/User.ts`):

| Role | Deskripsi | Akses Utama |
| :--- | :--- | :--- |
| **super_admin** | Administrator utama dengan akses penuh. | Manajemen Staf, Pengaturan Sistem, Semua Modul Admin. |
| **admin_gudang** | Staf yang bertanggung jawab atas inventaris. | Modul Inventory (Stok, Barang Masuk/Keluar). |
| **admin_finance** | Staf keuangan. | Modul Finance (Laporan, Validasi Pembayaran). |
| **kasir** | Staf penjualan (Point of Sale). | Modul POS (Transaksi Penjualan). |
| **driver** | Staf pengiriman. | Modul Driver (Melihat Tugas Pengiriman). |
| **customer** | Pelanggan akhir. | Browsing Katalog, Checkout, Profil Pelanggan. |

## 2. Implementasi Backend

Backend menggunakan **Express.js** dan **Sequelize**. Keamanan diterapkan melalui middleware JSON Web Token (JWT).

### 2.1. Model User
Role didefinisikan sebagai ENUM di database:
```typescript
// back_end/src/models/User.ts
role: {
    type: DataTypes.ENUM('super_admin', 'admin_gudang', 'admin_finance', 'kasir', 'driver', 'customer'),
    defaultValue: 'customer',
}
```

### 2.2. Middleware Autentikasi & Otorisasi
Lokasi: `back_end/src/middleware/authMiddleware.ts`

1.  **authenticateToken**:
    *   Memverifikasi validitas token JWT dari header `Authorization`.
    *   Jika valid, data user (termasuk role) ditempelkan ke object `req.user`.
    *   Jika tidak valid/tidak ada, mengembalikan error `401` atau `403`.

2.  **authorizeRoles(...allowedRoles)**:
    *   Middleware factory yang menerima daftar role yang diizinkan.
    *   Memeriksa apakah `req.user.role` ada dalam daftar `allowedRoles`.
    *   Jika tidak, mengembalikan error `403 Forbidden`.

### 2.3. Contoh Penggunaan di Route
Route dilindungi dengan memasang middleware secara berurutan.
Contoh pada `back_end/src/routes/staff.ts` (Hanya Super Admin):

```typescript
router.use(authenticateToken); // Pastikan login
router.use(authorizeRoles('super_admin')); // Pastikan role super_admin

router.get('/', StaffController.getStaff);
router.post('/', StaffController.createStaff);
```

### 2.4. Manajemen Staf
Controller `StaffController.ts` memastikan bahwa staf hanya dapat dibuat dengan role operasional tertentu (`admin_gudang`, `admin_finance`, `kasir`, `driver`).

## 3. Implementasi Frontend

Frontend menggunakan **Next.js** dan **Zustand** untuk manajemen state auth.

### 3.1. Authentication Store
Lokasi: `front_end/store/authStore.ts`
*   Menyimpan token JWT dan informasi user (termasuk role) di state aplikasi.
*   Menggunakan persist middleware untuk menyimpan sesi di `localStorage`.

### 3.2. Role Redirect
Lokasi: `front_end/lib/roleRedirect.ts`
Fungsi `getDashboardPathByRole` menentukan halaman tujuan setelah login berdasarkan role:

*   `super_admin` -> `/admin`
*   `admin_gudang` -> `/admin/inventory`
*   `admin_finance` -> `/admin/finance`
*   `kasir` -> `/admin/pos`
*   `driver` -> `/driver`
*   `customer` -> `/`

### 3.3. Route Guards (Proteksi Halaman)
Lokasi: `front_end/lib/guards.ts`
Digunakan di dalam komponen/halaman (Client Components) untuk membatasi akses.

1.  **useRequireAuth(redirectTo)**:
    *   Memastikan user sudah login. Jika belum, redirect ke halaman login.

2.  **useRequireRoles(roles, redirectTo)**:
    *   Memastikan user memiliki salah satu dari role yang diizinkan.
    *   Jika tidak sesuai, redirect ke halaman default (biasanya `/`).

Contoh Penggunaan di Page:
```tsx
// front_end/app/admin/staff/page.tsx
'use client';
import { useRequireRoles } from '@/lib/guards';

export default function StaffPage() {
  // Hanya super_admin yang boleh masuk
  const hasAccess = useRequireRoles(['super_admin']);

  if (!hasAccess) return null; // Atau loading spinner

  return <div>Halaman Manajemen Staf</div>;
}
```

## 4. Matriks Akses (Ringkasan)

| Fitur | Super Admin | Admin Gudang | Admin Finance | Kasir | Driver | Customer |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Login/Register** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Manajemen Staff** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Inventory (CRUD)**| ✅ | ✅ | 👀 (View) | ❌ | ❌ | ❌ |
| **Finance (Laporan)**| ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| **POS (Penjualan)** | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Pengiriman** | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| **Belanja Online** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

*(Catatan: Tanda ✅ berarti diizinkan, ❌ berarti dilarang, 👀 berarti akses baca saja - tergantung implementasi detail di controller masing-masing)*

## 5. Kesimpulan

Sistem RBAC Migunani Motor Project menerapkan keamanan berlapis:
1.  **Level Database**: Definisi tipe data Role yang ketat.
2.  **Level API (Backend)**: Middleware token dan validasi role di setiap endpoint sensitif.
3.  **Level UI (Frontend)**: Redirection logic dan Guard hooks untuk pengalaman pengguna yang mulus dan aman.
