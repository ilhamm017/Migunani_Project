'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PackageSearch, RefreshCw, Search } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import type { AdminOrderMonitoringSkuResponse, AdminOrderMonitoringSkuRow } from '@/lib/apiTypes';
import { formatDateTime } from '@/lib/utils';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';

type Scope = 'active' | 'all';

const formatQty = (value: unknown): string => {
  const n = Number(value || 0);
  const safe = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(safe);
};

export default function AdminOrdersMonitoringSkuPage() {
  const allowed = useRequireRoles(['super_admin']);
  const [scope, setScope] = useState<Scope>('active');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AdminOrderMonitoringSkuResponse | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string>('');

  const dateRangeError = useMemo(() => {
    if (!startDate || !endDate) return '';
    if (startDate <= endDate) return '';
    return 'Tanggal mulai tidak boleh lebih besar dari tanggal akhir.';
  }, [startDate, endDate]);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!silent) setLoading(true);
    try {
      const res = await api.admin.orderManagement.getMonitoringSku({
        scope,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        search: search.trim() || undefined,
        page,
        limit,
      });
      setData(res?.data || null);
      setLastUpdatedAt(new Date().toISOString());
    } catch (error) {
      console.error('Failed to load SKU monitoring summary:', error);
      if (!silent) setData(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [endDate, limit, page, scope, search, startDate]);

  useEffect(() => {
    if (!allowed) return;
    if (dateRangeError) return;
    const timer = setTimeout(() => {
      void load();
    }, 250);
    return () => clearTimeout(timer);
  }, [allowed, dateRangeError, load]);

  useEffect(() => {
    setPage(1);
  }, [scope, startDate, endDate, search]);

  const refreshCurrent = useCallback(() => {
    if (!allowed) return;
    if (dateRangeError) return;
    void load({ silent: true });
  }, [allowed, dateRangeError, load]);

  useRealtimeRefresh({
    enabled: allowed,
    onRefresh: refreshCurrent,
    domains: ['order', 'admin'],
    pollIntervalMs: 15000,
  });

  const rows = (data?.rows || []) as AdminOrderMonitoringSkuRow[];
  const totalPages = Math.max(1, Number(data?.totalPages || 1));
  const total = Math.max(0, Number(data?.total || 0));

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.ordered += Number(row.ordered_net_qty || 0);
        acc.allocated += Number(row.allocated_qty || 0);
        acc.backorder += Number(row.backorder_pending_qty || 0);
        acc.canceled += Number(row.canceled_qty || 0);
        acc.suggested += Number(row.suggested_purchase_qty || 0);
        return acc;
      },
      { ordered: 0, allocated: 0, backorder: 0, canceled: 0, suggested: 0 }
    );
  }, [rows]);

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">Order Command</p>
          <h1 className="text-xl font-black text-slate-900">Monitoring SKU (Demand Planning)</h1>
          <p className="text-sm text-slate-600">Berapa order/qty per SKU, alokasi, dan backorder untuk perencanaan pembelian.</p>
          <p className="mt-1 text-[11px] text-slate-500">Last updated: {lastUpdatedAt ? formatDateTime(lastUpdatedAt) : '-'}</p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/admin/orders/monitoring"
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:border-emerald-300"
          >
            Ringkasan Order
          </Link>
          <button
            type="button"
            onClick={() => load()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-xs font-black text-emerald-700 hover:bg-emerald-100"
            disabled={loading || !!dateRangeError}
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <PackageSearch size={16} className="text-slate-400" />
          <p className="text-xs text-slate-600">Filter SKU</p>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <label className="space-y-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Scope</p>
            <select
              value={scope}
              onChange={(e) => setScope((String(e.target.value) === 'all' ? 'all' : 'active') as Scope)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none"
            >
              <option value="active">Order Aktif</option>
              <option value="all">Semua Order</option>
            </select>
          </label>

          <label className="space-y-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Tanggal mulai</p>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none"
            />
          </label>

          <label className="space-y-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Tanggal akhir</p>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none"
            />
          </label>

          <label className="space-y-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Cari SKU / nama</p>
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <Search size={14} className="text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Contoh: BRT-001 / Kampas"
                className="w-full bg-transparent text-xs font-bold text-slate-700 outline-none"
              />
            </div>
          </label>
        </div>

        {dateRangeError && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
            {dateRangeError}
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Rows (page)</p>
          <p className="mt-2 text-2xl font-black text-slate-900">{formatQty(rows.length)}</p>
          <p className="mt-1 text-[11px] font-semibold text-slate-500">Total SKU {formatQty(total)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Ordered (page)</p>
          <p className="mt-2 text-2xl font-black text-slate-900">{formatQty(totals.ordered)}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Allocated (page)</p>
          <p className="mt-2 text-2xl font-black text-emerald-900">{formatQty(totals.allocated)}</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Backorder (page)</p>
          <p className="mt-2 text-2xl font-black text-amber-900">{formatQty(totals.backorder)}</p>
        </div>
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-indigo-700">Suggested Purchase (page)</p>
          <p className="mt-2 text-2xl font-black text-indigo-900">{formatQty(totals.suggested)}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Daftar SKU</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 disabled:opacity-50"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
            >
              Prev
            </button>
            <span className="text-xs font-bold text-slate-600">
              Page {formatQty(page)} / {formatQty(totalPages)}
            </span>
            <button
              type="button"
              className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 disabled:opacity-50"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
            >
              Next
            </button>
          </div>
        </div>

        <div className="mt-3 overflow-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left text-[11px] font-black text-slate-500">
                <th className="py-2 pr-3">SKU</th>
                <th className="py-2 pr-3">Nama</th>
                <th className="py-2 pr-3">Stock</th>
                <th className="py-2 pr-3">Min</th>
                <th className="py-2 pr-3">Orders</th>
                <th className="py-2 pr-3 text-right">Ordered</th>
                <th className="py-2 pr-3 text-right">Allocated</th>
                <th className="py-2 pr-3 text-right">Unallocated</th>
                <th className="py-2 pr-3 text-right">Backorder</th>
                <th className="py-2 pr-3 text-right">Canceled</th>
                <th className="py-2 text-right">Suggest Buy</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className="py-3 text-slate-500" colSpan={11}>Tidak ada data SKU.</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.product_id} className="border-t border-slate-100">
                    <td className="py-2 pr-3 font-black text-slate-900">{row.sku || '-'}</td>
                    <td className="py-2 pr-3 text-slate-700">
                      <div className="font-bold text-slate-900">{row.name || '-'}</div>
                      <div className="text-[11px] text-slate-500">Status: {row.product_status || '-'}</div>
                    </td>
                    <td className="py-2 pr-3 font-bold text-slate-700">{formatQty(row.stock_quantity)}</td>
                    <td className="py-2 pr-3 font-bold text-slate-700">{formatQty(row.min_stock)}</td>
                    <td className="py-2 pr-3 font-bold text-slate-700">{formatQty(row.order_count)}</td>
                    <td className="py-2 pr-3 text-right font-black text-slate-900">{formatQty(row.ordered_net_qty)}</td>
                    <td className="py-2 pr-3 text-right font-black text-emerald-700">{formatQty(row.allocated_qty)}</td>
                    <td className="py-2 pr-3 text-right font-black text-indigo-700">{formatQty(row.unallocated_qty)}</td>
                    <td className="py-2 pr-3 text-right font-black text-amber-700">{formatQty(row.backorder_pending_qty)}</td>
                    <td className="py-2 pr-3 text-right font-black text-rose-700">{formatQty(row.canceled_qty)}</td>
                    <td className="py-2 text-right font-black text-slate-900">{formatQty(row.suggested_purchase_qty)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

