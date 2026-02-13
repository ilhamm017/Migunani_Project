'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { ArRow, sourceLabel } from './arShared';

export default function FinanceARPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_finance']);
  const [rows, setRows] = useState<ArRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const res = await api.admin.finance.getAR();
        setRows(Array.isArray(res.data) ? (res.data as ArRow[]) : []);
      } catch (error) {
        console.error('Failed to load AR:', error);
      } finally {
        setLoading(false);
      }
    };
    if (allowed) load();
  }, [allowed]);

  if (!allowed) return null;

  const totalDue = rows.reduce((sum, row) => sum + Number(row.amount_due || 0), 0);
  const totalInvoices = rows.length;

  return (
    <div className="p-6 space-y-5">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
        <h1 className="text-xl font-black text-slate-900">Laporan Piutang (Aging)</h1>
        <p className="text-xs text-slate-600">
          Menampilkan daftar singkat piutang aktif. Klik salah satu data untuk membuka halaman detail piutang.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          <div className="bg-rose-50 border border-rose-100 rounded-xl p-3">
            <p className="text-[11px] font-bold text-rose-700 uppercase">Total Piutang</p>
            <p className="text-lg font-black text-rose-800">{formatCurrency(totalDue)}</p>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <p className="text-[11px] font-bold text-slate-600 uppercase">Invoice Aktif</p>
            <p className="text-lg font-black text-slate-900">{totalInvoices}</p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
        <h2 className="text-sm font-black text-slate-900">Daftar Piutang Aktif</h2>
        {loading && <p className="text-sm text-slate-500">Memuat data piutang...</p>}
        {!loading && rows.length === 0 && <p className="text-sm text-slate-500">Tidak ada piutang aktif.</p>}
        {!loading && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map((r) => (
              <Link
                key={r.id}
                href={`/admin/finance/piutang/${r.id}`}
                className="block w-full text-left border rounded-xl p-3 transition-colors bg-slate-50 border-slate-200 hover:bg-slate-100"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{r.order?.customer_name || '-'}</p>
                    <p className="text-xs text-slate-600 truncate">
                      {r.invoice_number} • Order {r.order?.id || '-'} • {sourceLabel(r.order?.source)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[11px] text-slate-500">Sisa</p>
                    <p className="text-sm font-black text-rose-700">{formatCurrency(Number(r.amount_due || 0))}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
