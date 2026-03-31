'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, RefreshCw } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import type { AdminOrderMonitoringResponse } from '@/lib/apiTypes';
import { formatDateTime } from '@/lib/utils';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';

type Scope = 'active' | 'all';

const formatQty = (value: unknown): string => {
  const n = Number(value || 0);
  const safe = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(safe);
};

export default function AdminOrdersMonitoringPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'checker_gudang', 'admin_finance', 'kasir']);
  const [scope, setScope] = useState<Scope>('active');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AdminOrderMonitoringResponse | null>(null);
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
      const res = await api.admin.orderManagement.getMonitoring({
        scope,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        limitTop: 20,
      });
      setData(res?.data || null);
      setLastUpdatedAt(new Date().toISOString());
    } catch (error) {
      console.error('Failed to load order monitoring summary:', error);
      if (!silent) setData(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [endDate, scope, startDate]);

  useEffect(() => {
    if (!allowed) return;
    if (dateRangeError) return;
    const timer = setTimeout(() => {
      void load();
    }, 250);
    return () => clearTimeout(timer);
  }, [allowed, dateRangeError, load]);

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

  const quantities = data?.quantities || { ordered_net: 0, allocated: 0, backorder_pending: 0, canceled: 0 };
  const orderedNet = Math.max(0, Number(quantities.ordered_net || 0));
  const allocated = Math.max(0, Number(quantities.allocated || 0));
  const allocPct = orderedNet > 0 ? Math.round((allocated / orderedNet) * 100) : 0;

  const statusChips = useMemo(() => {
    const entries = Object.entries(data?.orders?.by_status || {});
    return entries
      .map(([statusKey, count]) => ({ statusKey, count: Number(count || 0) }))
      .filter((row) => row.statusKey && row.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [data?.orders?.by_status]);

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">Order Command</p>
          <h1 className="text-xl font-black text-slate-900">Monitoring Order (Qty)</h1>
          <p className="text-sm text-slate-600">Ringkasan total qty: dialokasikan, backorder, dan dicancel.</p>
          <p className="mt-1 text-[11px] text-slate-500">Last updated: {lastUpdatedAt ? formatDateTime(lastUpdatedAt) : '-'}</p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/admin/orders"
            className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 hover:border-emerald-300"
          >
            Kembali ke Orders
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
          <BarChart3 size={16} className="text-slate-400" />
          <p className="text-xs text-slate-600">Filter monitoring</p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
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
        </div>

        {dateRangeError && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
            {dateRangeError}
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Ordered (Net)</p>
          <p className="mt-2 text-2xl font-black text-slate-900">{formatQty(quantities.ordered_net)}</p>
          <p className="mt-1 text-[11px] font-semibold text-slate-500">Total qty item (setelah cancel)</p>
        </div>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Dialokasikan</p>
          <p className="mt-2 text-2xl font-black text-emerald-900">{formatQty(quantities.allocated)}</p>
          <p className="mt-1 text-[11px] font-semibold text-emerald-700">Coverage {allocPct}%</p>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Backorder Pending</p>
          <p className="mt-2 text-2xl font-black text-amber-900">{formatQty(quantities.backorder_pending)}</p>
          <p className="mt-1 text-[11px] font-semibold text-amber-700">Total qty backorder yang belum terpenuhi</p>
        </div>

        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">Dicancel</p>
          <p className="mt-2 text-2xl font-black text-rose-900">{formatQty(quantities.canceled)}</p>
          <p className="mt-1 text-[11px] font-semibold text-rose-700">Manual + cancel backorder</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Top Backorder Orders</p>
              <p className="text-xs text-slate-600">Order dengan qty backorder terbesar.</p>
            </div>
          </div>

          <div className="mt-3 overflow-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] font-black text-slate-500">
                  <th className="py-2 pr-3">Order</th>
                  <th className="py-2 pr-3">Customer</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Tanggal</th>
                  <th className="py-2 text-right">Qty Pending</th>
                </tr>
              </thead>
              <tbody>
                {(data?.top?.backorder_orders || []).length === 0 ? (
                  <tr>
                    <td className="py-3 text-slate-500" colSpan={5}>Tidak ada data backorder.</td>
                  </tr>
                ) : (
                  (data?.top?.backorder_orders || []).map((row) => (
                    <tr key={row.order_id} className="border-t border-slate-100">
                      <td className="py-2 pr-3 font-bold text-slate-900">
                        <Link className="hover:underline" href={`/admin/orders/detail/${encodeURIComponent(row.order_id)}`}>
                          {row.order_id}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-slate-700">{row.customer_name || '-'}</td>
                      <td className="py-2 pr-3 text-slate-700">{row.status || '-'}</td>
                      <td className="py-2 pr-3 text-slate-600">{formatDateTime(row.createdAt)}</td>
                      <td className="py-2 text-right font-black text-amber-700">{formatQty(row.qty_pending)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Top Canceled Orders</p>
              <p className="text-xs text-slate-600">Order dengan qty cancel terbesar.</p>
            </div>
          </div>

          <div className="mt-3 overflow-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] font-black text-slate-500">
                  <th className="py-2 pr-3">Order</th>
                  <th className="py-2 pr-3">Customer</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Tanggal</th>
                  <th className="py-2 text-right">Qty Canceled</th>
                </tr>
              </thead>
              <tbody>
                {(data?.top?.canceled_orders || []).length === 0 ? (
                  <tr>
                    <td className="py-3 text-slate-500" colSpan={5}>Tidak ada data cancel.</td>
                  </tr>
                ) : (
                  (data?.top?.canceled_orders || []).map((row) => (
                    <tr key={row.order_id} className="border-t border-slate-100">
                      <td className="py-2 pr-3 font-bold text-slate-900">
                        <Link className="hover:underline" href={`/admin/orders/detail/${encodeURIComponent(row.order_id)}`}>
                          {row.order_id}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-slate-700">{row.customer_name || '-'}</td>
                      <td className="py-2 pr-3 text-slate-700">{row.status || '-'}</td>
                      <td className="py-2 pr-3 text-slate-600">{formatDateTime(row.createdAt)}</td>
                      <td className="py-2 text-right font-black text-rose-700">{formatQty(row.qty_canceled)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Distribusi Status (Order Count)</p>
        <p className="mt-1 text-xs text-slate-600">Konteks jumlah order per status di scope yang dipilih.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {statusChips.length === 0 ? (
            <span className="text-xs text-slate-500">Tidak ada data status.</span>
          ) : (
            statusChips.map((row) => (
              <span
                key={row.statusKey}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-black text-slate-700"
              >
                {row.statusKey} {formatQty(row.count)}
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
