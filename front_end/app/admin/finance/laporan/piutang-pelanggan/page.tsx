'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency } from '@/lib/utils';
import type { ArRow } from '@/app/admin/finance/piutang/arShared';
import { toNumber } from '@/app/admin/finance/laporan/reportUtils';

export default function LaporanPiutangPelangganPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_finance']);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ArRow[]>([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.admin.finance.getAR();
      setRows(Array.isArray(res.data) ? (res.data as ArRow[]) : []);
    } catch (e) {
      console.error(e);
      alert('Gagal memuat data piutang');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const totalDue = useMemo(() => rows.reduce((sum, row) => sum + toNumber(row.amount_due), 0), [rows]);
  const totalDebtDriver = useMemo(
    () => rows.filter((row) => String(row.payment_status) === 'debt').reduce((sum, row) => sum + toNumber(row.amount_due), 0),
    [rows]
  );

  if (!allowed) return null;

  return (
    <div className="bg-slate-50 min-h-screen pb-10">
      <div className="bg-white px-6 py-4 shadow-sm sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <Link href="/admin/finance/laporan" className="p-2 -ml-2 rounded-full hover:bg-slate-100">
            <ArrowLeft size={20} className="text-slate-700" />
          </Link>
          <h1 className="font-bold text-lg text-slate-900">Piutang Pelanggan</h1>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Total Outstanding</p>
            <p className="text-3xl font-black text-slate-900">{formatCurrency(totalDue)}</p>
            <p className="text-xs text-slate-500 mt-2">
              Total baris AR: <span className="font-bold text-slate-700">{rows.length}</span>
              {loading ? <span className="ml-2 text-slate-400">Loading...</span> : null}
            </p>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Piutang Driver (Debt)</p>
            <p className="text-3xl font-black text-slate-900">{formatCurrency(totalDebtDriver)}</p>
            <p className="text-xs text-slate-500 mt-2">Bagian dari data AR (pseudo invoice).</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-3">
          <h2 className="text-sm font-black text-slate-900">Akses Cepat</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Link
              href="/admin/invoices"
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-900 hover:bg-slate-100"
            >
              Buka Invoice Customer
              <p className="text-xs font-semibold text-slate-500 mt-1">Filter, detail piutang, dan cetak.</p>
            </Link>
            <Link
              href="/admin/finance/laporan/aging-ar"
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-900 hover:bg-slate-100"
            >
              Aging Piutang (AR)
              <p className="text-xs font-semibold text-slate-500 mt-1">Bucket aging otomatis.</p>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
