'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency } from '@/lib/utils';
import { getDefaultMonthRange, toNumber, toText } from '@/app/admin/finance/laporan/reportUtils';
import { notifyAlert } from '@/lib/notify';

type ExpenseItem = {
  id: string;
  category: string;
  amount: number | string;
  date: string;
  note?: string | null;
  status?: 'requested' | 'approved' | 'paid' | string;
};

export default function LaporanBiayaPendapatanLainPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_finance']);
  const defaults = useMemo(() => getDefaultMonthRange(), []);

  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ExpenseItem[]>([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.admin.finance.getExpenses({ page: 1, limit: 200, startDate, endDate });
      setRows(Array.isArray(res.data?.expenses) ? (res.data.expenses as ExpenseItem[]) : []);
    } catch (e) {
      console.error(e);
      notifyAlert('Gagal memuat laporan biaya');
    } finally {
      setLoading(false);
    }
  }, [endDate, startDate]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const summary = useMemo(() => {
    const total = rows.reduce((sum, row) => sum + toNumber(row.amount), 0);
    const paid = rows.filter((row) => String(row.status) === 'paid').reduce((sum, row) => sum + toNumber(row.amount), 0);
    return { total, paid, count: rows.length };
  }, [rows]);

  if (!allowed) return null;

  return (
    <div className="bg-slate-50 min-h-screen pb-10">
      <div className="bg-white px-6 py-4 shadow-sm sticky top-0 z-40">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/admin/finance/laporan" className="p-2 -ml-2 rounded-full hover:bg-slate-100">
            <ArrowLeft size={20} className="text-slate-700" />
          </Link>
          <h1 className="font-bold text-lg text-slate-900">Biaya / Pendapatan Lain-lain</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_80px] gap-2 bg-slate-100 p-2 rounded-xl">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-white border-none rounded-lg text-xs font-bold px-2 py-2 text-center"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-white border-none rounded-lg text-xs font-bold px-2 py-2 text-center"
          />
          <button onClick={load} className="bg-slate-900 text-white rounded-lg text-xs font-bold">
            Go
          </button>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Total Biaya</p>
            <p className="text-2xl font-black text-slate-900">{formatCurrency(summary.total)}</p>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Sudah Dibayar</p>
            <p className="text-2xl font-black text-emerald-700">{formatCurrency(summary.paid)}</p>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Jumlah Transaksi</p>
            <p className="text-2xl font-black text-slate-900">{summary.count}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-black text-slate-900">Daftar Biaya</h2>
            <Link
              href="/admin/finance/biaya"
              className="text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50"
            >
              Buka Input Biaya
            </Link>
          </div>

          {loading && <p className="text-sm text-slate-400">Loading...</p>}
          {!loading && rows.length === 0 && <p className="text-sm text-slate-400">Tidak ada biaya pada periode ini.</p>}

          {!loading && rows.length > 0 && (
            <div className="space-y-2">
              {rows.map((row) => (
                <div key={row.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-900 truncate">{toText(row.category)}</p>
                      <p className="text-xs text-slate-600 truncate">
                        {String(row.date || '').slice(0, 10)} {row.status ? `• ${row.status}` : ''}
                      </p>
                      {row.note ? <p className="text-[10px] text-slate-500 mt-1 truncate">{row.note}</p> : null}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[11px] text-slate-500">Amount</p>
                      <p className="text-sm font-black text-slate-900">{formatCurrency(toNumber(row.amount))}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
          <p className="text-xs text-slate-500">
            Pendapatan lain-lain bisa diposting lewat jurnal/penyesuaian jika diperlukan.
          </p>
        </div>
      </div>
    </div>
  );
}
