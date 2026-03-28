'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Printer, RefreshCw } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';

type PicklistRow = {
  product_id: string;
  sku: string;
  name: string;
  bin_location: string | null;
  total_qty: number;
};

type PicklistPayload = {
  invoice_id: string;
  invoice_number: string;
  createdAt?: string | null;
  shipment_status?: string;
  totals?: {
    product_count?: number;
    total_qty?: number;
  };
  rows: PicklistRow[];
};

const toText = (v: unknown) => String(v ?? '').trim();
const toInt = (v: unknown) => Math.max(0, Math.trunc(Number(v ?? 0) || 0));

export default function InvoicePicklistPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'checker_gudang'], '/admin');
  const params = useParams();
  const invoiceId = useMemo(() => toText(params?.invoiceId), [params]);

  const [data, setData] = useState<PicklistPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!invoiceId) return;
    try {
      setLoading(true);
      setError('');
      const res = await api.invoices.getPicklist(invoiceId);
      const payload = (res.data || null) as PicklistPayload | null;
      if (!payload || !Array.isArray(payload.rows)) {
        setData(null);
        setError('Respon picklist tidak valid.');
        return;
      }
      setData(payload);
    } catch (e: unknown) {
      setData(null);
      const message = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(message || 'Gagal memuat picklist invoice.');
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    if (!allowed) return;
    void load();
  }, [allowed, load]);

  const handleDownload = useCallback(async () => {
    if (!invoiceId) return;
    try {
      setDownloading(true);
      const res = await api.invoices.downloadPicklistXlsx(invoiceId);
      const blob = new Blob([res.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const invoiceNumber = toText(data?.invoice_number || data?.invoice_id || invoiceId) || 'invoice';
      a.href = url;
      a.download = `picklist-${invoiceNumber}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(message || 'Gagal download XLSX picklist.');
    } finally {
      setDownloading(false);
    }
  }, [data?.invoice_id, data?.invoice_number, invoiceId]);

  if (!allowed) return null;

  const rows = Array.isArray(data?.rows) ? data!.rows : [];
  const totals = data?.totals || {};
  const invoiceNumber = toText(data?.invoice_number) || '-';

  return (
    <div className="warehouse-screen warehouse-screen-fill warehouse-screen-flush-bottom flex min-h-0 flex-col overflow-hidden bg-slate-50">
      <div className="warehouse-panel bg-white px-4 md:px-6 py-4 flex flex-col gap-2 border-b border-slate-200">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Gudang</p>
            <h2 className="text-xl md:text-2xl font-black text-slate-900 leading-tight">Picklist Invoice</h2>
            <p className="text-xs text-slate-500 mt-1">
              Fokus ambil barang: total qty per produk (tanpa detail customer).
            </p>
            <p className="text-[11px] text-slate-500 mt-1">
              Invoice: <span className="font-black text-slate-800">{invoiceNumber}</span>
            </p>
          </div>
          <div className="shrink-0 flex flex-col sm:flex-row gap-2">
            <Link
              href={`/admin/orders/${encodeURIComponent(invoiceId)}`}
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
            >
              Kembali
            </Link>
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
              disabled={downloading || !data}
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
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Invoice ID</p>
            <p className="text-[11px] font-mono font-black text-slate-800 truncate">{toText(data?.invoice_id || invoiceId) || '-'}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Shipment</p>
            <p className="text-sm font-black text-slate-900">{toText(data?.shipment_status) || '-'}</p>
          </div>
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
            Tidak ada item picklist.
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
                    <th className="px-4 py-3 text-right">Qty</th>
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
                      <td className="px-4 py-3 text-right">
                        <span className="text-base font-black text-slate-900">{toInt(row.total_qty)}</span>
                      </td>
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

