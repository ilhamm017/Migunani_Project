'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency } from '@/lib/utils';
import { getDefaultMonthRange, toNumber, toText } from '@/app/admin/finance/laporan/reportUtils';
import { notifyAlert } from '@/lib/notify';

type OrderRow = {
  id?: string;
  customer_name?: string | null;
  total_amount?: number | null;
  status?: string | null;
};

const EXCLUDED_STATUSES = new Set(['canceled', 'expired']);

export default function LaporanOmsetSalesPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_finance', 'kasir']);
  const defaults = useMemo(() => getDefaultMonthRange(), []);

  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<OrderRow[]>([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.admin.orderManagement.getAll({
        page: 1,
        limit: 200,
        status: 'all',
        startDate,
        endDate,
      });
      setRows(Array.isArray(res.data?.orders) ? (res.data.orders as OrderRow[]) : []);
    } catch (e) {
      console.error(e);
      notifyAlert('Gagal memuat laporan omzet sales');
    } finally {
      setLoading(false);
    }
  }, [endDate, startDate]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const ranking = useMemo(() => {
    const map = new Map<string, { customer: string; omzet: number; orderCount: number }>();
    rows
      .filter((row) => row && row.id)
      .filter((row) => !EXCLUDED_STATUSES.has(String(row.status || '').trim()))
      .forEach((row) => {
        const customer = toText(row.customer_name, 'Customer');
        const existing = map.get(customer) || { customer, omzet: 0, orderCount: 0 };
        existing.omzet += toNumber(row.total_amount);
        existing.orderCount += 1;
        map.set(customer, existing);
      });
    return Array.from(map.values()).sort((a, b) => b.omzet - a.omzet);
  }, [rows]);

  const totalOmzet = useMemo(() => ranking.reduce((sum, r) => sum + r.omzet, 0), [ranking]);

  if (!allowed) return null;

  return (
    <div className="bg-slate-50 min-h-screen pb-10">
      <div className="bg-white px-6 py-4 shadow-sm sticky top-0 z-40">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/admin/finance/laporan" className="p-2 -ml-2 rounded-full hover:bg-slate-100">
            <ArrowLeft size={20} className="text-slate-700" />
          </Link>
          <h1 className="font-bold text-lg text-slate-900">Omset Sales</h1>
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
        <p className="text-[10px] text-slate-500 mt-2">
          Catatan: ranking dihitung dari max 200 order terbaru pada periode.
        </p>
      </div>

      <div className="p-5 space-y-4">
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
          <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Total Omzet (Order)</p>
          <p className="text-3xl font-black text-slate-900">{formatCurrency(totalOmzet)}</p>
          <p className="text-xs text-slate-500 mt-2">
            Customer terdeteksi: <span className="font-bold text-slate-700">{ranking.length}</span>
            {loading ? <span className="ml-2 text-slate-400">Loading...</span> : null}
          </p>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black text-slate-900">Ranking Omzet</h2>
            <Link
              href="/admin/orders"
              className="text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50"
            >
              Lihat Order
            </Link>
          </div>

          {!loading && ranking.length === 0 && <p className="text-sm text-slate-400">Tidak ada data pada periode ini.</p>}

          {ranking.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-2 pr-4 font-black uppercase tracking-widest">#</th>
                    <th className="py-2 pr-4 font-black uppercase tracking-widest">Customer</th>
                    <th className="py-2 pr-4 font-black uppercase tracking-widest text-right">Order</th>
                    <th className="py-2 pr-4 font-black uppercase tracking-widest text-right">Omzet</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.slice(0, 50).map((row, idx) => (
                    <tr key={`${row.customer}-${idx}`} className="border-t border-slate-100">
                      <td className="py-2 pr-4 font-black text-slate-700">{idx + 1}</td>
                      <td className="py-2 pr-4">
                        <p className="font-bold text-slate-900">{row.customer}</p>
                      </td>
                      <td className="py-2 pr-4 text-right font-black text-slate-900">{row.orderCount}</td>
                      <td className="py-2 pr-4 text-right font-black text-slate-900">{formatCurrency(row.omzet)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
