'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Search, Users } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';
import { useAuthStore } from '@/store/authStore';

type OrderSection = 'baru' | 'backorder' | 'pembayaran' | 'gudang' | 'pengiriman' | 'selesai';

type CustomerOrderCard = {
  key: string;
  customerId: string | null;
  customerName: string;
  latestOrderAt: string;
  latestOrderId: string;
  totalOrders: number;
  counts: Record<OrderSection, number>;
};

const COMPLETED_STATUSES = new Set(['completed', 'canceled', 'expired']);
const PAYMENT_STATUSES = new Set(['waiting_admin_verification']);
// `waiting_invoice` means the order already passed "new order" stage and is waiting to be invoiced/handled.
const WAREHOUSE_STATUSES = new Set(['allocated', 'waiting_invoice', 'ready_to_ship', 'processing', 'shipped', 'hold', 'waiting_payment']);
const BACKORDER_FALLBACK_STATUSES = new Set(['partially_fulfilled', 'hold']);

const normalizeOrderStatus = (raw: unknown) => {
  const status = String(raw || '').trim();
  return status === 'waiting_payment' ? 'ready_to_ship' : status;
};

const asRecord = (value: unknown): Record<string, unknown> => {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
};

const hasExplicitBackorderFlag = (order: unknown): boolean => {
  const row = asRecord(order);
  const raw = row.is_backorder ?? row.isBackorder;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw === 1;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }
  return false;
};

const classifyOrderSection = (order: unknown): OrderSection => {
  const row = asRecord(order);
  const rawStatus = String(row.status || '');
  const normalizedStatus = normalizeOrderStatus(rawStatus);
  if (hasExplicitBackorderFlag(order) || BACKORDER_FALLBACK_STATUSES.has(rawStatus)) return 'backorder';
  if (COMPLETED_STATUSES.has(rawStatus)) return 'selesai';
  if (normalizedStatus === 'shipped') return 'pengiriman';
  if (normalizedStatus === 'delivered') return 'pembayaran';
  if (PAYMENT_STATUSES.has(rawStatus)) return 'pembayaran';
  if (WAREHOUSE_STATUSES.has(normalizedStatus)) return 'gudang';
  return 'baru';
};

const getCustomerCardPriority = (card: CustomerOrderCard) => {
  if (card.counts.baru > 0) return 4;
  if (card.counts.backorder > 0) return 3;
  if (card.counts.pengiriman > 0) return 2;
  if (card.counts.gudang > 0) return 1;
  return 0;
};

