'use client';

import Link from 'next/link';
import { ArrowLeft, Shield, UserPlus, Users } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { useAuthStore } from '@/store/authStore';

export default function SalesStaffAccessPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir']);
  const { user } = useAuthStore();
  const canManageStaff = user?.role === 'super_admin';

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/admin" className="inline-flex items-center gap-2 text-xs font-bold text-slate-600">
          <ArrowLeft size={14} />
          Kembali ke Overview
        </Link>
        <Link href="/admin/sales" className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700">
          Kembali ke List Customer
        </Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-[28px] p-5 shadow-sm">
        <p className="text-[10px] font-black text-violet-600 uppercase tracking-[0.2em]">Halaman Terpisah Karyawan</p>
        <h1 className="text-2xl font-black text-slate-900 mt-1">Akses Pendaftaran Karyawan Baru</h1>
        <p className="text-sm text-slate-600 mt-2">
          Halaman ini dipisah dari manajemen customer agar alur daftar customer tetap fokus ke list dan detail customer.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="w-10 h-10 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center">
            <UserPlus size={18} />
          </div>
          <div>
            <h2 className="text-sm font-black text-slate-900">Tambah Karyawan Baru</h2>
            <p className="text-xs text-slate-600 mt-1">Buka form pembuatan akun staff baru.</p>
          </div>
          {canManageStaff ? (
            <Link
              href="/admin/staff/tambah"
              className="inline-flex items-center justify-center w-full rounded-xl px-3 py-2 text-xs font-bold bg-violet-600 text-white"
            >
              Buka Form Tambah Staff
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className="inline-flex items-center justify-center w-full rounded-xl px-3 py-2 text-xs font-bold bg-slate-100 text-slate-500 cursor-not-allowed"
            >
              Khusus Super Admin
            </button>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
            <Users size={18} />
          </div>
          <div>
            <h2 className="text-sm font-black text-slate-900">Daftar Karyawan</h2>
            <p className="text-xs text-slate-600 mt-1">Lihat seluruh akun staff dan statusnya.</p>
          </div>
          {canManageStaff ? (
            <Link
              href="/admin/staff/daftar"
              className="inline-flex items-center justify-center w-full rounded-xl px-3 py-2 text-xs font-bold bg-emerald-600 text-white"
            >
              Buka Daftar Staff
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className="inline-flex items-center justify-center w-full rounded-xl px-3 py-2 text-xs font-bold bg-slate-100 text-slate-500 cursor-not-allowed"
            >
              Khusus Super Admin
            </button>
          )}
        </div>
      </div>

      {!canManageStaff && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 inline-flex items-center gap-2">
          <Shield size={14} />
          Role kamu saat ini tidak punya izin membuat akun karyawan. Minta Super Admin untuk eksekusi.
        </div>
      )}
    </div>
  );
}
