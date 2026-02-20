'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CreditCard, Receipt, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';

type InvoiceRow = {
  id: string;
  invoice_number: string;
  payment_status: string;
  payment_method: string;
  total: number;
  createdAt?: string;
  orderIds: string[];
};

const paymentMethodLabel = (method?: string) => {
  if (method === 'transfer_manual') return 'Transfer Manual';
  if (method === 'cod') return 'COD';
  if (method === 'cash_store') return 'Tunai Toko';
  return method || '-';
};

const paymentStatusLabel = (status?: string) => {
  if (status === 'unpaid') return 'Belum Lunas';
  if (status === 'cod_pending') return 'COD Pending';
  if (status === 'paid') return 'Lunas';
  return status || '-';
};

export default function CustomerInvoicesPage() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    if (!isAuthenticated) {
      setRows([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const res = await api.orders.getMyOrders({ page: 1, limit: 200 });
      const orders = res.data?.orders || [];
      const invoiceMap = new Map<string, InvoiceRow>();
      orders.forEach((order: any) => {
        const invoices = Array.isArray(order?.Invoices) && order.Invoices.length > 0
          ? order.Invoices
          : order?.Invoice
            ? [order.Invoice]
            : [];
        invoices.forEach((invoice: any) => {
          const id = String(invoice?.id || '');
          if (!id) return;
          const existing: InvoiceRow = invoiceMap.get(id) || {
            id,
            invoice_number: String(invoice?.invoice_number || id),
            payment_status: String(invoice?.payment_status || ''),
            payment_method: String(invoice?.payment_method || ''),
            total: Number(invoice?.total || 0),
            createdAt: invoice?.createdAt || invoice?.created_at,
            orderIds: []
          };
          if (!existing.orderIds.includes(String(order.id))) {
            existing.orderIds.push(String(order.id));
          }
          invoiceMap.set(id, existing);
        });
      });
      const unpaid = Array.from(invoiceMap.values()).filter((inv) => String(inv.payment_status || '') !== 'paid');
      setRows(unpaid.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
    } catch (error) {
      console.error('Failed to load invoices:', error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeRefresh({
    enabled: isAuthenticated,
    onRefresh: load,
    domains: ['order', 'retur', 'admin'],
    pollIntervalMs: 20000,
  });

  const filteredRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => {
      const invoiceNumber = String(row.invoice_number || '').toLowerCase();
      const orders = row.orderIds.join(',').toLowerCase();
      return invoiceNumber.includes(term) || orders.includes(term);
    });
  }, [rows, query]);

  const invoiceOrderLookup = useMemo(() => {
    const map = new Map<string, string[]>();
    rows.forEach((row) => {
      map.set(String(row.id), row.orderIds || []);
    });
    return map;
  }, [rows]);

  const totalDue = filteredRows.reduce((sum, row) => sum + Number(row.total || 0), 0);

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6">
          <CreditCard size={40} className="text-slate-300" />
        </div>
        <h2 className="text-xl font-black text-slate-800 mb-2">Login Diperlukan</h2>
        <p className="text-slate-500 mb-6 max-w-xs">Silakan login untuk melihat invoice dan tagihan Anda.</p>
        <Link href="/auth/login" className="w-full max-w-xs bg-emerald-600 text-white py-4 rounded-2xl font-black text-sm uppercase tracking-wider shadow-lg shadow-emerald-100">
          Login Sekarang
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white pb-24">
      <div className="p-6 space-y-5">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-slate-600">
            <Receipt size={20} />
          </div>
          <div>
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Invoice Saya</h3>
            <h1 className="text-xl font-black text-slate-900">Tagihan Customer</h1>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
            <div className="flex items-center gap-2">
              <Search size={14} className="text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari invoice / order"
                className="w-full sm:w-64 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
              />
            </div>
          </div>

          {loading && <p className="text-sm text-slate-500">Memuat invoice...</p>}
          {!loading && filteredRows.length === 0 && (
            <div className="text-sm text-slate-500">Belum ada invoice aktif.</div>
          )}
          {!loading && filteredRows.length > 0 && (
            <div className="space-y-2">
              {filteredRows.map((row) => (
                <Link
                  key={row.id}
                  href={`/invoices/${row.id}`}
                  className="block border border-slate-200 rounded-2xl p-4 bg-slate-50 hover:bg-slate-100 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 truncate">{row.invoice_number}</p>
                      <p className="text-xs text-slate-600 truncate">
                        Order: {row.orderIds.join(', ')}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {paymentMethodLabel(row.payment_method)} • {paymentStatusLabel(row.payment_status)}
                        {row.createdAt ? ` • ${formatDateTime(row.createdAt)}` : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[11px] text-slate-500">Tagihan</p>
                      <p className="text-sm font-black text-rose-700">{formatCurrency(Number(row.total || 0))}</p>
                    </div>
                  </div>
                  <div className="mt-3 text-[10px] text-slate-500">
                    Pembayaran akan dilakukan melalui driver saat pengantaran atau sesuai metode yang disepakati.
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
