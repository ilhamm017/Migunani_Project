'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { getDefaultMonthRange, toNumber } from '@/app/admin/finance/laporan/reportUtils';

type StockReductionSummary = {
  total_qty_reduced: number;
  total_products: number;
  total_orders: number;
};

export default function LaporanKoreksiStokPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir']);
  const defaults = useMemo(() => getDefaultMonthRange(), []);

  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<StockReductionSummary>({ total_qty_reduced: 0, total_products: 0, total_orders: 0 });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.admin.finance.getStockReductionReport({ startDate, endDate, eventType: 'all', search: '' });
      const payload = (res.data || {}) as any;
      setSummary({
        total_qty_reduced: toNumber(payload?.summary?.total_qty_reduced),
        total_products: toNumber(payload?.summary?.total_products),
        total_orders: toNumber(payload?.summary?.total_orders),
      });
    } catch (e) {
      console.error(e);
      alert('Gagal memuat ringkasan koreksi stok');
    } finally {
      setLoading(false);
    }
  }, [endDate, startDate]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  if (!allowed) return null;

  return (
    <div className="bg-slate-50 min-h-screen pb-10">
      <div className="bg-white px-6 py-4 shadow-sm sticky top-0 z-40">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/admin/finance/laporan" className="p-2 -ml-2 rounded-full hover:bg-slate-100">
            <ArrowLeft size={20} className="text-slate-700" />
          </Link>
          <h1 className="font-bold text-lg text-slate-900">Koreksi Stok</h1>
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
            <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Total Qty Berkurang</p>
            <p className="text-3xl font-black text-slate-900">{summary.total_qty_reduced}</p>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Produk Terdampak</p>
            <p className="text-3xl font-black text-slate-900">{summary.total_products}</p>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Order Terkait</p>
            <p className="text-3xl font-black text-slate-900">{summary.total_orders}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-3">
          <h2 className="text-sm font-black text-slate-900">Akses Cepat</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Link
              href="/admin/reports/stock-reduction"
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-900 hover:bg-slate-100"
            >
              Pengurangan Stok + Export IPO
              <p className="text-xs font-semibold text-slate-500 mt-1">Filter detail SKU & download Excel.</p>
            </Link>
            <Link
              href="/admin/warehouse/inbound"
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-900 hover:bg-slate-100"
            >
              Buat PO / Inbound
              <p className="text-xs font-semibold text-slate-500 mt-1">Restock untuk menutup kekurangan.</p>
            </Link>
          </div>
          {loading ? <p className="text-xs text-slate-400">Loading...</p> : null}
        </div>
      </div>
    </div>
  );
}
