'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw, Search, UserPlus } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { roleLabelMap, StaffRecord } from '../staffShared';

export default function StaffListPage() {
  const allowed = useRequireRoles(['super_admin']);
  const [staff, setStaff] = useState<StaffRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const activeCount = useMemo(() => staff.filter((item) => item.status === 'active').length, [staff]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return staff;
    return staff.filter((item) => {
      return (
        item.name.toLowerCase().includes(term) ||
        (item.email || '').toLowerCase().includes(term) ||
        item.whatsapp_number.toLowerCase().includes(term) ||
        roleLabelMap[item.role].toLowerCase().includes(term)
      );
    });
  }, [search, staff]);

  const loadStaff = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.admin.staff.getAll();
      setStaff((res.data?.staff || []) as StaffRecord[]);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Gagal memuat daftar staff');
      setStaff([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (allowed) {
      loadStaff();
    }
  }, [allowed]);

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-2">
        <Link href="/admin/staff" className="inline-flex items-center gap-2 text-xs font-bold text-slate-600">
          <ArrowLeft size={14} />
          Kembali ke Modul Staff
        </Link>

        <div className="flex items-center gap-2">
          <button
            onClick={loadStaff}
            disabled={loading}
            className="px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold inline-flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw size={12} />
            Refresh
          </button>
          <Link
            href="/admin/staff/tambah"
            className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold inline-flex items-center gap-2"
          >
            <UserPlus size={12} />
            Tambah
          </Link>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm">
        <h1 className="text-xl font-black text-slate-900">Daftar Staff</h1>
        <p className="text-sm text-slate-600 mt-1">Klik salah satu staff untuk membuka halaman detail dan edit metadata.</p>
        <p className="text-xs text-slate-500 mt-2">
          Total: <span className="font-bold text-slate-900">{staff.length}</span> | Aktif:{' '}
          <span className="font-bold text-emerald-700">{activeCount}</span>
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm"
            placeholder="Cari nama / email / role / no wa"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {error && <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl p-3">{error}</div>}

        <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
          {loading ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-500">Memuat data...</div>
          ) : filtered.length === 0 ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-500">Data staff tidak ditemukan.</div>
          ) : (
            filtered.map((item) => (
              <Link
                key={item.id}
                href={`/admin/staff/${item.id}`}
                className="block border border-slate-200 rounded-xl p-3 hover:border-emerald-300 hover:bg-emerald-50/40 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-900">{item.name}</p>
                    <p className="text-xs text-slate-600">{item.email || '-'} • {item.whatsapp_number}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold text-slate-700">{roleLabelMap[item.role]}</p>
                    <p className={`text-[11px] font-bold ${item.status === 'active' ? 'text-emerald-700' : 'text-rose-600'}`}>
                      {item.status === 'active' ? 'Aktif' : 'Nonaktif'}
                    </p>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
