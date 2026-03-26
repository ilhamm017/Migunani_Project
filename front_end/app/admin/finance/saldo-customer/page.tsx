'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

type BalanceRow = {
  customer_id: string;
  customer_name?: string;
  whatsapp_number?: string;
  balance: number;
  last_movement_at?: string | null;
};

type ApiErrorWithMessage = {
  response?: { data?: { message?: string } };
};

export default function AdminFinanceSaldoCustomerPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_finance']);

  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'only_negative' | 'only_positive'>('only_negative');
  const [rows, setRows] = useState<BalanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.admin.finance.getCustomerBalanceReport({
        q: q.trim() || undefined,
        only_negative: filter === 'only_negative',
        only_positive: filter === 'only_positive',
        limit: 120,
        offset: 0,
      });
      const list = Array.isArray(res.data?.rows) ? (res.data.rows as BalanceRow[]) : [];
      setRows(list);
    } catch (e: unknown) {
      const err = e as ApiErrorWithMessage;
      setRows([]);
      setError(err?.response?.data?.message || 'Gagal memuat laporan saldo customer');
    } finally {
      setLoading(false);
    }
  }, [filter, q]);

  useEffect(() => {
    if (!allowed) return;
    const timer = setTimeout(() => {
      void load();
    }, 250);
    return () => clearTimeout(timer);
  }, [allowed, load]);

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-black text-slate-900">Saldo Customer</h2>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="btn-3d inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200/70 disabled:opacity-50"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <div className="md:col-span-3 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari nama, WA, email"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm"
            />
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
          >
            <option value="only_negative">Hutang (Minus)</option>
            <option value="only_positive">Kredit (Plus)</option>
            <option value="all">Semua</option>
          </select>
        </div>
      </div>

      {error ? <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700">{error}</div> : null}

      <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-2">
        {loading ? (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-500">Memuat data...</div>
        ) : rows.length === 0 ? (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-500">Tidak ada data.</div>
        ) : (
          <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
            {rows.map((row) => {
              const bal = Number(row.balance || 0);
              const dateStr = row.last_movement_at ? String(row.last_movement_at).replace('T', ' ').slice(0, 19) : '-';
              return (
                <Link
                  key={row.customer_id}
                  href={`/admin/sales/${row.customer_id}#saldo-customer`}
                  className="block border border-slate-200 rounded-2xl p-3 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-slate-900">{row.customer_name || row.customer_id}</p>
                      <p className="text-xs text-slate-600 mt-1">{row.whatsapp_number || '-'}</p>
                      <p className="text-[11px] text-slate-500 mt-1">Last movement: <span className="font-bold text-slate-700">{dateStr}</span></p>
                    </div>
                    <div className={`text-sm font-black ${bal < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                      {formatCurrency(bal)}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

