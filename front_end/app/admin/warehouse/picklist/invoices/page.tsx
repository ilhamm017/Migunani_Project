'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Printer, RefreshCw, Search } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

type BatchLayer = { unit_cost: number; qty_reserved: number };
type ProductRow = {
  product_id: string;
  sku: string;
  name: string;
  bin_location: string | null;
  invoice_count: number;
  order_count: number;
  total_qty: number;
  batch_layers: BatchLayer[];
};

type Payload = {
  status: string[];
  q: string;
  totals: { total_qty: number; product_count: number; invoice_count: number; order_count: number };
  rows: ProductRow[];
};

const toText = (v: unknown) => String(v ?? '').trim();
const toInt = (v: unknown) => Math.max(0, Math.trunc(Number(v ?? 0) || 0));

export default function WarehousePicklistProductsPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'checker_gudang'], '/admin');

  const [q, setQ] = useState('');
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.invoices.getWarehousePicklist({
        status: 'ready_to_ship,checked',
        q: q.trim() || undefined,
        limit: 20000,
      });
      const payload = (res.data || null) as Payload | null;
      if (!payload || !Array.isArray(payload.rows)) {
        setData(null);
        setError('Respon picklist gudang tidak valid.');
        return;
      }
      setData(payload);
    } catch (e: unknown) {
      setData(null);
      const message = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(message || 'Gagal memuat picklist gudang.');
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    if (!allowed) return;
    void load();
  }, [allowed, load]);

  const handleDownload = useCallback(async () => {
    try {
      setDownloading(true);
      const res = await api.invoices.downloadWarehousePicklistXlsx({
        status: 'ready_to_ship,checked',
        q: q.trim() || undefined,
        limit: 20000,
      });
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `picklist-gudang${q.trim() ? `-${q.trim().replace(/[^a-z0-9_-]/gi, '_')}` : ''}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(message || 'Gagal download XLSX picklist gudang.');
    } finally {
      setDownloading(false);
    }
  }, [q]);

  const rows = useMemo(() => (Array.isArray(data?.rows) ? data!.rows : []), [data]);
  const totals = data?.totals || { total_qty: 0, product_count: 0, invoice_count: 0, order_count: 0 };

  if (!allowed) return null;

  return (
    <div className="warehouse-screen warehouse-screen-fill warehouse-screen-flush-bottom flex min-h-0 flex-col overflow-hidden bg-slate-50">
      <div className="warehouse-panel bg-white px-4 md:px-6 py-4 flex flex-col gap-3 border-b border-slate-200">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Gudang</p>
            <h2 className="text-xl md:text-2xl font-black text-slate-900 leading-tight">Picklist Barang (Global)</h2>
            <p className="text-xs text-slate-500 mt-1">
              Langsung daftar barang yang harus diambil untuk semua invoice status <span className="font-bold">ready_to_ship</span> / <span className="font-bold">checked</span>.
            </p>
            <Link
              href="/admin/warehouse/picklist/invoices-by-invoice"
              className="mt-2 inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
            >
              Lihat Per Invoice
            </Link>
          </div>
          <div className="shrink-0 flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
            >
              <Printer size={14} />
              Print
            </button>
            <button
              type="button"
              onClick={() => void handleDownload()}
              disabled={downloading || loading}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 text-white px-3 py-2 text-xs font-black disabled:opacity-60"
            >
              <Download size={14} />
              {downloading ? 'Menyiapkan...' : 'XLSX'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Total Qty</p>
            <p className="text-lg font-black text-slate-900">{toInt(totals.total_qty)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Produk</p>
            <p className="text-lg font-black text-slate-900">{toInt(totals.product_count)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Invoice</p>
            <p className="text-lg font-black text-slate-900">{toInt(totals.invoice_count)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Order</p>
            <p className="text-lg font-black text-slate-900">{toInt(totals.order_count)}</p>
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
                placeholder="SKU / nama / bin / product_id"
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
            Memuat picklist...
          </div>
        ) : error ? (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-sm font-bold text-rose-700">
            {error}
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 text-sm text-slate-500">
            Tidak ada item untuk dipicking.
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left text-[11px] font-black uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">Bin</th>
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3">Produk</th>
                    <th className="px-4 py-3">Batch (HPP)</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3 text-right">Invoice</th>
                    <th className="px-4 py-3 text-right">Order</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.product_id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <span className="font-mono font-black text-emerald-700">{toText(row.bin_location) || '—'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[11px] font-mono font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded">
                          {toText(row.sku) || row.product_id}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-black text-slate-900">{toText(row.name) || 'Produk'}</p>
                        <p className="text-[11px] text-slate-500">{row.product_id}</p>
                      </td>
                      <td className="px-4 py-3">
                        {Array.isArray(row.batch_layers) && row.batch_layers.length > 0 ? (
                          <p className="text-[11px] font-bold text-slate-700">
                            {row.batch_layers
                              .filter((l) => Number(l?.qty_reserved || 0) > 0)
                              .map((l) => `${formatCurrency(Number(l.unit_cost || 0))} × ${toInt(l.qty_reserved)}`)
                              .join(' • ')}
                          </p>
                        ) : (
                          <p className="text-[11px] text-slate-500">FIFO (auto)</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-base font-black text-slate-900">{toInt(row.total_qty)}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-black text-slate-900">{toInt(row.invoice_count)}</td>
                      <td className="px-4 py-3 text-right font-black text-slate-900">{toInt(row.order_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
