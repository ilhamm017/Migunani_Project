'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import CustomerPurchaseHistoryPanel from '@/components/admin/sales/CustomerPurchaseHistoryPanel';

type CustomerSearchRow = {
  id: string;
  name?: string;
  whatsapp_number?: string;
  email?: string | null;
};

function AdminCustomerPurchasesPageContent() {
  const allowed = useRequireRoles(['super_admin', 'kasir', 'admin_finance', 'admin_gudang']);
  const searchParams = useSearchParams();
  const queryCustomerId = String(searchParams.get('customerId') || '').trim();
  const queryCustomerName = String(searchParams.get('customerName') || '').trim();
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<CustomerSearchRow[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchRow | null>(null);
  const [loadingCustomers, setLoadingCustomers] = useState(false);

  useEffect(() => {
    if (!allowed || !queryCustomerId) return;
    setSelectedCustomer((current) => {
      if (current?.id === queryCustomerId) return current;
      return {
        id: queryCustomerId,
        name: queryCustomerName || 'Customer',
      };
    });
  }, [allowed, queryCustomerId, queryCustomerName]);

  useEffect(() => {
    if (!allowed) return;
    const trimmed = customerQuery.trim();
    if (trimmed.length < 2) {
      setCustomerResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        setLoadingCustomers(true);
        const res = await api.admin.customers.search(trimmed, { status: 'all', limit: 12 });
        const rows = Array.isArray(res.data?.customers) ? res.data.customers as CustomerSearchRow[] : [];
        setCustomerResults(rows);
      } catch (error) {
        console.error('Failed to search customers for purchase report:', error);
        setCustomerResults([]);
      } finally {
        setLoadingCustomers(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [allowed, customerQuery]);

  if (!allowed) return null;

  return (
    <div className="p-4 sm:p-6 pb-24 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] mb-1">Sales Insight</p>
          <h1 className="text-2xl font-black text-slate-900 leading-none">Belanja Customer</h1>
          <p className="text-xs text-slate-500 mt-2">Pilih customer, lalu lihat barang yang dibeli dalam rentang waktu tertentu.</p>
        </div>
        <Link href="/admin" className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[11px] font-black uppercase tracking-wide text-slate-700">
          Kembali
        </Link>
      </div>

      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Cari Customer</p>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={customerQuery}
            onChange={(event) => setCustomerQuery(event.target.value)}
            placeholder="Ketik nama, WA, atau email"
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm text-slate-700 outline-none transition focus:border-emerald-300 focus:bg-white"
          />
        </div>

        <div className="space-y-2 max-h-[280px] overflow-y-auto">
          {selectedCustomer?.id && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">Customer Aktif</p>
              <p className="mt-1 text-sm font-black text-emerald-900">{selectedCustomer.name || 'Customer'}</p>
            </div>
          )}
          {loadingCustomers && <p className="text-xs text-slate-400">Mencari customer...</p>}
          {!loadingCustomers && customerResults.length === 0 && customerQuery.trim().length >= 2 && (
            <p className="text-xs text-slate-400">Tidak ada customer yang cocok.</p>
          )}
          {customerResults.map((customer) => (
            <button
              key={customer.id}
              type="button"
              onClick={() => setSelectedCustomer(customer)}
              className={`w-full rounded-2xl border px-4 py-3 text-left transition ${selectedCustomer?.id === customer.id ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white hover:border-emerald-200 hover:bg-slate-50'}`}
            >
              <p className="text-sm font-black text-slate-900">{customer.name || 'Customer'}</p>
              <p className="text-[11px] text-slate-500 mt-1">{customer.whatsapp_number || customer.email || '-'}</p>
            </button>
          ))}
        </div>
      </div>

      <CustomerPurchaseHistoryPanel
        customerId={selectedCustomer?.id}
        customerName={selectedCustomer?.name}
      />
    </div>
  );
}

export default function AdminCustomerPurchasesPage() {
  return (
    <Suspense fallback={<div className="p-4 sm:p-6 pb-24 text-sm text-slate-500">Memuat data customer...</div>}>
      <AdminCustomerPurchasesPageContent />
    </Suspense>
  );
}
