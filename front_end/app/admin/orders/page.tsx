'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Package, Search, Users } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';
import { useAuthStore } from '@/store/authStore';

type CustomerGroup = {
  key: string;
  customer_id: string | null;
  customer_name: string;
  orders: any[];
  counts: {
    baru: number;
    backorder: number;
    pembayaran: number;
    gudang: number;
    selesai: number;
  };
};

const COMPLETED_STATUSES = new Set(['completed', 'delivered', 'canceled', 'expired']);
const PAYMENT_STATUSES = new Set(['waiting_admin_verification']);
const WAREHOUSE_STATUSES = new Set(['ready_to_ship', 'shipped']);
const ALLOCATION_EDITABLE_STATUSES = new Set(['pending', 'waiting_invoice', 'allocated', 'partially_fulfilled', 'debt_pending', 'hold']);

export default function AdminOrdersPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'admin_finance', 'kasir']);
  const { user } = useAuthStore();
  const canIssueInvoice = useMemo(() => ['super_admin', 'kasir'].includes(user?.role || ''), [user?.role]);
  const canAllocate = useMemo(() => ['super_admin', 'kasir'].includes(user?.role || ''), [user?.role]);
  const [orders, setOrders] = useState<any[]>([]);
  const [backorderIds, setBackorderIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [selectedCustomerKey, setSelectedCustomerKey] = useState<string | null>(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerFilter, setCustomerFilter] = useState<'all' | 'baru' | 'backorder' | 'pembayaran' | 'gudang' | 'selesai'>('all');
  const [orderQuery, setOrderQuery] = useState('');
  const [orderSectionFilter, setOrderSectionFilter] = useState<'all' | 'baru' | 'backorder' | 'pembayaran' | 'gudang' | 'selesai'>('all');
  const [orderDetails, setOrderDetails] = useState<Record<string, any>>({});
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [allocationDrafts, setAllocationDrafts] = useState<Record<string, Record<string, number>>>({});
  const [allocationSaving, setAllocationSaving] = useState<Record<string, boolean>>({});
  const [busyInvoice, setBusyInvoice] = useState(false);

  const loadOrders = useCallback(async () => {
    if (!allowed) return;
    try {
      setLoading(true);
      const [allRes, backorderRes] = await Promise.all([
        api.admin.orderManagement.getAll({ page: 1, limit: 200, status: 'all' }),
        api.admin.orderManagement.getAll({ page: 1, limit: 200, status: 'all', is_backorder: 'true' })
      ]);
      const allOrders = allRes.data?.orders || [];
      const backorderSet = new Set<string>(
        (backorderRes.data?.orders || []).map((o: any) => String(o.id))
      );
      setOrders(allOrders);
      setBackorderIds(backorderSet);
      if (!selectedCustomerKey && allOrders.length > 0) {
        const first = allOrders[0];
        const key = first.customer_id ? String(first.customer_id) : `guest:${first.customer_name || first.id}`;
        setSelectedCustomerKey(key);
      }
    } catch (error) {
      console.error('Failed to load orders:', error);
    } finally {
      setLoading(false);
    }
  }, [allowed, selectedCustomerKey]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useRealtimeRefresh({
    enabled: allowed,
    onRefresh: loadOrders,
    domains: ['order', 'retur', 'cod', 'admin'],
    pollIntervalMs: 15000,
  });

  const customerGroups = useMemo<CustomerGroup[]>(() => {
    const map = new Map<string, CustomerGroup>();
    orders.forEach((order: any) => {
      const customerId = order.customer_id ? String(order.customer_id) : null;
      const name = String(order.customer_name || order.Customer?.name || 'Customer');
      const key = customerId || `guest:${name}`;
      const group = map.get(key) || {
        key,
        customer_id: customerId,
        customer_name: name,
        orders: [],
        counts: { baru: 0, backorder: 0, pembayaran: 0, gudang: 0, selesai: 0 },
      };

      const isCompleted = COMPLETED_STATUSES.has(String(order.status || ''));
      const isPayment = PAYMENT_STATUSES.has(String(order.status || ''));
      const isWarehouse = WAREHOUSE_STATUSES.has(String(order.status || ''));
      const isBackorder = backorderIds.has(String(order.id));
      if (isCompleted) group.counts.selesai += 1;
      else if (isPayment) group.counts.pembayaran += 1;
      else if (isWarehouse) group.counts.gudang += 1;
      else if (isBackorder) group.counts.backorder += 1;
      else group.counts.baru += 1;

      group.orders.push(order);
      map.set(key, group);
    });

    return Array.from(map.values()).sort((a, b) => {
      const aCount = a.counts.baru + a.counts.backorder + a.counts.pembayaran + a.counts.gudang + a.counts.selesai;
      const bCount = b.counts.baru + b.counts.backorder + b.counts.pembayaran + b.counts.gudang + b.counts.selesai;
      return bCount - aCount;
    });
  }, [orders, backorderIds]);

  const filteredCustomerGroups = useMemo(() => {
    const query = customerQuery.trim().toLowerCase();
    const searched = !query
      ? customerGroups
      : customerGroups.filter((group) => {
      const name = String(group.customer_name || '').toLowerCase();
      const id = String(group.customer_id || '').toLowerCase();
      return name.includes(query) || id.includes(query) || group.key.toLowerCase().includes(query);
    });
    if (customerFilter === 'all') return searched;
    return searched.filter((group) => group.counts[customerFilter] > 0);
  }, [customerGroups, customerQuery, customerFilter]);

  const selectedGroup = useMemo(() => {
    if (!selectedCustomerKey) return null;
    return customerGroups.find((group) => group.key === selectedCustomerKey) || null;
  }, [customerGroups, selectedCustomerKey]);

  const groupedOrders = useMemo(() => {
    const group = selectedGroup;
    if (!group) return { baru: [], backorder: [], pembayaran: [], gudang: [], selesai: [] };
    const result = { baru: [] as any[], backorder: [] as any[], pembayaran: [] as any[], gudang: [] as any[], selesai: [] as any[] };
    group.orders.forEach((order: any) => {
      const isCompleted = COMPLETED_STATUSES.has(String(order.status || ''));
      const isPayment = PAYMENT_STATUSES.has(String(order.status || ''));
      const isWarehouse = WAREHOUSE_STATUSES.has(String(order.status || ''));
      const isBackorder = backorderIds.has(String(order.id));
      if (isCompleted) result.selesai.push(order);
      else if (isPayment) result.pembayaran.push(order);
      else if (isWarehouse) result.gudang.push(order);
      else if (isBackorder) result.backorder.push(order);
      else result.baru.push(order);
    });
    return result;
  }, [selectedGroup, backorderIds]);

  const filteredGroupedOrders = useMemo(() => {
    const query = orderQuery.trim().toLowerCase();
    if (!query) return groupedOrders;
    const matchOrder = (order: any) => {
      const id = String(order.id || '').toLowerCase();
      const status = String(order.status || '').toLowerCase();
      if (id.includes(query) || status.includes(query)) return true;
      const detail = orderDetails[String(order.id)];
      if (!detail) return false;
      const items = Array.isArray(detail.OrderItems) ? detail.OrderItems : [];
      return items.some((item: any) => {
        const name = String(item?.Product?.name || '').toLowerCase();
        const sku = String(item?.Product?.sku || '').toLowerCase();
        return name.includes(query) || sku.includes(query);
      });
    };
    return {
      baru: groupedOrders.baru.filter(matchOrder),
      backorder: groupedOrders.backorder.filter(matchOrder),
      pembayaran: groupedOrders.pembayaran.filter(matchOrder),
      gudang: groupedOrders.gudang.filter(matchOrder),
      selesai: groupedOrders.selesai.filter(matchOrder),
    };
  }, [groupedOrders, orderDetails, orderQuery]);

  const loadOrderDetails = useCallback(async (ordersToLoad: any[]) => {
    if (ordersToLoad.length === 0) return;
    setDetailsLoading(true);
    try {
      const responses = await Promise.all(
        ordersToLoad.map((order) => api.orders.getOrderById(order.id))
      );
      const nextMap: Record<string, any> = {};
      responses.forEach((res) => {
        const order = res.data;
        if (order?.id) nextMap[String(order.id)] = order;
      });
      setOrderDetails((prev) => ({ ...prev, ...nextMap }));
    } catch (error) {
      console.error('Failed to load order detail:', error);
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedGroup) return;
    const targetOrders = [...groupedOrders.baru, ...groupedOrders.backorder, ...groupedOrders.pembayaran, ...groupedOrders.gudang];
    const missingDetails = targetOrders.filter((order) => !orderDetails[String(order.id)]);
    void loadOrderDetails(missingDetails);
  }, [groupedOrders.baru, groupedOrders.backorder, groupedOrders.pembayaran, groupedOrders.gudang, selectedGroup, orderDetails, loadOrderDetails]);

  useEffect(() => {
    if (filteredCustomerGroups.length === 0) {
      setSelectedCustomerKey(null);
      return;
    }
    if (!selectedCustomerKey) {
      setSelectedCustomerKey(filteredCustomerGroups[0].key);
      return;
    }
    const stillExists = filteredCustomerGroups.some((group) => group.key === selectedCustomerKey);
    if (!stillExists) {
      setSelectedCustomerKey(filteredCustomerGroups[0].key);
    }
  }, [filteredCustomerGroups, selectedCustomerKey]);

  const availabilityByOrderId = useMemo(() => {
    const result: Record<string, Record<string, { allocQty: number; maxInvoice: number }>> = {};
    Object.values(orderDetails).forEach((detail: any) => {
      const orderId = String(detail.id);
      const allocations = Array.isArray(detail.Allocations) ? detail.Allocations : [];
      const items = Array.isArray(detail.OrderItems) ? detail.OrderItems : [];
      const allocatedByProduct = new Map<string, number>();
      allocations.forEach((alloc: any) => {
        const key = String(alloc?.product_id || '');
        if (!key) return;
        allocatedByProduct.set(key, Number(allocatedByProduct.get(key) || 0) + Number(alloc?.allocated_qty || 0));
      });
      const itemsByProduct = new Map<string, any[]>();
      items.forEach((item: any) => {
        const key = String(item?.product_id || '');
        if (!key) return;
        const list = itemsByProduct.get(key) || [];
        list.push(item);
        itemsByProduct.set(key, list);
      });

      const availability: Record<string, { allocQty: number; maxInvoice: number }> = {};
      itemsByProduct.forEach((itemsForProduct, productId) => {
        let remainingAlloc = Number(allocatedByProduct.get(productId) || 0);
        const sortedItems = [...itemsForProduct].sort((a, b) => {
          const aId = Number(a.id);
          const bId = Number(b.id);
          if (Number.isFinite(aId) && Number.isFinite(bId)) return aId - bId;
          return String(a.id).localeCompare(String(b.id));
        });
        for (const item of sortedItems) {
          const orderedQty = Number(item.qty || 0);
          const allocQty = Math.min(remainingAlloc, orderedQty);
          remainingAlloc -= allocQty;
          availability[String(item.id)] = {
            allocQty,
            maxInvoice: allocQty,
          };
        }
      });
      result[orderId] = availability;
    });
    return result;
  }, [orderDetails]);

  const groupedItemsByOrderId = useMemo(() => {
    const result: Record<string, Array<{ product_id: string; qty: number; Product?: any }>> = {};
    Object.values(orderDetails).forEach((detail: any) => {
      const orderId = String(detail.id);
      const items = Array.isArray(detail.OrderItems) ? detail.OrderItems : [];
      const byProduct = new Map<string, { product_id: string; qty: number; Product?: any }>();
      items.forEach((item: any) => {
        const productId = String(item?.product_id || '');
        if (!productId) return;
        const prev = byProduct.get(productId);
        if (prev) {
          prev.qty += Number(item?.qty || 0);
        } else {
          byProduct.set(productId, {
            product_id: productId,
            qty: Number(item?.qty || 0),
            Product: item?.Product || null,
          });
        }
      });
      result[orderId] = Array.from(byProduct.values());
    });
    return result;
  }, [orderDetails]);

  const persistedAllocByOrderId = useMemo(() => {
    const result: Record<string, Record<string, number>> = {};
    Object.values(orderDetails).forEach((detail: any) => {
      const orderId = String(detail.id);
      const allocations = Array.isArray(detail.Allocations) ? detail.Allocations : [];
      const map: Record<string, number> = {};
      allocations.forEach((allocation: any) => {
        const key = String(allocation?.product_id || '');
        if (!key) return;
        map[key] = Number(map[key] || 0) + Number(allocation?.allocated_qty || 0);
      });
      result[orderId] = map;
    });
    return result;
  }, [orderDetails]);

  useEffect(() => {
    setAllocationDrafts((prev) => {
      const next = { ...prev };
      Object.entries(groupedItemsByOrderId).forEach(([orderId, items]) => {
        if (next[orderId]) return;
        const persisted = persistedAllocByOrderId[orderId] || {};
        const draft: Record<string, number> = {};
        items.forEach((item) => {
          const productId = String(item.product_id || '');
          if (!productId) return;
          draft[productId] = Number(persisted[productId] || 0);
        });
        next[orderId] = draft;
      });
      return next;
    });
  }, [groupedItemsByOrderId, persistedAllocByOrderId]);

  const shortageSummaryByOrderId = useMemo(() => {
    const result: Record<string, { orderedTotal: number; allocatedTotal: number; shortageTotal: number }> = {};
    Object.values(orderDetails).forEach((detail: any) => {
      const orderId = String(detail.id);
      const items = Array.isArray(detail.OrderItems) ? detail.OrderItems : [];
      const allocations = Array.isArray(detail.Allocations) ? detail.Allocations : [];
      const orderedByProduct = new Map<string, number>();
      items.forEach((item: any) => {
        const key = String(item?.product_id || '');
        if (!key) return;
        orderedByProduct.set(key, Number(orderedByProduct.get(key) || 0) + Number(item?.qty || 0));
      });
      const allocatedByProduct = new Map<string, number>();
      allocations.forEach((alloc: any) => {
        const key = String(alloc?.product_id || '');
        if (!key) return;
        allocatedByProduct.set(key, Number(allocatedByProduct.get(key) || 0) + Number(alloc?.allocated_qty || 0));
      });
      let orderedTotal = 0;
      let allocatedTotal = 0;
      let shortageTotal = 0;
      orderedByProduct.forEach((orderedQty, productId) => {
        const allocatedQty = Number(allocatedByProduct.get(productId) || 0);
        orderedTotal += orderedQty;
        allocatedTotal += Math.min(orderedQty, allocatedQty);
        shortageTotal += Math.max(0, orderedQty - allocatedQty);
      });
      result[orderId] = { orderedTotal, allocatedTotal, shortageTotal };
    });
    return result;
  }, [orderDetails]);

  const orderTotalsById = useMemo(() => {
    const result: Record<string, { orderedQty: number; allocQty: number; remainingQty: number; allocPct: number }> = {};
    Object.values(orderDetails).forEach((detail: any) => {
      const orderId = String(detail.id);
      const items = Array.isArray(detail.OrderItems) ? detail.OrderItems : [];
      const allocations = Array.isArray(detail.Allocations) ? detail.Allocations : [];
      const orderedQty = items.reduce((sum: number, item: any) => sum + Number(item?.qty || 0), 0);
      const allocQty = allocations.reduce((sum: number, alloc: any) => sum + Number(alloc?.allocated_qty || 0), 0);
      const remainingQty = Math.max(0, orderedQty - allocQty);
      const allocPct = orderedQty > 0 ? Math.round((allocQty / orderedQty) * 100) : 0;
      result[orderId] = { orderedQty, allocQty, remainingQty, allocPct };
    });
    return result;
  }, [orderDetails]);

  const readyOrderIds = useMemo(() => {
    if (!selectedGroup) return [] as string[];
    const candidates = [...groupedOrders.baru, ...groupedOrders.backorder];
    return candidates
      .filter((order) => String(order.status || '') === 'waiting_invoice')
      .map((order) => String(order.id));
  }, [selectedGroup, groupedOrders.baru, groupedOrders.backorder]);

  const readyInvoiceSummary = useMemo(() => {
    let total = 0;
    let itemCount = 0;
    readyOrderIds.forEach((orderId) => {
      const detail = orderDetails[orderId];
      if (!detail) return;
      const availability = availabilityByOrderId[orderId] || {};
      const items = Array.isArray(detail.OrderItems) ? detail.OrderItems : [];
      items.forEach((item: any) => {
        const qty = Number(availability[String(item.id)]?.maxInvoice || 0);
        if (qty <= 0) return;
        total += Number(item.price_at_purchase || 0) * qty;
        itemCount += 1;
      });
    });
    return { total, itemCount };
  }, [readyOrderIds, orderDetails, availabilityByOrderId]);

  const handleAllocationChange = (orderId: string, productId: string, maxQty: number, rawValue: string) => {
    const parsed = Number(rawValue);
    const nextQty = Number.isFinite(parsed) ? Math.max(0, Math.min(maxQty, parsed)) : 0;
    setAllocationDrafts((prev) => ({
      ...prev,
      [orderId]: {
        ...(prev[orderId] || {}),
        [productId]: nextQty
      }
    }));
  };

  const handleAutoAllocate = (orderId: string) => {
    const groupedItems = groupedItemsByOrderId[orderId] || [];
    const persisted = persistedAllocByOrderId[orderId] || {};
    if (groupedItems.length === 0) return;
    setAllocationDrafts((prev) => {
      const nextAlloc: Record<string, number> = { ...(prev[orderId] || {}) };
      groupedItems.forEach((item) => {
        const product = item.Product || {};
        const orderedQty = Number(item.qty || 0);
        const currentAllocated = Number(persisted[item.product_id] || 0);
        const stockQty = Number(product.stock_quantity);
        const maxAvailable = Number.isFinite(stockQty) ? stockQty + currentAllocated : orderedQty;
        nextAlloc[item.product_id] = Math.min(orderedQty, Math.max(0, maxAvailable));
      });
      return { ...prev, [orderId]: nextAlloc };
    });
  };

  const handleSaveAllocation = async (orderId: string) => {
    if (!confirm(`Selesaikan alokasi untuk order #${orderId}?`)) return;
    const draft = allocationDrafts[orderId] || {};
    const items = Object.entries(draft).map(([product_id, qty]) => ({
      product_id,
      qty: Number(qty || 0),
    }));
    try {
      setAllocationSaving((prev) => ({ ...prev, [orderId]: true }));
      await api.allocation.allocate(orderId, items);
      const refreshed = await api.orders.getOrderById(orderId);
      const detail = refreshed.data;
      if (detail?.id) {
        setOrderDetails((prev) => ({ ...prev, [String(detail.id)]: detail }));
        const draft: Record<string, number> = {};
        const allocations = Array.isArray(detail.Allocations) ? detail.Allocations : [];
        const items = Array.isArray(detail.OrderItems) ? detail.OrderItems : [];
        const allocByProduct: Record<string, number> = {};
        allocations.forEach((allocation: any) => {
          const key = String(allocation?.product_id || '');
          if (!key) return;
          allocByProduct[key] = Number(allocByProduct[key] || 0) + Number(allocation?.allocated_qty || 0);
        });
        items.forEach((item: any) => {
          const key = String(item?.product_id || '');
          if (!key) return;
          if (draft[key] === undefined) draft[key] = Number(allocByProduct[key] || 0);
        });
        setAllocationDrafts((prev) => ({ ...prev, [String(detail.id)]: draft }));
      }
      await loadOrders();
    } catch (error: any) {
      console.error('Allocation save failed:', error);
      alert(error?.response?.data?.message || 'Gagal menyimpan alokasi.');
    } finally {
      setAllocationSaving((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  const handleIssueInvoice = async () => {
    if (readyOrderIds.length === 0) return;
    if (!confirm('Terbitkan invoice untuk semua order yang siap (lintas order)?')) return;
    if (!confirm('Invoice dibuat dari qty alokasi saat ini. Lanjutkan?')) return;
    try {
      setBusyInvoice(true);
      await api.admin.finance.issueInvoiceBatch(readyOrderIds);
      await loadOrders();
    } catch (error: any) {
      console.error('Issue invoice failed:', error);
      alert(error?.response?.data?.message || 'Gagal menerbitkan invoice.');
    } finally {
      setBusyInvoice(false);
    }
  };


  if (!allowed) return null;

  return (
    <div className="p-5 pb-24 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] mb-1">Order Command</p>
          <h1 className="text-xl font-black text-slate-900">Daftar Customer Order</h1>
          <p className="text-xs text-slate-500">Klik customer untuk melihat order dan pilih item untuk invoice.</p>
        </div>
        {canIssueInvoice && (
          <Link href="/admin/finance/issue-invoice" className="text-xs font-bold text-emerald-700">
            Ke halaman issue invoice
          </Link>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="space-y-3">
          <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm flex items-center gap-2">
            <Users size={16} className="text-slate-400" />
            <p className="text-xs text-slate-600">
              Customer ({filteredCustomerGroups.length}/{customerGroups.length})
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm space-y-2">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Search Customer</label>
            <div className="flex items-center gap-2">
              <Search size={14} className="text-slate-400" />
              <input
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                placeholder="Nama atau ID customer"
                className="w-full bg-transparent text-xs font-semibold text-slate-700 focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {(['all', 'baru', 'backorder', 'pembayaran', 'gudang', 'selesai'] as const).map((filter) => {
                const label =
                  filter === 'all'
                    ? 'Semua'
                    : filter === 'baru'
                      ? 'Order Baru'
                      : filter === 'backorder'
                        ? 'Backorder'
                        : filter === 'pembayaran'
                          ? 'Menunggu Bayar'
                          : filter === 'gudang'
                            ? 'Proses Gudang'
                            : 'Selesai';
                const active = customerFilter === filter;
                return (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setCustomerFilter(filter)}
                    className={`px-2 py-1 rounded-full text-[10px] font-bold border ${
                      active ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          {loading ? (
            [1, 2, 3].map((i) => <div key={i} className="h-20 bg-slate-200 rounded-2xl animate-pulse" />)
          ) : filteredCustomerGroups.length === 0 ? (
            <div className="text-center text-slate-400 text-sm py-10">Tidak ada order.</div>
          ) : (
            filteredCustomerGroups.map((group) => {
              const isActive = selectedCustomerKey === group.key;
              return (
                <button
                  key={group.key}
                  onClick={() => setSelectedCustomerKey(group.key)}
                  className={`w-full text-left border rounded-2xl p-3 transition-all ${
                    isActive ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-black text-slate-900 truncate">{group.customer_name}</p>
                      <p className="text-[10px] text-slate-500">{group.customer_id || 'Guest'}</p>
                    </div>
                    <ChevronRight size={16} className={isActive ? 'text-emerald-500' : 'text-slate-300'} />
                  </div>
                  <div className="mt-2 flex gap-2 text-[10px] font-bold">
                    <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-600">Baru {group.counts.baru}</span>
                    <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700">Backorder {group.counts.backorder}</span>
                    <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700">Bayar {group.counts.pembayaran}</span>
                    <span className="px-2 py-1 rounded-full bg-indigo-100 text-indigo-700">Gudang {group.counts.gudang}</span>
                    <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">Selesai {group.counts.selesai}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="space-y-4">
          {selectedGroup ? (
            <>
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-slate-500">Customer terpilih</p>
                  <p className="text-lg font-black text-slate-900">{selectedGroup.customer_name}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-slate-400">Order siap invoice</p>
                  <p className="text-sm font-black text-slate-900">{readyOrderIds.length}</p>
                  <p className="text-[10px] text-slate-500">Estimasi nilai invoice</p>
                  <p className="text-xs text-emerald-700 font-bold">{formatCurrency(readyInvoiceSummary.total)}</p>
                </div>
              </div>

              <div className="bg-slate-900 text-white rounded-2xl p-4 flex flex-col gap-2">
                <p className="text-xs font-bold">Terbitkan Invoice</p>
                <p className="text-[11px] text-white/70">
                  Invoice dihitung dari qty yang sudah dialokasikan untuk order yang siap invoice (lintas order ID).
                </p>
                {canIssueInvoice ? (
                  <button
                    onClick={handleIssueInvoice}
                    disabled={busyInvoice || readyOrderIds.length === 0}
                    className="mt-2 px-4 py-2 rounded-xl bg-emerald-500 text-xs font-black uppercase disabled:opacity-50"
                  >
                    {busyInvoice ? 'Memproses...' : 'Issue Invoice'}
                  </button>
                ) : (
                  <p className="text-[11px] text-white/70">Hanya kasir atau super admin yang bisa menerbitkan invoice.</p>
                )}
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm space-y-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Search Order</label>
                <div className="flex items-center gap-2">
                  <Search size={14} className="text-slate-400" />
                  <input
                    value={orderQuery}
                    onChange={(e) => setOrderQuery(e.target.value)}
                    placeholder="Order ID, status, SKU, produk"
                    className="w-full bg-transparent text-xs font-semibold text-slate-700 focus:outline-none"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {(['all', 'baru', 'backorder', 'pembayaran', 'gudang', 'selesai'] as const).map((filter) => {
                    const label =
                      filter === 'all'
                        ? 'Semua'
                        : filter === 'baru'
                          ? 'Order Baru'
                          : filter === 'backorder'
                            ? 'Backorder'
                            : filter === 'pembayaran'
                              ? 'Menunggu Bayar'
                              : filter === 'gudang'
                                ? 'Proses Gudang'
                                : 'Selesai';
                    const active = orderSectionFilter === filter;
                    return (
                      <button
                        key={filter}
                        type="button"
                        onClick={() => setOrderSectionFilter(filter)}
                        className={`px-2 py-1 rounded-full text-[10px] font-bold border ${
                          active ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {detailsLoading && (
                <div className="text-xs text-slate-400">Memuat detail order...</div>
              )}

              {(['baru', 'backorder', 'pembayaran', 'gudang', 'selesai'] as const).map((section) => {
                if (orderSectionFilter !== 'all' && orderSectionFilter !== section) return null;
                const label = section === 'baru'
                  ? 'Order Baru'
                  : section === 'backorder'
                    ? 'Backorder'
                    : section === 'pembayaran'
                      ? 'Menunggu Pembayaran'
                      : section === 'gudang'
                        ? 'Proses Gudang'
                      : 'Selesai';
                const list = filteredGroupedOrders[section];
                if (list.length === 0) return null;
                return (
                  <div key={section} className="space-y-2">
                    <h2 className="text-xs font-black uppercase tracking-widest text-slate-400">{label}</h2>
                    {list.map((order) => {
                      const detail = orderDetails[String(order.id)];
                      const availability = availabilityByOrderId[String(order.id)] || {};
                      const totals = orderTotalsById[String(order.id)] || { orderedQty: 0, allocQty: 0, remainingQty: 0, allocPct: 0 };
                      const groupedItems = groupedItemsByOrderId[String(order.id)] || [];
                      const persistedAlloc = persistedAllocByOrderId[String(order.id)] || {};
                      const allocationDraft = allocationDrafts[String(order.id)] || {};
                      const shortageSummary = shortageSummaryByOrderId[String(order.id)] || { orderedTotal: 0, allocatedTotal: 0, shortageTotal: 0 };
                      const isAllocationEditable = ALLOCATION_EDITABLE_STATUSES.has(String(order.status || ''));
                      const allocationBusy = Boolean(allocationSaving[String(order.id)]);
                      const allocationDirty = groupedItems.some((item) => {
                        const productId = String(item.product_id || '');
                        if (!productId) return false;
                        const draftQty = Number(allocationDraft[productId] ?? 0);
                        const persistedQty = Number(persistedAlloc[productId] ?? 0);
                        return draftQty !== persistedQty;
                      });
                      const hasInvoice = Boolean(detail?.Invoice || (Array.isArray(detail?.Invoices) && detail.Invoices.length > 0));
                      const backorderItems = groupedItems
                        .map((item) => {
                          const productId = String(item.product_id || '');
                          if (!productId) return null;
                          const orderedQty = Number(item.qty || 0);
                          const allocatedQty = Number(persistedAlloc[productId] || 0);
                          const shortageQty = Math.max(0, orderedQty - allocatedQty);
                          if (shortageQty <= 0) return null;
                          return {
                            product_id: productId,
                            name: item.Product?.name || 'Produk',
                            sku: item.Product?.sku || '-',
                            orderedQty,
                            allocatedQty,
                            shortageQty,
                          };
                        })
                        .filter(Boolean) as Array<{
                        product_id: string;
                        name: string;
                        sku: string;
                        orderedQty: number;
                        allocatedQty: number;
                        shortageQty: number;
                      }>;
                      return (
                        <div key={order.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-black text-slate-900">#{order.id}</p>
                              <p className="text-[11px] text-slate-500">{formatDateTime(order.createdAt)}</p>
                              {detail && (
                                <p className="text-[10px] text-slate-500">
                                  Qty {totals.orderedQty} • Alokasi {totals.allocQty}/{totals.orderedQty}
                                  {totals.orderedQty > 0 ? ` (${totals.allocPct}%)` : ''}
                                  {totals.remainingQty > 0 ? ` • Sisa ${totals.remainingQty}` : ''}
                                </p>
                              )}
                            </div>
                            <div className="text-right">
                              <p className="text-[11px] text-slate-500">{order.status}</p>
                              <p className="text-sm font-black text-slate-900">{formatCurrency(Number(order.total_amount || 0))}</p>
                            </div>
                          </div>
                          {detail && totals.orderedQty > 0 && (
                            <div className="mt-2 h-1 w-full rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className="h-full bg-emerald-500"
                                style={{ width: `${Math.min(100, Math.max(0, totals.allocPct))}%` }}
                              />
                            </div>
                          )}

                          {section !== 'selesai' && detail && canAllocate && (
                            <div className="mt-3 border border-slate-100 rounded-2xl p-3 bg-slate-50/60 space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Alokasi Stok</p>
                                  <p className="text-[11px] text-slate-500">
                                    Total {shortageSummary.orderedTotal} • Dialokasikan {shortageSummary.allocatedTotal}
                                    {shortageSummary.shortageTotal > 0 ? ` • Kurang ${shortageSummary.shortageTotal}` : ''}
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleAutoAllocate(String(order.id))}
                                    disabled={!isAllocationEditable}
                                    className="px-3 py-1 rounded-lg text-[10px] font-bold border border-slate-200 text-slate-600 disabled:opacity-50"
                                  >
                                    Auto Fill
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveAllocation(String(order.id))}
                                    disabled={!isAllocationEditable || allocationBusy || !allocationDirty}
                                    className="px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-emerald-600 text-white disabled:opacity-50"
                                  >
                                    {allocationBusy ? 'Menyimpan...' : 'Selesai Alokasi'}
                                  </button>
                                </div>
                              </div>
                              {!allocationDirty && (
                                <p className="text-[10px] text-emerald-600">
                                  Alokasi tersimpan. {String(order.status || '') === 'waiting_invoice' ? 'Siap terbitkan invoice.' : 'Menunggu status waiting_invoice.'}
                                </p>
                              )}
                              {!isAllocationEditable && (
                                <p className="text-[10px] text-amber-600">
                                  Alokasi dikunci pada status <span className="font-bold">{order.status}</span>.
                                </p>
                              )}
                              {groupedItems.length === 0 ? (
                                <p className="text-[11px] text-slate-400">Tidak ada item untuk dialokasikan.</p>
                              ) : (
                                <div className="space-y-2">
                                  {groupedItems.map((item) => {
                                    const product = item.Product || {};
                                    const orderedQty = Number(item.qty || 0);
                                    const persistedQty = Number(persistedAlloc[item.product_id] || 0);
                                    const draftQty = Number(
                                      allocationDraft[item.product_id] !== undefined
                                        ? allocationDraft[item.product_id]
                                        : persistedQty
                                    );
                                    const stockQty = Number(product.stock_quantity);
                                    const maxAvailable = Number.isFinite(stockQty) ? stockQty + persistedQty : orderedQty;
                                    const maxAlloc = Math.min(orderedQty, Math.max(0, maxAvailable));
                                    const shortage = Math.max(0, orderedQty - draftQty);
                                    return (
                                      <div key={item.product_id} className="bg-white border border-slate-100 rounded-xl p-3">
                                        <div className="flex items-start justify-between gap-3">
                                          <div>
                                            <p className="text-xs font-bold text-slate-900">{product.name || 'Produk'}</p>
                                            <p className="text-[10px] text-slate-500">SKU: {product.sku || item.product_id}</p>
                                            <p className="text-[10px] text-slate-500">
                                              Pesan {orderedQty}
                                              {Number.isFinite(stockQty) && ` • Stok ${stockQty}`}
                                              {Number.isFinite(stockQty) && ` • Tersedia ${maxAvailable}`}
                                            </p>
                                            {shortage > 0 ? (
                                              <p className="text-[10px] font-bold text-rose-600">Kurang {shortage}</p>
                                            ) : (
                                              <p className="text-[10px] font-bold text-emerald-600">Alokasi penuh</p>
                                            )}
                                          </div>
                                          <div className="text-right">
                                            <p className="text-[10px] text-slate-400">Alokasi</p>
                                            <input
                                              type="number"
                                              min={0}
                                              max={maxAlloc}
                                              value={draftQty}
                                              disabled={!isAllocationEditable}
                                              onChange={(e) => handleAllocationChange(String(order.id), String(item.product_id), maxAlloc, e.target.value)}
                                              className="w-20 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-right"
                                            />
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}

                          {section !== 'selesai' && detail ? (
                            <div className="mt-3 space-y-2">
                              {(detail.OrderItems || []).map((item: any) => {
                                const availabilityItem = availability[String(item.id)] || { allocQty: 0, maxInvoice: 0 };
                                const maxInvoice = availabilityItem.maxInvoice;
                                const orderedQty = Number(item.qty || 0);
                                const allocQty = Number(availabilityItem.allocQty || 0);
                                const remainingQty = Math.max(0, orderedQty - allocQty);
                                const allocPct = orderedQty > 0 ? Math.round((allocQty / orderedQty) * 100) : 0;
                                return (
                                  <div key={item.id} className="border border-slate-100 rounded-xl p-3">
                                    <div className="flex items-start justify-between gap-3">
                                      <div>
                                        <p className="text-xs font-bold text-slate-900">{item.Product?.name || 'Produk'}</p>
                                        <p className="text-[10px] text-slate-500">SKU: {item.Product?.sku || '-'}</p>
                                        <p className="text-[10px] text-slate-500">
                                          Order {orderedQty} • Alokasi {allocQty}/{orderedQty}
                                          {orderedQty > 0 ? ` (${allocPct}%)` : ''}
                                          {remainingQty > 0 ? ` • Sisa ${remainingQty}` : ''}
                                          {maxInvoice > 0 ? ` • Bisa invoice ${maxInvoice}` : ''}
                                        </p>
                                      </div>
                                      <div className="text-right">
                                        <p className="text-[10px] text-slate-400">Harga</p>
                                        <p className="text-xs font-black text-slate-900">{formatCurrency(Number(item.price_at_purchase || 0))}</p>
                                      </div>
                                    </div>
                                    {maxInvoice <= 0 && (
                                      <div className="mt-2 text-[10px] text-slate-400">Belum ada alokasi</div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : section !== 'selesai' ? (
                            <div className="mt-3 text-[11px] text-slate-400">Detail item belum tersedia.</div>
                          ) : (
                            <div className="mt-3 text-[11px] text-slate-400">Order selesai.</div>
                          )}

                          {detail && hasInvoice && backorderItems.length > 0 && (
                            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
                              <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Backorder (Order yang sama)</p>
                              <p className="text-[11px] text-amber-700 mt-1">
                                Barang berikut belum teralokasi, tetap di ID order yang sama.
                              </p>
                              <div className="mt-2 space-y-2">
                                {backorderItems.map((item) => (
                                  <div key={item.product_id} className="rounded-xl border border-amber-100 bg-white/70 p-2">
                                    <p className="text-xs font-bold text-amber-800">{item.name}</p>
                                    <p className="text-[10px] text-amber-700">
                                      SKU {item.sku} • Order {item.orderedQty} • Alokasi {item.allocatedQty} • Kurang {item.shortageQty}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </>
          ) : (
            <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-6 text-center text-slate-400">
              <Package size={24} className="mx-auto mb-2" />
              Pilih customer untuk melihat order.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
