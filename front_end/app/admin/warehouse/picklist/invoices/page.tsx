'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, RefreshCw, Search } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';

type QueueRow = {
  id: string;
  invoice_number: string;
  shipment_status: string;
  courier_id: string | null;
  payment_method: string;
  payment_status: string;
  createdAt: string | null;
  total_qty: number;
  product_count: number;
  order_count: number;
};

type QueuePayload = {
  rows: QueueRow[];
};

const toText = (v: unknown) => String(v ?? '').trim();
const toInt = (v: unknown) => Math.max(0, Math.trunc(Number(v ?? 0) || 0));

export default function WarehouseInvoiceQueuePicklistPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'checker_gudang'], '/admin');

  const [q, setQ] = useState('');
  const [data, setData] = useState<QueuePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    try {
      if (!silent) setLoading(true);
      setError('');
      const res = await api.invoices.getWarehouseQueue({
        status: 'ready_to_ship,checked',
        q: q.trim() || undefined,
        limit: 200,
      });
      const payload = (res.data || null) as QueuePayload | null;
      if (!payload || !Array.isArray(payload.rows)) {
        setData(null);
        setError('Respon queue invoice tidak valid.');
        return;
      }
      setData(payload);
    } catch (e: unknown) {
      setData(null);
      const message = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(message || 'Gagal memuat queue invoice gudang.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    if (!allowed) return;
    void load();
  }, [allowed, load]);

  const rows = useMemo(() => (Array.isArray(data?.rows) ? data!.rows : []), [data]);
  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.invoice += 1;
        acc.qty += toInt(row.total_qty);
        acc.products += toInt(row.product_count);
        acc.orders += toInt(row.order_count);
        return acc;
      },
      { invoice: 0, qty: 0, products: 0, orders: 0 }
    );
  }, [rows]);

  if (!allowed) return null;

  return (
    <div className="warehouse-screen warehouse-screen-fill warehouse-screen-flush-bottom flex min-h-0 flex-col overflow-hidden bg-slate-50">
      <div className="warehouse-panel bg-white px-4 md:px-6 py-4 flex flex-col gap-3 border-b border-slate-200">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Gudang</p>
            <h2 className="text-xl md:text-2xl font-black text-slate-900 leading-tight">Queue Picklist Invoice</h2>
            <p className="text-xs text-slate-500 mt-1">
              Daftar seluruh invoice yang masih perlu diproses gudang (ready_to_ship / checked).
            </p>
          </div>
          <div className="shrink-0 flex gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Invoice</p>
            <p className="text-lg font-black text-slate-900">{totals.invoice}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Total Qty</p>
            <p className="text-lg font-black text-slate-900">{totals.qty}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Produk</p>
            <p className="text-lg font-black text-slate-900">{totals.products}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Order</p>
            <p className="text-lg font-black text-slate-900">{totals.orders}</p>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-2 md:items-end">
          <div className="flex-1">
            <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Cari</p>
            <div className="mt-1 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <Search size={14} className="text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Invoice number..."
                className="w-full bg-transparent text-sm font-bold text-slate-800 outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void load();
                  }
                }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white"
          >
            <RefreshCw size={14} />
            Terapkan
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-4">
        {loading ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 text-sm text-slate-500">
            Memuat queue...
          </div>
        ) : error ? (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-sm font-bold text-rose-700">
            {error}
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 text-sm text-slate-500">
            Tidak ada invoice untuk diproses.
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-[11px] font-black uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Invoice</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Produk</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3 text-right">Order</th>
                    <th className="px-4 py-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => {
                    const invoiceId = toText(row.id);
                    const picklistHref = `/admin/warehouse/picklist/invoice/${encodeURIComponent(invoiceId)}`;
                    return (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="text-sm font-black text-slate-900">{toText(row.invoice_number) || '-'}</p>
                          <p className="text-[11px] text-slate-500 font-mono">{invoiceId}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-700">
                            {toText(row.shipment_status) || '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-black text-slate-900">{toInt(row.product_count)}</td>
                        <td className="px-4 py-3 text-right font-black text-slate-900">{toInt(row.total_qty)}</td>
                        <td className="px-4 py-3 text-right font-black text-slate-900">{toInt(row.order_count)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              href={picklistHref}
                              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                            >
                              <ExternalLink size={14} />
                              Picklist
                            </Link>
                            <Link
                              href={`/admin/orders/${encodeURIComponent(invoiceId)}`}
                              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
                            >
                              Detail
                            </Link>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  const res = await api.invoices.downloadPicklistXlsx(invoiceId);
                                  const blob = new Blob([res.data], {
                                    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                                  });
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement('a');
                                  a.href = url;
                                  a.download = `picklist-${toText(row.invoice_number || invoiceId) || 'invoice'}.xlsx`;
                                  document.body.appendChild(a);
                                  a.click();
                                  a.remove();
                                  URL.revokeObjectURL(url);
                                } catch (e: unknown) {
                                  const message = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
                                  setError(message || 'Gagal download XLSX picklist.');
                                }
                              }}
                              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white"
                            >
                              <Download size={14} />
                              XLSX
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
