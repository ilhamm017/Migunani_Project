'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { ArRow, paymentMethodLabel, paymentStatusLabel, sourceLabel } from '@/app/admin/finance/piutang/arShared';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';

export default function AdminInvoicesPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir', 'admin_finance']);
  const [rows, setRows] = useState<ArRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const loadRows = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.admin.finance.getAR();
      setRows(Array.isArray(res.data) ? (res.data as ArRow[]) : []);
    } catch (error) {
      console.error('Failed to load invoices:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void loadRows();
  }, [allowed, loadRows]);

  useRealtimeRefresh({
    enabled: allowed,
    onRefresh: loadRows,
    domains: ['order', 'retur', 'cod', 'admin'],
    pollIntervalMs: 30000,
  });

  const filteredRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => {
      const invoiceNumber = String(row.invoice_number || '').toLowerCase();
      const customerName = String(row.order?.customer_name || '').toLowerCase();
      const orderId = String(row.order?.id || '').toLowerCase();
      return invoiceNumber.includes(term) || customerName.includes(term) || orderId.includes(term);
    });
  }, [rows, query]);

  if (!allowed) return null;

  const totalDue = filteredRows.reduce((sum, row) => sum + Number(row.amount_due || 0), 0);

  return (
    <div className="p-6 space-y-5">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
        <h1 className="text-xl font-black text-slate-900">Invoice Customer</h1>
        <p className="text-xs text-slate-600">
          Menampilkan invoice customer yang masih berjalan (belum lunas atau COD pending).
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          <div className="bg-rose-50 border border-rose-100 rounded-xl p-3">
            <p className="text-[11px] font-bold text-rose-700 uppercase">Total Tagihan</p>
            <p className="text-lg font-black text-rose-800">{formatCurrency(totalDue)}</p>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <p className="text-[11px] font-bold text-slate-600 uppercase">Invoice Aktif</p>
            <p className="text-lg font-black text-slate-900">{filteredRows.length}</p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-black text-slate-900">Daftar Invoice</h2>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari invoice, order, customer"
            className="w-full sm:w-64 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
          />
        </div>
        {loading && <p className="text-sm text-slate-500">Memuat invoice...</p>}
        {!loading && filteredRows.length === 0 && <p className="text-sm text-slate-500">Tidak ada invoice aktif.</p>}
        {!loading && filteredRows.length > 0 && (
          <div className="space-y-2">
            {filteredRows.map((row) => (
              <div
                key={row.id}
                className="block w-full text-left border rounded-xl p-3 transition-colors bg-slate-50 border-slate-200 hover:bg-slate-100"
              >
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/admin/finance/piutang/${row.id}`} className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-900 truncate">{row.order?.customer_name || '-'}</p>
                    <p className="text-xs text-slate-600 truncate">
                      {row.invoice_number} • Order {row.order?.id || '-'} • {sourceLabel(row.order?.source)}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      {paymentMethodLabel(row.payment_method)} • {paymentStatusLabel(row.payment_status)}
                      {row.createdAt ? ` • ${formatDateTime(row.createdAt)}` : ''}
                    </p>
                  </Link>
                  <div className="text-right shrink-0 space-y-2">
                    <div>
                      <p className="text-[11px] text-slate-500">Sisa</p>
                      <p className="text-sm font-black text-rose-700">{formatCurrency(Number(row.amount_due || 0))}</p>
                    </div>
                    <Link
                      href={`/invoices/${row.id}/print`}
                      className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1 text-[10px] font-bold text-slate-700 hover:bg-slate-100"
                    >
                      Cetak
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
