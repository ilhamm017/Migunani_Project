'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldOff, ShieldCheck, Search, History, Plus, Pencil } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';

type CustomerRow = {
  id: string;
  name?: string;
  email?: string | null;
  whatsapp_number?: string;
  status: 'active' | 'banned';
  debt?: string | number;
  open_order_count?: number;
  CustomerProfile?: {
    tier?: string;
    points?: number;
    credit_limit?: string | number;
  };
};

type ApiErrorWithMessage = {
  response?: { data?: { message?: string } };
};

export default function AdminSalesHubPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir']);

  const [customers, setCustomers] = useState<CustomerRow[]>([]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'banned'>('all');

  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [processingCustomerId, setProcessingCustomerId] = useState('');
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  const loadCustomers = useCallback(async () => {
    try {
      setLoadingCustomers(true);
      setError('');
      const res = await api.admin.customers.getAll({
        page: 1,
        limit: 60,
        search: search.trim() || undefined,
        status: statusFilter,
      });

      const rows = Array.isArray(res.data?.customers) ? (res.data.customers as CustomerRow[]) : [];
      setCustomers(rows);
    } catch (e: unknown) {
      const err = e as ApiErrorWithMessage;
      setCustomers([]);
      setError(err?.response?.data?.message || 'Gagal memuat data customer');
    } finally {
      setLoadingCustomers(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    if (!allowed) return;
    const timer = setTimeout(() => {
      void loadCustomers();
    }, 250);
    return () => clearTimeout(timer);
  }, [allowed, loadCustomers]);

  const handleToggleCustomerStatus = async (customer: CustomerRow) => {
    const nextStatus = customer.status === 'active' ? 'banned' : 'active';
    const message = nextStatus === 'banned'
      ? `Blokir customer ${customer.name || customer.whatsapp_number || customer.id}?\n\nOrder aktif customer juga akan dibatalkan.`
      : `Aktifkan kembali customer ${customer.name || customer.whatsapp_number || customer.id}?`;

    if (!confirm(message)) return;

    try {
      setProcessingCustomerId(customer.id);
      setActionMessage('');
      const res = await api.admin.customers.updateStatus(customer.id, {
        status: nextStatus,
        halt_open_orders: true,
      });

      const haltedOrderCount = Number(res.data?.halted_order_count || 0);
      setActionMessage(
        nextStatus === 'banned'
          ? `Customer diblokir. ${haltedOrderCount} order aktif dihentikan.`
          : 'Customer diaktifkan kembali.'
      );

      await loadCustomers();
    } catch (e: unknown) {
      const err = e as ApiErrorWithMessage;
      setError(err?.response?.data?.message || 'Gagal mengubah status customer');
    } finally {
      setProcessingCustomerId('');
    }
  };

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      <div className="grid grid-cols-1 gap-4">
        <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-black text-slate-900">Manajemen Customer</h2>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/admin/sales/member-baru"
                className="btn-3d inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-emerald-600 text-white"
              >
                <Plus size={12} /> Daftarkan Customer
              </Link>
              <button
                type="button"
                onClick={() => void loadCustomers()}
                disabled={loadingCustomers}
                className="btn-3d inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200/70 disabled:opacity-50"
              >
                <RefreshCw size={12} /> Refresh
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <div className="md:col-span-3 relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama, WA, email"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'banned')}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
            >
              <option value="all">Semua Status</option>
              <option value="active">Active</option>
              <option value="banned">Banned</option>
            </select>
          </div>

          <div className="space-y-2 max-h-[62vh] overflow-y-auto pr-1">
            {loadingCustomers ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-500">Memuat customer...</div>
            ) : customers.length === 0 ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-500">Customer tidak ditemukan.</div>
            ) : (
              customers.map((customer) => {
                const isProcessing = processingCustomerId === customer.id;
                return (
                  <div
                    key={customer.id}
                    className="w-full text-left border rounded-2xl p-3 border-slate-200 bg-white"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-black text-slate-900">{customer.name || '-'}</p>
                        <p className="text-xs text-slate-600 mt-1">{customer.whatsapp_number || '-'}{customer.email ? ` • ${customer.email}` : ''}</p>
                        <p className="text-[11px] text-slate-500 mt-1">
                          Tier: <span className="font-bold text-slate-700">{customer.CustomerProfile?.tier || 'regular'}</span> • Poin: <span className="font-bold text-slate-700">{Number(customer.CustomerProfile?.points || 0)}</span> • Open Order: <span className="font-bold text-slate-700">{Number(customer.open_order_count || 0)}</span>
                        </p>
                      </div>

                      <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-full ${customer.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                        }`}>
                        {customer.status}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      <Link
                        href={`/admin/chat?userId=${customer.id}`}
                        className="btn-3d inline-flex items-center justify-center text-center whitespace-nowrap text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200"
                        onClick={(event) => event.stopPropagation()}
                      >
                        Chat Customer
                      </Link>

                      <Link
                        href={`/admin/sales/${customer.id}#profil-customer`}
                        className="btn-3d inline-flex items-center justify-center text-center whitespace-nowrap text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 border border-slate-200"
                      >
                        Detail Customer
                      </Link>

                      <Link
                        href={`/admin/sales/customer-purchases?customerId=${customer.id}&customerName=${encodeURIComponent(customer.name || '')}`}
                        className="btn-3d inline-flex items-center justify-center text-center whitespace-nowrap text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-violet-50 text-violet-700 border border-violet-200"
                      >
                        <span className="inline-flex items-center gap-1"><History size={12} /> Riwayat Order</span>
                      </Link>

                      <Link
                        href={`/admin/sales/${customer.id}?edit=1`}
                        className="btn-3d inline-flex items-center justify-center text-center whitespace-nowrap text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200"
                      >
                        <span className="inline-flex items-center gap-1"><Pencil size={12} /> Edit Data</span>
                      </Link>

                      <Link
                        href={`/admin/orders/create?customerId=${customer.id}`}
                        className="btn-3d inline-flex items-center justify-center text-center whitespace-nowrap text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200"
                      >
                        Buat Order
                      </Link>

                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => {
                          void handleToggleCustomerStatus(customer);
                        }}
                        className={`btn-3d inline-flex items-center justify-center text-center whitespace-nowrap text-[11px] font-bold px-2.5 py-1.5 rounded-lg border disabled:opacity-50 ${customer.status === 'active'
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          }`}
                      >
                        {customer.status === 'active' ? (
                          <span className="inline-flex items-center gap-1"><ShieldOff size={12} /> Blokir</span>
                        ) : (
                          <span className="inline-flex items-center gap-1"><ShieldCheck size={12} /> Aktifkan</span>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {(error || actionMessage) && (
        <div className="space-y-2">
          {error && <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700">{error}</div>}
          {actionMessage && <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-700">{actionMessage}</div>}
        </div>
      )}
    </div>
  );
}
