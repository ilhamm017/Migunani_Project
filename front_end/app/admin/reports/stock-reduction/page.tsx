'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, Filter, Package, ShoppingCart } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatDateTime } from '@/lib/utils';

type EventType = 'all' | 'allocation' | 'goods_out';

type StockReductionRow = {
  event_type: 'allocation' | 'goods_out';
  product_id: string;
  sku: string;
  product_name: string;
  unit: string;
  qty_reduced: number;
  order_count: number;
  related_order_ids: string[];
  latest_order_id: string | null;
  latest_event_at: string | null;
  breakdown: {
    allocation: number;
    goods_out: number;
  };
};

type StockReductionPayload = {
  period: { start: string; end: string };
  event_type: EventType;
  search: string;
  summary: {
    total_qty_reduced: number;
    total_products: number;
    total_orders: number;
  };
  rows: StockReductionRow[];
};

const toDateInputValue = (date: Date) => date.toISOString().slice(0, 10);

export default function StockReductionReportPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir', 'admin_gudang']);
  const [rows, setRows] = useState<StockReductionRow[]>([]);
  const [summary, setSummary] = useState({ total_qty_reduced: 0, total_products: 0, total_orders: 0 });
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const [eventType, setEventType] = useState<EventType>('goods_out');
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toDateInputValue(d);
  });
  const [endDate, setEndDate] = useState(() => toDateInputValue(new Date()));

  const filterParams = useMemo(() => ({
    startDate,
    endDate,
    eventType,
    search: search.trim(),
  }), [startDate, endDate, eventType, search]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.admin.finance.getStockReductionReport(filterParams);
      const payload = (res.data || {}) as StockReductionPayload;
      setRows(Array.isArray(payload.rows) ? payload.rows : []);
      setSummary(payload.summary || { total_qty_reduced: 0, total_products: 0, total_orders: 0 });
    } catch (e: unknown) {
      const message = typeof e === 'object' && e && 'response' in e
        ? String((e as { response?: { data?: { message?: string } } }).response?.data?.message || '')
        : '';
      setError(message || 'Gagal memuat laporan pengurangan stok.');
    } finally {
      setLoading(false);
    }
  }, [filterParams]);

  const handleExport = async () => {
    try {
      setExporting(true);
      setError('');
      const res = await api.admin.finance.exportStockReductionReport(filterParams);
      const contentDisposition = String(res.headers?.['content-disposition'] || '');
      const fileNameMatch = contentDisposition.match(/filename="([^"]+)"/i);
      const fileName = fileNameMatch?.[1] || `ipo-usulan-stock-reduction-${toDateInputValue(new Date()).replace(/-/g, '')}.xlsx`;

      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: unknown) {
      const message = typeof e === 'object' && e && 'response' in e
        ? String((e as { response?: { data?: { message?: string } } }).response?.data?.message || '')
        : '';
      setError(message || 'Gagal export Excel.');
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    if (!allowed) return;
    void loadData();
  }, [allowed, loadData]);

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
            <ArrowLeft size={16} />
            Kembali
          </Link>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Monitoring IPO</p>
            <h1 className="text-xl font-black text-slate-900">Pengurangan Stok</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || loading}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black uppercase tracking-wide text-white disabled:opacity-60"
          >
            <Download size={14} />
            {exporting ? 'Exporting...' : 'Export Excel IPO'}
          </button>
          <Link href="/admin/warehouse/inbound" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-700">
            <ShoppingCart size={14} />
            Buat PO / Inbound
          </Link>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500">
          <Filter size={14} />
          Filter
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase">Start Date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase">End Date</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase">Event Type</label>
            <select value={eventType} onChange={(e) => setEventType(e.target.value as EventType)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white">
              <option value="all">Semua</option>
              <option value="allocation">Allocation</option>
              <option value="goods_out">Goods Out</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase">Cari SKU/Nama</label>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter produk..." className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
        </div>
        <div>
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="rounded-xl border border-slate-200 bg-slate-900 px-4 py-2 text-xs font-black uppercase tracking-wide text-white disabled:opacity-60"
          >
            {loading ? 'Memuat...' : 'Terapkan Filter'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Qty Berkurang</p>
          <p className="mt-2 text-2xl font-black text-slate-900">{summary.total_qty_reduced}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Produk Terdampak</p>
          <p className="mt-2 text-2xl font-black text-slate-900">{summary.total_products}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Order Terkait</p>
          <p className="mt-2 text-2xl font-black text-slate-900">{summary.total_orders}</p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <p className="text-sm font-black text-slate-900">Daftar Agregasi Pengurangan Stok</p>
          <span className="text-[11px] font-bold text-slate-500">{rows.length} baris</span>
        </div>
        {rows.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">Tidak ada data pada filter ini.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Produk</th>
                  <th className="px-4 py-3">Qty Berkurang</th>
                  <th className="px-4 py-3">Breakdown</th>
                  <th className="px-4 py-3">Order Terkait</th>
                  <th className="px-4 py-3">Event Terakhir</th>
                  <th className="px-4 py-3">Ref Order</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.product_id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 rounded-lg bg-slate-100 p-1.5 text-slate-600">
                          <Package size={14} />
                        </div>
                        <div>
                          <p className="font-bold text-slate-900">{row.product_name}</p>
                          <p className="text-xs text-slate-500">{row.sku} • {row.unit || '-'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-black text-slate-900">{row.qty_reduced}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <p>Allocation: <b>{Number(row.breakdown?.allocation || 0)}</b></p>
                      <p>Goods Out: <b>{Number(row.breakdown?.goods_out || 0)}</b></p>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-700">{row.order_count}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {row.latest_event_at ? formatDateTime(row.latest_event_at) : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(row.related_order_ids || []).slice(0, 5).map((orderId) => (
                          <Link
                            key={`${row.product_id}-${orderId}`}
                            href={`/admin/orders/${orderId}`}
                            className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600 hover:border-emerald-300 hover:text-emerald-700"
                          >
                            #{String(orderId).slice(-8).toUpperCase()}
                          </Link>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
