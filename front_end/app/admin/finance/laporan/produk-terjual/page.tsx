'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency } from '@/lib/utils';
import { getDefaultMonthRange, toNumber, toText } from '@/app/admin/finance/laporan/reportUtils';
import { notifyAlert } from '@/lib/notify';

type ProductsSoldRow = {
  product_id?: string;
  sku?: string | null;
  product_name?: string | null;
  unit?: string | null;
  qty_sold?: number | string | null;
  revenue?: number | string | null;
  cogs?: number | string | null;
};

export default function LaporanProdukTerjualPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_finance', 'kasir']);
  const defaults = useMemo(() => getDefaultMonthRange(), []);

  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ProductsSoldRow[]>([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.admin.finance.getProductsSoldReport({ startDate, endDate, limit: 100 });
      setRows(Array.isArray(res.data?.rows) ? (res.data.rows as ProductsSoldRow[]) : []);
    } catch (e) {
      console.error(e);
      notifyAlert('Gagal memuat laporan produk terjual');
    } finally {
      setLoading(false);
    }
  }, [endDate, startDate]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const summary = useMemo(() => {
    const qty = rows.reduce((sum, row) => sum + toNumber(row.qty_sold), 0);
    const revenue = rows.reduce((sum, row) => sum + toNumber(row.revenue), 0);
    const cogs = rows.reduce((sum, row) => sum + toNumber(row.cogs), 0);
    return { qty, revenue, cogs, grossProfit: revenue - cogs };
  }, [rows]);

  if (!allowed) return null;

  return (
    <div className="bg-slate-50 min-h-screen pb-10">
      <div className="bg-white px-6 py-4 shadow-sm sticky top-0 z-40">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/admin/finance/laporan" className="p-2 -ml-2 rounded-full hover:bg-slate-100">
            <ArrowLeft size={20} className="text-slate-700" />
          </Link>
          <h1 className="font-bold text-lg text-slate-900">Laporan Produk Terjual</h1>
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
          Sumber data: invoice <span className="font-bold">paid</span> (verified_at) + POS <span className="font-bold">paid</span> (paid_at) pada periode.
        </p>
      </div>

      <div className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Revenue</p>
            <p className="text-2xl font-black text-slate-900">{formatCurrency(summary.revenue)}</p>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 mb-1 font-bold uppercase">COGS (estimasi)</p>
            <p className="text-2xl font-black text-slate-900">{formatCurrency(summary.cogs)}</p>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Gross Profit</p>
            <p className="text-2xl font-black text-slate-900">{formatCurrency(summary.grossProfit)}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black text-slate-900">Top Produk Terjual</h2>
            <div className="text-xs text-slate-500">
              Total item: <span className="font-bold text-slate-700">{summary.qty}</span>
            </div>
          </div>

          {loading && <p className="text-sm text-slate-400">Loading...</p>}
          {!loading && rows.length === 0 && <p className="text-sm text-slate-400">Tidak ada data pada periode ini.</p>}

          {!loading && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-2 pr-4 font-black uppercase tracking-widest">SKU</th>
                    <th className="py-2 pr-4 font-black uppercase tracking-widest">Produk</th>
                    <th className="py-2 pr-4 font-black uppercase tracking-widest text-right">Qty</th>
                    <th className="py-2 pr-4 font-black uppercase tracking-widest text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={toText(row.product_id, toText(row.sku))} className="border-t border-slate-100">
                      <td className="py-2 pr-4 font-mono font-bold text-slate-700">{toText(row.sku)}</td>
                      <td className="py-2 pr-4">
                        <p className="font-bold text-slate-900">{toText(row.product_name)}</p>
                        <p className="text-[10px] text-slate-500">{toText(row.unit, '')}</p>
                      </td>
                      <td className="py-2 pr-4 text-right font-black text-slate-900">{toNumber(row.qty_sold)}</td>
                      <td className="py-2 pr-4 text-right font-black text-slate-900">{formatCurrency(toNumber(row.revenue))}</td>
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
