'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { getDefaultMonthRange, toNumber, toText } from '@/app/admin/finance/laporan/reportUtils';

type SupplierInvoiceRow = {
  id: number;
  invoice_number: string;
  status: 'unpaid' | 'paid' | 'overdue' | string;
  total: number | string;
  due_date: string;
  createdAt?: string;
  Supplier?: { id: number; name?: string | null } | null;
  PurchaseOrder?: { id: string; total_cost?: number | string; status?: string; createdAt?: string } | null;
  paid_total?: number;
  amount_due?: number;
};

export default function LaporanInvoiceSupplierPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_finance']);
  const defaults = useMemo(() => getDefaultMonthRange(), []);

  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [status, setStatus] = useState<'all' | 'unpaid' | 'paid' | 'overdue'>('all');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<SupplierInvoiceRow[]>([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.admin.finance.getSupplierInvoices({
        page: 1,
        limit: 200,
        status,
        startDate,
        endDate,
      });
      setRows(Array.isArray(res.data?.invoices) ? (res.data.invoices as SupplierInvoiceRow[]) : []);
    } catch (e) {
      console.error(e);
      alert('Gagal memuat invoice supplier');
    } finally {
      setLoading(false);
    }
  }, [endDate, startDate, status]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const summary = useMemo(() => {
    const total = rows.reduce((sum, row) => sum + toNumber(row.total), 0);
    const due = rows.reduce((sum, row) => sum + toNumber(row.amount_due), 0);
    const unpaidCount = rows.filter((row) => String(row.status) !== 'paid' && toNumber(row.amount_due) > 0).length;
    return { total, due, unpaidCount };
  }, [rows]);

  if (!allowed) return null;

  return (
    <div className="bg-slate-50 min-h-screen pb-10">
      <div className="bg-white px-6 py-4 shadow-sm sticky top-0 z-40">
        <div className="flex items-center gap-3 mb-4">
          <Link href="/admin/finance/laporan" className="p-2 -ml-2 rounded-full hover:bg-slate-100">
            <ArrowLeft size={20} className="text-slate-700" />
          </Link>
          <h1 className="font-bold text-lg text-slate-900">Invoice Supplier</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_220px_80px] gap-2 bg-slate-100 p-2 rounded-xl">
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
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
            className="bg-white border-none rounded-lg text-xs font-bold px-2 py-2"
          >
            <option value="all">Semua status</option>
            <option value="unpaid">Unpaid</option>
            <option value="overdue">Overdue</option>
            <option value="paid">Paid</option>
          </select>
          <button onClick={load} className="bg-slate-900 text-white rounded-lg text-xs font-bold">
            Go
          </button>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Total Invoice</p>
            <p className="text-2xl font-black text-slate-900">{formatCurrency(summary.total)}</p>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Outstanding (Sisa)</p>
            <p className="text-2xl font-black text-rose-700">{formatCurrency(summary.due)}</p>
          </div>
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500 mb-1 font-bold uppercase">Invoice Belum Lunas</p>
            <p className="text-2xl font-black text-slate-900">{summary.unpaidCount}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-black text-slate-900">Daftar Invoice</h2>
            <Link
              href="/admin/finance/laporan/bayar-supplier"
              className="text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50"
            >
              Bayar Supplier
            </Link>
          </div>

          {loading && <p className="text-sm text-slate-400">Loading...</p>}
          {!loading && rows.length === 0 && <p className="text-sm text-slate-400">Tidak ada invoice supplier pada periode ini.</p>}

          {!loading && rows.length > 0 && (
            <div className="space-y-2">
              {rows.map((row) => (
                <Link
                  key={row.id}
                  href={`/admin/finance/laporan/bayar-supplier?invoice=${row.id}`}
                  className="block rounded-xl border border-slate-200 bg-slate-50 p-3 hover:bg-slate-100"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-900 truncate">{toText(row.Supplier?.name, 'Supplier')}</p>
                      <p className="text-xs text-slate-600 truncate">
                        {toText(row.invoice_number)} • Due {toText(row.due_date)}
                        {row.PurchaseOrder?.id ? ` • PO ${toText(row.PurchaseOrder.id).slice(0, 8).toUpperCase()}` : ''}
                        {row.status ? ` • ${row.status}` : ''}
                      </p>
                      {row.createdAt ? <p className="text-[10px] text-slate-500">{formatDateTime(row.createdAt)}</p> : null}
                    </div>
                    <div className="text-right shrink-0 space-y-1">
                      <div>
                        <p className="text-[11px] text-slate-500">Total</p>
                        <p className="text-sm font-black text-slate-900">{formatCurrency(toNumber(row.total))}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-slate-500">Sisa</p>
                        <p className="text-sm font-black text-rose-700">{formatCurrency(toNumber(row.amount_due))}</p>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
