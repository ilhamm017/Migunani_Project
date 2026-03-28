'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { getDefaultMonthRange, toNumber, toText } from '@/app/admin/finance/laporan/reportUtils';
import { notifyAlert } from '@/lib/notify';

type TopCustomerRow = {
  customer_id?: string;
  customer_name?: string | null;
  whatsapp_number?: string | null;
  revenue?: number | string | null;
  order_count?: number | string | null;
  qty_total?: number | string | null;
  tx_invoice?: number | string | null;
  tx_pos?: number | string | null;
  first_bought_at?: string | null;
  last_bought_at?: string | null;
};

export default function LaporanCustomerLoyalPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_finance', 'kasir']);
  const defaults = useMemo(() => getDefaultMonthRange(), []);

  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [rows, setRows] = useState<TopCustomerRow[]>([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.admin.finance.getTopCustomersReport({ startDate, endDate, limit });
      setRows(Array.isArray(res.data?.rows) ? (res.data.rows as TopCustomerRow[]) : []);
    } catch (e) {
      console.error(e);
      notifyAlert('Gagal memuat laporan customer loyal');
    } finally {
      setLoading(false);
    }
  }, [endDate, limit, startDate]);

  const handleExport = useCallback(async () => {
    try {
      setExporting(true);
      const res = await api.admin.finance.exportTopCustomersReport({ startDate, endDate, limit });
      const contentDisposition = String(res.headers?.['content-disposition'] || '');
      const fileNameMatch = contentDisposition.match(/filename="([^"]+)"/i);
      const fileName = fileNameMatch?.[1] || `laporan-customer-loyal-${startDate}-${endDate}.xlsx`;

      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      notifyAlert('Gagal export Excel');
    } finally {
      setExporting(false);
    }
  }, [endDate, limit, startDate]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const summary = useMemo(() => {
    const revenue = rows.reduce((sum, row) => sum + toNumber(row.revenue), 0);
    const orderCount = rows.reduce((sum, row) => sum + toNumber(row.order_count), 0);
    const qtyTotal = rows.reduce((sum, row) => sum + toNumber(row.qty_total), 0);
    return { revenue, orderCount, qtyTotal, customers: rows.length };
  }, [rows]);

  const maxOrderCount = useMemo(() => {
    const max = rows.reduce((m, row) => Math.max(m, toNumber(row.order_count)), 0);
    return Math.max(max, 1);
  }, [rows]);

  if (!allowed) return null;

  return (
    <div className="bg-slate-50 min-h-screen pb-10">
      <div className="bg-white px-6 py-4 shadow-sm sticky top-0 z-40">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/admin/finance/laporan" className="p-2 -ml-2 rounded-full hover:bg-slate-100">
            <ArrowLeft size={20} className="text-slate-700" />
          </Link>
          <h1 className="font-bold text-lg text-slate-900">Laporan Customer Loyal</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_120px_80px] gap-2 bg-slate-100 p-2 rounded-xl">
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
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="bg-white border-none rounded-lg text-xs font-bold px-2 py-2 text-center"
          >
            <option value={10}>Top 10</option>
            <option value={20}>Top 20</option>
            <option value={50}>Top 50</option>
            <option value={100}>Top 100</option>
          </select>
          <button onClick={load} className="bg-slate-900 text-white rounded-lg text-xs font-bold">
            Go
          </button>
        </div>
        <div className="flex items-center justify-end mt-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || loading}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-white disabled:opacity-60"
          >
            <Download size={14} />
            {exporting ? 'Exporting...' : 'Export Excel'}
          </button>
        </div>
        <p className="text-[10px] text-slate-500 mt-2">
          Urutan: transaksi terbanyak → omzet terbesar → pembelian terbaru. Sumber data: invoice <span className="font-bold">paid</span> (verified_at) + POS <span className="font-bold">paid</span> (paid_at) pada periode.
        </p>
      </div>

      <div className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Omzet (Top {limit})</p>
            <p className="text-2xl font-black text-slate-900">{formatCurrency(summary.revenue)}</p>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Transaksi (Top {limit})</p>
            <p className="text-2xl font-black text-slate-900">{summary.orderCount}</p>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Qty Total (Top {limit})</p>
            <p className="text-2xl font-black text-slate-900">{summary.qtyTotal}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black text-slate-900">Ranking Customer Loyal</h2>
            <div className="text-xs text-slate-500">
              Customer: <span className="font-bold text-slate-700">{summary.customers}</span>
            </div>
          </div>

          {loading && <p className="text-sm text-slate-400">Loading...</p>}
          {!loading && rows.length === 0 && <p className="text-sm text-slate-400">Tidak ada data pada periode ini.</p>}

          {!loading && rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-2 pr-4 font-black uppercase tracking-widest">#</th>
                    <th className="py-2 pr-4 font-black uppercase tracking-widest">Customer</th>
                    <th className="py-2 pr-4 font-black uppercase tracking-widest text-right">Tx</th>
                    <th className="py-2 pr-4 font-black uppercase tracking-widest text-right">Qty</th>
                    <th className="py-2 pr-4 font-black uppercase tracking-widest text-right">Omzet</th>
                    <th className="py-2 pr-4 font-black uppercase tracking-widest">Last</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => {
                    const customerId = toText(row.customer_id);
                    const tx = toNumber(row.order_count);
                    const barWidth = Math.min(100, (tx / maxOrderCount) * 100);
                    return (
                      <tr key={toText(row.customer_id, String(idx))} className="border-t border-slate-100">
                        <td className="py-2 pr-4 font-black text-slate-700">{idx + 1}</td>
                        <td className="py-2 pr-4">
                          <Link
                            href={customerId ? `/admin/sales/${customerId}` : '#'}
                            className="font-bold text-slate-900 hover:underline"
                          >
                            {toText(row.customer_name, customerId || '-')}
                          </Link>
                          <p className="text-[10px] text-slate-500">{toText(row.whatsapp_number, '-')}</p>
                          <div className="mt-1 h-2 w-full rounded-full bg-slate-100">
                            <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${barWidth}%` }} />
                          </div>
                        </td>
                        <td className="py-2 pr-4 text-right font-black text-slate-900">{tx}</td>
                        <td className="py-2 pr-4 text-right font-black text-slate-900">{toNumber(row.qty_total)}</td>
                        <td className="py-2 pr-4 text-right font-black text-slate-900">{formatCurrency(toNumber(row.revenue))}</td>
                        <td className="py-2 pr-4 font-bold text-slate-700">{formatDateTime(row.last_bought_at || null)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

