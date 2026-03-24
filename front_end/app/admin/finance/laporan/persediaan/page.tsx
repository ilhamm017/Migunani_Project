'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency } from '@/lib/utils';
import { toNumber } from '@/app/admin/finance/laporan/reportUtils';

type InventoryValueSummary = {
  total_valuation?: number;
  total_items?: number;
};

export default function LaporanPersediaanPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_finance', 'kasir']);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<InventoryValueSummary | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.admin.finance.getInventoryValue();
      const payload = (res.data || {}) as Record<string, unknown>;
      setData({
        total_valuation: toNumber(payload.total_valuation),
        total_items: toNumber(payload.total_items),
      });
    } catch (e) {
      console.error(e);
      alert('Gagal memuat data persediaan');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const totalVal = useMemo(() => toNumber(data?.total_valuation), [data]);

  if (!allowed) return null;

  return (
    <div className="bg-slate-50 min-h-screen pb-10">
      <div className="bg-white px-6 py-4 shadow-sm sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <Link href="/admin/finance/laporan" className="p-2 -ml-2 rounded-full hover:bg-slate-100">
            <ArrowLeft size={20} className="text-slate-700" />
          </Link>
          <h1 className="font-bold text-lg text-slate-900">Persediaan</h1>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
          <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Nilai Inventaris</p>
          <p className="text-3xl font-black text-slate-900">{formatCurrency(totalVal)}</p>
          <p className="text-xs text-slate-500 mt-2">
            Total item: <span className="font-bold text-slate-700">{toNumber(data?.total_items)}</span>
            {loading ? <span className="ml-2 text-slate-400">Loading...</span> : null}
          </p>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-3">
          <h2 className="text-sm font-black text-slate-900">Akses Cepat</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Link
              href="/admin/finance/laporan/inventory-value"
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-900 hover:bg-slate-100"
            >
              Nilai Inventaris (Detail)
              <p className="text-xs font-semibold text-slate-500 mt-1">Breakdown per SKU.</p>
            </Link>
            <Link
              href="/admin/inventory"
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-900 hover:bg-slate-100"
            >
              Inventory (Produk)
              <p className="text-xs font-semibold text-slate-500 mt-1">Cari produk & cek stok.</p>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
