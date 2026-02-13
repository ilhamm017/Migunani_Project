'use client';

import Link from 'next/link';
import { ListChecks, UserPlus, UserRoundSearch } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';

export default function StaffModulePage() {
  const allowed = useRequireRoles(['super_admin']);
  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm">
        <h1 className="text-xl font-black text-slate-900">Modul Staff</h1>
        <p className="text-sm text-slate-600 mt-1">
          Halaman staff dipisah agar alur manajemen lebih rapi: tambah staff, daftar staff, dan detail staff.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Link
          href="/admin/staff/tambah"
          className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:border-emerald-300 transition-colors"
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <UserPlus size={18} />
          </div>
          <p className="text-sm font-black text-slate-900 mt-3">Tambah Staff</p>
          <p className="text-xs text-slate-600 mt-1">Buat akun staff baru beserta role operasional.</p>
        </Link>

        <Link
          href="/admin/staff/daftar"
          className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:border-emerald-300 transition-colors"
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <ListChecks size={18} />
          </div>
          <p className="text-sm font-black text-slate-900 mt-3">Daftar Staff</p>
          <p className="text-xs text-slate-600 mt-1">Lihat seluruh staff dan buka detail masing-masing data.</p>
        </Link>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center">
            <UserRoundSearch size={18} />
          </div>
          <p className="text-sm font-black text-slate-900 mt-3">Detail Staff</p>
          <p className="text-xs text-slate-600 mt-1">
            Buka dari halaman daftar untuk lihat metadata dan edit data staff.
          </p>
        </div>
      </div>
    </div>
  );
}
