'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquare, RefreshCw, ShieldOff, ShieldCheck, Search } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';
type TierType = 'regular' | 'gold' | 'platinum';

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

type CustomerDetail = {
  id: string;
  name?: string;
  email?: string | null;
  whatsapp_number?: string;
  status: 'active' | 'banned';
  debt?: string | number;
  CustomerProfile?: {
    tier?: string;
    points?: number;
    credit_limit?: string | number;
  };
};

type CustomerOrder = {
  id: string;
  status: string;
  total_amount?: string | number;
  createdAt?: string;
  Invoice?: {
    invoice_number?: string;
    payment_status?: string;
  };
};

const CANCELABLE_ORDER_STATUSES = new Set([
  'pending',
  'waiting_invoice',
  'ready_to_ship',
  'allocated',
  'partially_fulfilled',
  'debt_pending',
  'hold',
]);
const TIER_OPTIONS: Array<{ value: TierType; label: string }> = [
  { value: 'regular', label: 'Regular' },
  { value: 'gold', label: 'Gold' },
  { value: 'platinum', label: 'Platinum' },
];

export default function AdminSalesHubPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir']);

  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetail | null>(null);
  const [selectedOrders, setSelectedOrders] = useState<CustomerOrder[]>([]);
  const [summary, setSummary] = useState<{ total_orders: number; open_orders: number; status_counts: Record<string, number> } | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'banned'>('all');

  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [processingCustomerId, setProcessingCustomerId] = useState('');
  const [processingOrderId, setProcessingOrderId] = useState('');
  const [updatingTier, setUpdatingTier] = useState(false);
  const [selectedTierDraft, setSelectedTierDraft] = useState<TierType>('regular');

  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  const selectedCustomerListRow = useMemo(
    () => customers.find((item) => item.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

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

      setSelectedCustomerId((prev) => {
        if (prev && rows.some((item) => item.id === prev)) return prev;
        return '';
      });
    } catch (e: any) {
      setCustomers([]);
      setError(e?.response?.data?.message || 'Gagal memuat data customer');
    } finally {
      setLoadingCustomers(false);
    }
  }, [search, statusFilter]);

  const loadCustomerDetail = useCallback(async (customerId: string) => {
    if (!customerId) {
      setSelectedCustomer(null);
      setSelectedOrders([]);
      setSummary(null);
      return;
    }

    try {
      setLoadingDetail(true);
      setError('');

      const [detailRes, ordersRes] = await Promise.all([
        api.admin.customers.getById(customerId),
        api.admin.customers.getOrders(customerId, { scope: 'open', limit: 30 }),
      ]);

      setSelectedCustomer((detailRes.data?.customer || null) as CustomerDetail | null);
      setSummary((detailRes.data?.summary || null) as any);
      setSelectedOrders(Array.isArray(ordersRes.data?.orders) ? (ordersRes.data.orders as CustomerOrder[]) : []);
    } catch (e: any) {
      setSelectedCustomer(null);
      setSummary(null);
      setSelectedOrders([]);
      setError(e?.response?.data?.message || 'Gagal memuat detail customer');
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    const timer = setTimeout(() => {
      void loadCustomers();
    }, 250);
    return () => clearTimeout(timer);
  }, [allowed, loadCustomers]);

  useEffect(() => {
    if (!allowed) return;
    void loadCustomerDetail(selectedCustomerId);
  }, [allowed, selectedCustomerId, loadCustomerDetail]);

  useEffect(() => {
    const currentTier = String(selectedCustomer?.CustomerProfile?.tier || 'regular').toLowerCase();
    if (currentTier === 'gold' || currentTier === 'platinum') {
      setSelectedTierDraft(currentTier);
      return;
    }
    setSelectedTierDraft('regular');
  }, [selectedCustomer?.CustomerProfile?.tier, selectedCustomer?.id]);

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

      await Promise.all([loadCustomers(), loadCustomerDetail(customer.id)]);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Gagal mengubah status customer');
    } finally {
      setProcessingCustomerId('');
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!confirm(`Batalkan order ${orderId}?`)) return;

    try {
      setProcessingOrderId(orderId);
      setActionMessage('');
      await api.admin.orderManagement.updateStatus(orderId, { status: 'canceled' });
      setActionMessage(`Order ${orderId} berhasil dibatalkan.`);
      await Promise.all([loadCustomers(), loadCustomerDetail(selectedCustomerId)]);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Gagal membatalkan order');
    } finally {
      setProcessingOrderId('');
    }
  };

  const handleUpdateTier = async () => {
    if (!selectedCustomer?.id) return;
    const currentTier = String(selectedCustomer?.CustomerProfile?.tier || 'regular').toLowerCase();
    if (currentTier === selectedTierDraft) {
      setActionMessage('Tier customer tidak berubah.');
      return;
    }

    try {
      setUpdatingTier(true);
      setError('');
      setActionMessage('');
      await api.admin.customers.updateTier(selectedCustomer.id, selectedTierDraft);
      setActionMessage('Tier customer berhasil diperbarui.');
      await Promise.all([loadCustomers(), loadCustomerDetail(selectedCustomer.id)]);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Gagal memperbarui tier customer');
    } finally {
      setUpdatingTier(false);
    }
  };

  const showCustomerPanel = !!selectedCustomerId;

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      <div className={`grid grid-cols-1 ${showCustomerPanel ? 'xl:grid-cols-3' : ''} gap-4`}>
        <div className={`${showCustomerPanel ? 'xl:col-span-2' : 'xl:col-span-3'} bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-black text-slate-900">Manajemen Customer</h2>
            <button
              type="button"
              onClick={() => void loadCustomers()}
              disabled={loadingCustomers}
              className="inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-slate-100 text-slate-700 disabled:opacity-50"
            >
              <RefreshCw size={12} /> Refresh
            </button>
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
                const active = customer.id === selectedCustomerId;
                const isProcessing = processingCustomerId === customer.id;
                return (
                  <div
                    key={customer.id}
                    onClick={() => {
                      setSelectedCustomerId(customer.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedCustomerId(customer.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    className={`w-full text-left border rounded-2xl p-3 transition-colors ${active
                      ? 'border-emerald-300 bg-emerald-50/50'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
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
                        className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200"
                        onClick={(event) => event.stopPropagation()}
                      >
                        Chat Customer
                      </Link>

                      <Link
                        href={`/admin/orders/create?customerId=${customer.id}`}
                        className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200"
                        onClick={(event) => event.stopPropagation()}
                      >
                        Buat Order
                      </Link>

                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleToggleCustomerStatus(customer);
                        }}
                        className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg border disabled:opacity-50 ${customer.status === 'active'
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

        {showCustomerPanel && (
          <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-black text-slate-900">Detail Customer Terpilih</h2>
              <Link href="/admin/chat/whatsapp" className="text-[11px] font-bold text-blue-700">
                Cek status WA bot
              </Link>
            </div>

            {!selectedCustomerId ? (
              <p className="text-sm text-slate-500">Pilih customer dari daftar untuk melihat detail dan edit tier.</p>
            ) : loadingDetail ? (
            <p className="text-sm text-slate-500">Memuat detail customer...</p>
          ) : !selectedCustomer ? (
            <p className="text-sm text-slate-500">Detail customer tidak tersedia.</p>
          ) : (
            <>
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3">
                <p className="text-sm font-black text-slate-900">{selectedCustomer.name || '-'}</p>
                <p className="text-xs text-slate-600 mt-1">{selectedCustomer.whatsapp_number || '-'}</p>
                {selectedCustomer.email && <p className="text-xs text-slate-600">{selectedCustomer.email}</p>}
                <p className="text-[11px] text-slate-600 mt-2">
                  Tier: <span className="font-bold text-slate-800">{selectedCustomer.CustomerProfile?.tier || 'regular'}</span>
                </p>
                <p className="text-[11px] text-slate-600">
                  Poin: <span className="font-bold text-slate-800">{Number(selectedCustomer.CustomerProfile?.points || 0)}</span>
                </p>
                <p className="text-[11px] text-slate-600">
                  Debt: <span className="font-bold text-slate-800">{formatCurrency(Number(selectedCustomer.debt || 0))}</span>
                </p>
                <p className="text-[11px] text-slate-600">
                  Credit Limit: <span className="font-bold text-slate-800">{formatCurrency(Number(selectedCustomer.CustomerProfile?.credit_limit || 0))}</span>
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2">
                <p className="text-[11px] font-black text-slate-700 uppercase tracking-wide">Edit Tier Customer</p>
                <div className="flex items-center gap-2">
                  <select
                    value={selectedTierDraft}
                    onChange={(e) => setSelectedTierDraft(e.target.value as TierType)}
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                    disabled={updatingTier}
                  >
                    {TIER_OPTIONS.map((tier) => (
                      <option key={tier.value} value={tier.value}>{tier.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleUpdateTier()}
                    disabled={updatingTier}
                    className="px-3 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold disabled:opacity-50"
                  >
                    {updatingTier ? 'Menyimpan...' : 'Update Tier'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5">
                  <p className="text-[10px] font-bold text-amber-700 uppercase">Open Order</p>
                  <p className="text-lg font-black text-amber-800">{Number(summary?.open_orders || 0)}</p>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-2.5">
                  <p className="text-[10px] font-bold text-blue-700 uppercase">Total Order</p>
                  <p className="text-lg font-black text-blue-800">{Number(summary?.total_orders || 0)}</p>
                </div>
              </div>

              <Link
                href={`/admin/chat?userId=${selectedCustomer.id}`}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 text-white text-xs font-bold py-2"
              >
                <MessageSquare size={14} /> Lanjutkan Chat Customer
              </Link>
            </>
          )}
          </div>
        )}
      </div>

      {!!selectedCustomerId && (
        <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-black text-slate-900">Order Aktif Customer</h2>
          {!!selectedCustomerId && (
            <Link
              href={`/admin/orders/create?customerId=${selectedCustomerId}`}
              className="text-xs font-bold px-3 py-2 rounded-xl bg-emerald-600 text-white"
            >
              Buat Order Baru
            </Link>
          )}
        </div>

        {!selectedCustomerId ? (
          <p className="text-sm text-slate-500">Pilih customer untuk melihat order aktif.</p>
        ) : loadingDetail ? (
          <p className="text-sm text-slate-500">Memuat order customer...</p>
        ) : selectedOrders.length === 0 ? (
          <p className="text-sm text-slate-500">Tidak ada order aktif untuk customer ini.</p>
        ) : (
          <div className="space-y-2">
            {selectedOrders.map((order) => {
              const cancelable = CANCELABLE_ORDER_STATUSES.has(String(order.status || '').toLowerCase());
              const isProcessing = processingOrderId === order.id;

              return (
                <div key={order.id} className="border border-slate-200 rounded-2xl p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-black text-slate-900">Order #{order.id}</p>
                      <p className="text-xs text-slate-600 mt-1">
                        {order.createdAt ? formatDateTime(order.createdAt) : '-'} • {order.Invoice?.invoice_number || '-'}
                      </p>
                      <p className="text-xs text-slate-600">
                        Status: <span className="font-bold text-slate-800 uppercase">{order.status || '-'}</span>
                      </p>
                      <p className="text-xs text-slate-600">
                        Payment: <span className="font-bold text-slate-800">{order.Invoice?.payment_status || '-'}</span>
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-sm font-black text-slate-900">{formatCurrency(Number(order.total_amount || 0))}</p>
                      <div className="flex items-center justify-end gap-2 mt-2">
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700"
                        >
                          Detail
                        </Link>
                        <button
                          type="button"
                          disabled={!cancelable || isProcessing}
                          onClick={() => void handleCancelOrder(order.id)}
                          className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 disabled:opacity-50"
                          title={cancelable ? 'Batalkan order' : 'Status ini tidak bisa dibatalkan oleh kasir'}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </div>
      )}

      {(error || actionMessage) && (
        <div className="space-y-2">
          {error && <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700">{error}</div>}
          {actionMessage && <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-700">{actionMessage}</div>}
        </div>
      )}

      {selectedCustomerListRow && (
        <div className="bg-slate-900 text-white rounded-2xl p-4 text-sm">
          Shortcut dari WhatsApp: buka <span className="font-black">Inbox</span> lalu pilih customer, lanjut klik <span className="font-black">Buat Order</span> untuk memasukkan transaksi ke akun customer.
        </div>
      )}
    </div>
  );
}