export default function AdminOrdersPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir', 'admin_gudang', 'admin_finance']);
  const { isAuthenticated, user } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [customerQuery, setCustomerQuery] = useState('');
  const [orders, setOrders] = useState<unknown[]>([]);
  const hasRenderableAccess = isAuthenticated && ['super_admin', 'kasir', 'admin_gudang', 'admin_finance'].includes(String(user?.role || ''));

  const loadOrders = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!hasRenderableAccess) return;
    try {
      if (!silent) setLoading(true);
      const response = await api.admin.orderManagement.getAll({ page: 1, limit: 200, status: 'all' });
      setOrders(Array.isArray(response?.data?.orders) ? response.data.orders : []);
    } catch (error) {
      console.error('Failed to load admin order inbox:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [hasRenderableAccess]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useRealtimeRefresh({
    enabled: hasRenderableAccess,
    onRefresh: () => loadOrders({ silent: true }),
    domains: ['order', 'retur', 'cod', 'admin'],
    pollIntervalMs: 15000,
  });

  const customerCards = useMemo<CustomerOrderCard[]>(() => {
    const grouped = new Map<string, CustomerOrderCard>();

    orders.forEach((order: unknown) => {
      const row = asRecord(order);
      const customer = asRecord(row.Customer);
      const customerId = row.customer_id ? String(row.customer_id) : null;
      const customerName = String(row.customer_name || customer.name || 'Customer');
      const key = customerId || `guest:${customerName}`;
      const section = classifyOrderSection(order);
      const existing = grouped.get(key) || {
        key,
        customerId,
        customerName,
        latestOrderAt: String(row.createdAt || ''),
        latestOrderId: String(row.id || ''),
        totalOrders: 0,
        counts: {
          baru: 0,
          backorder: 0,
          pembayaran: 0,
          gudang: 0,
          pengiriman: 0,
          selesai: 0,
        },
      };

      const currentTs = Date.parse(String(row.createdAt || row.updatedAt || ''));
      const latestTs = Date.parse(existing.latestOrderAt || '');
      if (!Number.isFinite(latestTs) || (Number.isFinite(currentTs) && currentTs > latestTs)) {
        existing.latestOrderAt = String(row.createdAt || row.updatedAt || '');
        existing.latestOrderId = String(row.id || '');
      }

      existing.totalOrders += 1;
      existing.counts[section] += 1;
      grouped.set(key, existing);
    });

    return Array.from(grouped.values()).sort((a, b) => {
      const priorityDiff = getCustomerCardPriority(b) - getCustomerCardPriority(a);
      if (priorityDiff !== 0) return priorityDiff;
      const bTs = Date.parse(b.latestOrderAt || '');
      const aTs = Date.parse(a.latestOrderAt || '');
      return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
    });
  }, [orders]);

  const actionableCustomerCards = useMemo(() => {
    return customerCards.filter(
      (card) =>
        card.counts.baru > 0 ||
        card.counts.backorder > 0 ||
        card.counts.pembayaran > 0 ||
        card.counts.gudang > 0 ||
        card.counts.pengiriman > 0
    );
  }, [customerCards]);

  const filteredCustomerCards = useMemo(() => {
    const query = customerQuery.trim().toLowerCase();
    if (!query) return actionableCustomerCards;
    return actionableCustomerCards.filter((card) => {
      const name = card.customerName.toLowerCase();
      const id = String(card.customerId || '').toLowerCase();
      const latestOrderId = card.latestOrderId.toLowerCase();
      return name.includes(query) || id.includes(query) || latestOrderId.includes(query);
    });
  }, [actionableCustomerCards, customerQuery]);

  const summary = useMemo(() => {
    return filteredCustomerCards.reduce(
      (acc, card) => {
        acc.customers += 1;
        acc.baru += card.counts.baru;
        acc.backorder += card.counts.backorder;
        acc.pengiriman += card.counts.pengiriman;
        return acc;
      },
      { customers: 0, baru: 0, backorder: 0, pengiriman: 0 }
    );
  }, [filteredCustomerCards]);

  if (!allowed && !hasRenderableAccess) {
    return (
      <div className="space-y-4 p-5 pb-24">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold text-slate-700">
            {!isAuthenticated ? 'Sesi login belum aktif.' : 'Memeriksa akses halaman order...'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {!isAuthenticated
              ? 'Masuk ulang jika halaman ini dibuka setelah refresh browser.'
              : user?.role
                ? `Role terdeteksi: ${user.role}. Jika akses valid, daftar customer order akan muncul otomatis.`
                : 'Jika akses valid, daftar customer order akan muncul otomatis.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-5 pb-24">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">Order Command</p>
          <h1 className="text-xl font-black text-slate-900">Daftar Customer Order</h1>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <Users size={16} className="text-slate-400" />
              <p className="text-xs text-slate-600">Inbox customer order</p>
            </div>
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                <Search size={14} className="text-slate-400" />
                <input
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                  placeholder="Cari customer atau order ID terakhir"
                  className="w-full bg-transparent text-xs font-semibold text-slate-700 outline-none"
                />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Ringkasan inbox</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-bold">
              <div className="rounded-xl bg-slate-50 px-3 py-2 text-slate-700">Customer {summary.customers}</div>
              <div className="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-700">Order baru {summary.baru}</div>
              <div className="rounded-xl bg-amber-50 px-3 py-2 text-amber-700">Backorder {summary.backorder}</div>
              <div className="rounded-xl bg-cyan-50 px-3 py-2 text-cyan-700">Sedang terkirim {summary.pengiriman}</div>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {loading && filteredCustomerCards.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-semibold text-slate-500">Memuat daftar customer order...</p>
            </div>
          ) : filteredCustomerCards.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-semibold text-slate-700">Tidak ada customer yang cocok dengan filter saat ini.</p>
              <p className="mt-1 text-xs text-slate-500">Coba ganti kata kunci atau tunggu order baru masuk.</p>
            </div>
          ) : (
            filteredCustomerCards.map((card) => {
              const detailHref = card.customerId
                ? `/admin/orders/customer/${encodeURIComponent(card.customerId)}?customerName=${encodeURIComponent(card.customerName)}`
                : `/admin/orders/customer/${encodeURIComponent(card.key)}?customerName=${encodeURIComponent(card.customerName)}`;

              return (
                <Link
                  key={card.key}
                  href={detailHref}
                  className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-emerald-300 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Customer</p>
                      <p className="text-lg font-black text-slate-900">{card.customerName}</p>
                      <p className="text-[11px] text-slate-500">{formatDateTime(card.latestOrderAt)}</p>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-white">
                      Buka Detail
                      <ChevronRight size={12} />
                    </div>
                  </div>

                  {card.counts.baru > 0 && (
                    <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">Notifikasi Order Baru</p>
                      <p className="mt-1 text-sm font-black text-emerald-900">
                        {card.counts.baru} order baru perlu dicek untuk customer ini
                      </p>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold">
                    <span className={`rounded-full px-2 py-1 ${card.counts.baru > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                      Order baru {card.counts.baru}
                    </span>
                    {card.counts.backorder > 0 && (
                      <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">
                        Backorder {card.counts.backorder}
                      </span>
                    )}
                    {card.counts.pengiriman > 0 && (
                      <span className="rounded-full bg-cyan-100 px-2 py-1 text-cyan-700">
                        Sedang terkirim {card.counts.pengiriman}
                      </span>
                    )}
                    {card.counts.gudang > 0 && (
                      <span className="rounded-full bg-indigo-100 px-2 py-1 text-indigo-700">
                        Proses gudang {card.counts.gudang}
                      </span>
                    )}
                    {card.counts.pembayaran > 0 && (
                      <span className="rounded-full bg-blue-100 px-2 py-1 text-blue-700">
                        Menunggu bayar {card.counts.pembayaran}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
