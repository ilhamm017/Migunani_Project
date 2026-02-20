'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ChevronRight, Package, Search, Users } from 'lucide-react';
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

type OrderSection = 'baru' | 'backorder' | 'pembayaran' | 'gudang' | 'selesai';
type OrderSectionFilter = 'all' | OrderSection;

type BackorderSnapshotItem = {
  product_id: string;
  name: string;
  sku: string;
  orderedQty: number;
  allocatedQty: number;
  shortageQty: number;
  allocatableQty: number;
};

type BackorderSnapshot = {
  snapshotId: string;
  createdAt: string;
  summary: {
    orderedTotal: number;
    suppliedTotal: number;
    shortageTotal: number;
    allocatableTotal: number;
  };
  items: BackorderSnapshotItem[];
};

type BackorderEditableItem = BackorderSnapshotItem;
type WarehouseInvoiceBucket = {
  groupKey: string;
  invoiceId: string;
  invoiceNumber: string;
  orders: any[];
};
type InvoiceItemSummary = {
  totalQty: number;
  totalSku: number;
  qtyByOrderId: Record<string, number>;
  skuByOrderId: Record<string, number>;
};
type InvoiceStatusSnapshot = {
  groupKey: string;
  invoiceId: string;
  invoiceNumber: string;
  orderIds: string[];
  totalQty: number | null;
  totalAmount: number;
  paymentStatus: string;
  shipmentStatus: string;
  hasMissingInvoiceDetail: boolean;
  hasMissingInvoiceSummary: boolean;
  latestTs: number;
};

const COMPLETED_STATUSES = new Set(['completed', 'canceled', 'expired']);
const PAYMENT_STATUSES = new Set(['waiting_admin_verification']);
const WAREHOUSE_STATUSES = new Set(['allocated', 'partially_fulfilled', 'ready_to_ship', 'waiting_payment', 'processing', 'shipped', 'hold']);
const ALLOCATION_EDITABLE_STATUSES = new Set(['pending', 'allocated', 'partially_fulfilled', 'debt_pending', 'hold']);
const BACKORDER_REALLOCATABLE_STATUSES = new Set(['pending', 'waiting_invoice', 'allocated', 'partially_fulfilled', 'debt_pending', 'hold', 'delivered']);
const BACKORDER_FALLBACK_STATUSES = new Set(['partially_fulfilled', 'hold']);
const ORDER_FILTER_OPTIONS_ALL: OrderSectionFilter[] = ['all', 'baru', 'backorder', 'pembayaran', 'gudang', 'selesai'];
const ORDER_FILTER_OPTIONS_WAREHOUSE: OrderSectionFilter[] = ['all', 'baru', 'pembayaran', 'gudang', 'selesai'];
const ORDER_SECTION_OPTIONS_ALL: OrderSection[] = ['baru', 'backorder', 'pembayaran', 'gudang', 'selesai'];
const ORDER_SECTION_OPTIONS_WAREHOUSE: OrderSection[] = ['baru', 'pembayaran', 'gudang', 'selesai'];
const getSectionFilterLabel = (filter: OrderSectionFilter) => {
  if (filter === 'all') return 'Semua';
  if (filter === 'baru') return 'Order Baru';
  if (filter === 'backorder') return 'Backorder';
  if (filter === 'pembayaran') return 'Menunggu Bayar';
  if (filter === 'gudang') return 'Proses Gudang';
  return 'Selesai';
};
const getSectionLabel = (section: OrderSection) => {
  if (section === 'baru') return 'Order Baru';
  if (section === 'backorder') return 'Backorder';
  if (section === 'pembayaran') return 'Menunggu Pembayaran';
  if (section === 'gudang') return 'Proses Gudang';
  return 'Selesai';
};
const normalizeInvoiceRef = (raw: unknown) => String(raw || '').trim();
const invoiceGroupKeyForOrder = (order: any) => {
  const invoiceId = normalizeInvoiceRef(order?.invoice_id || order?.Invoice?.id);
  if (invoiceId) return `id:${invoiceId}`;
  const invoiceNumber = normalizeInvoiceRef(order?.invoice_number || order?.Invoice?.invoice_number).toLowerCase();
  if (invoiceNumber) return `num:${invoiceNumber}`;
  return '';
};
const normalizeOrderStatus = (raw: unknown) => {
  const status = String(raw || '').trim();
  return status === 'waiting_payment' ? 'ready_to_ship' : status;
};
const isSettlementCompleted = (order: any, detail: any) => {
  const invoice = detail?.Invoice || order?.Invoice || null;
  const paymentMethod = String(invoice?.payment_method || order?.payment_method || '').trim().toLowerCase();
  const paymentStatus = String(invoice?.payment_status || '').trim().toLowerCase();

  if (paymentMethod === 'cod') return paymentStatus === 'cod_pending' || paymentStatus === 'paid';
  if (paymentMethod === 'transfer_manual') return paymentStatus === 'paid';
  if (paymentMethod === 'cash_store') return paymentStatus === 'paid';
  return false;
};
const paymentStatusLabel = (raw: unknown) => {
  const status = String(raw || '').trim().toLowerCase();
  if (status === 'mixed') return 'Gabungan';
  if (status === 'draft') return 'Draft';
  if (status === 'unpaid') return 'Belum Bayar';
  if (status === 'cod_pending') return 'COD Pending';
  if (status === 'paid') return 'Lunas';
  return '-';
};
const paymentStatusBadge = (raw: unknown) => {
  const status = String(raw || '').trim().toLowerCase();
  if (status === 'mixed') return 'bg-violet-100 text-violet-700 border-violet-200';
  if (status === 'paid') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (status === 'cod_pending') return 'bg-amber-100 text-amber-700 border-amber-200';
  if (status === 'unpaid' || status === 'draft') return 'bg-slate-100 text-slate-700 border-slate-200';
  return 'bg-slate-100 text-slate-500 border-slate-200';
};
const shipmentStatusLabel = (raw: unknown) => {
  const status = String(raw || '').trim().toLowerCase();
  if (status === 'mixed') return 'Gabungan';
  if (status === 'ready_to_ship') return 'Siap Kirim';
  if (status === 'shipped') return 'Dikirim';
  if (status === 'delivered') return 'Terkirim';
  if (status === 'canceled') return 'Dibatalkan';
  if (status === 'hold') return 'Ditahan';
  return '-';
};
const shipmentStatusBadge = (raw: unknown) => {
  const status = String(raw || '').trim().toLowerCase();
  if (status === 'mixed') return 'bg-violet-100 text-violet-700 border-violet-200';
  if (status === 'delivered') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (status === 'shipped') return 'bg-blue-100 text-blue-700 border-blue-200';
  if (status === 'ready_to_ship') return 'bg-indigo-100 text-indigo-700 border-indigo-200';
  if (status === 'canceled') return 'bg-rose-100 text-rose-700 border-rose-200';
  if (status === 'hold') return 'bg-violet-100 text-violet-700 border-violet-200';
  return 'bg-slate-100 text-slate-500 border-slate-200';
};
const formatInvoiceReference = (invoiceId: string, invoiceNumber: string) => {
  if (invoiceNumber) return invoiceNumber;
  if (invoiceId) return `INV-${invoiceId.slice(-8).toUpperCase()}`;
  return 'Belum Terbit Invoice';
};

const buildInvoiceItemSummary = (invoiceData: any): InvoiceItemSummary => {
  const items = Array.isArray(invoiceData?.InvoiceItems)
    ? invoiceData.InvoiceItems
    : Array.isArray(invoiceData?.Items)
      ? invoiceData.Items
      : [];

  const qtyByOrderId: Record<string, number> = {};
  const skuSetsByOrderId = new Map<string, Set<string>>();
  const skuSetGlobal = new Set<string>();
  let totalQty = 0;

  items.forEach((item: any) => {
    const orderId = String(item?.OrderItem?.order_id || item?.order_id || '').trim();
    const productId = String(item?.OrderItem?.product_id || item?.product_id || '').trim();
    const qty = Number(item?.qty || 0);
    if (!orderId || !productId || qty <= 0) return;

    qtyByOrderId[orderId] = Number(qtyByOrderId[orderId] || 0) + qty;
    totalQty += qty;

    const orderSkuSet = skuSetsByOrderId.get(orderId) || new Set<string>();
    orderSkuSet.add(productId);
    skuSetsByOrderId.set(orderId, orderSkuSet);
    skuSetGlobal.add(productId);
  });

  const skuByOrderId: Record<string, number> = {};
  skuSetsByOrderId.forEach((set, orderId) => {
    skuByOrderId[orderId] = set.size;
  });

  return {
    totalQty,
    totalSku: skuSetGlobal.size,
    qtyByOrderId,
    skuByOrderId,
  };
};

const hasAllocationShortage = (detail: any): boolean => {
  if (!detail) return false;
  const items = Array.isArray(detail.OrderItems) ? detail.OrderItems : [];
  const allocations = Array.isArray(detail.Allocations) ? detail.Allocations : [];
  if (items.length === 0) return false;
  const hasAnyAllocatedQty = allocations.some((allocation: any) => Number(allocation?.allocated_qty || 0) > 0);
  if (!hasAnyAllocatedQty) return false;

  const orderedByProduct = new Map<string, number>();
  items.forEach((item: any) => {
    const key = String(item?.product_id || '');
    if (!key) return;
    orderedByProduct.set(key, Number(orderedByProduct.get(key) || 0) + Number(item?.qty || 0));
  });

  const allocatedByProduct = new Map<string, number>();
  allocations.forEach((allocation: any) => {
    const key = String(allocation?.product_id || '');
    if (!key) return;
    allocatedByProduct.set(key, Number(allocatedByProduct.get(key) || 0) + Number(allocation?.allocated_qty || 0));
  });

  for (const [productId, orderedQty] of orderedByProduct.entries()) {
    if (Number(allocatedByProduct.get(productId) || 0) < Number(orderedQty || 0)) return true;
  }
  return false;
};

const hasExplicitBackorderFlag = (order: any): boolean => {
  const raw = order?.is_backorder ?? order?.isBackorder;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw === 1;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }
  return false;
};

const isOrderBackorder = (order: any, detail: any, backorderIds: Set<string>): boolean => {
  if (hasAllocationShortage(detail)) return true;
  if (hasExplicitBackorderFlag(order)) return true;
  const status = String(order?.status || '');
  const orderId = String(order?.id || '');
  return backorderIds.has(orderId) && BACKORDER_FALLBACK_STATUSES.has(status);
};

const buildBackorderSnapshotFromDetail = (detail: any): BackorderSnapshot | null => {
  const orderId = String(detail?.id || '');
  if (!orderId) return null;
  const orderItems = Array.isArray(detail.OrderItems) ? detail.OrderItems : [];
  const allocations = Array.isArray(detail.Allocations) ? detail.Allocations : [];
  if (orderItems.length === 0) return null;

  const orderedByProduct = new Map<string, { qty: number; name: string; sku: string; stockQty: number }>();
  orderItems.forEach((item: any) => {
    const productId = String(item?.product_id || '');
    if (!productId) return;
    const product = item?.Product || {};
    const stockQty = Number(product?.stock_quantity);
    const prev = orderedByProduct.get(productId);
    if (prev) {
      prev.qty += Number(item?.qty || 0);
    } else {
      orderedByProduct.set(productId, {
        qty: Number(item?.qty || 0),
        name: String(product?.name || 'Produk'),
        sku: String(product?.sku || productId),
        stockQty: Number.isFinite(stockQty) ? stockQty : Number.NaN,
      });
    }
  });

  const allocatedByProduct = new Map<string, number>();
  allocations.forEach((allocation: any) => {
    const productId = String(allocation?.product_id || '');
    if (!productId) return;
    allocatedByProduct.set(productId, Number(allocatedByProduct.get(productId) || 0) + Number(allocation?.allocated_qty || 0));
  });

  const snapshotItems: BackorderSnapshotItem[] = [];
  orderedByProduct.forEach((meta, productId) => {
    const orderedQty = Number(meta.qty || 0);
    const allocatedQty = Number(allocatedByProduct.get(productId) || 0);
    const shortageQty = Math.max(0, orderedQty - allocatedQty);
    if (shortageQty <= 0) return;
    const maxAvailable = Number.isFinite(meta.stockQty) ? meta.stockQty + allocatedQty : orderedQty;
    const maxAlloc = Math.min(orderedQty, Math.max(0, maxAvailable));
    const allocatableQty = Math.max(0, Math.min(shortageQty, maxAlloc - allocatedQty));
    snapshotItems.push({
      product_id: productId,
      name: meta.name,
      sku: meta.sku,
      orderedQty,
      allocatedQty,
      shortageQty,
      allocatableQty,
    });
  });

  if (snapshotItems.length === 0) return null;

  const summary = snapshotItems.reduce(
    (acc, item) => ({
      orderedTotal: acc.orderedTotal + item.orderedQty,
      suppliedTotal: acc.suppliedTotal + item.allocatedQty,
      shortageTotal: acc.shortageTotal + item.shortageQty,
      allocatableTotal: acc.allocatableTotal + item.allocatableQty,
    }),
    { orderedTotal: 0, suppliedTotal: 0, shortageTotal: 0, allocatableTotal: 0 }
  );

  return {
    snapshotId: `${orderId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    summary,
    items: snapshotItems,
  };
};

const isSameBackorderSnapshot = (current: BackorderSnapshot, incoming: BackorderSnapshot): boolean => {
  if (current.summary.shortageTotal !== incoming.summary.shortageTotal) return false;
  if (current.items.length !== incoming.items.length) return false;
  const currentMap = new Map(current.items.map((item) => [item.product_id, item]));
  return incoming.items.every((item) => {
    const oldItem = currentMap.get(item.product_id);
    if (!oldItem) return false;
    return oldItem.shortageQty === item.shortageQty && oldItem.allocatedQty === item.allocatedQty;
  });
};

export default function AdminOrdersPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'admin_finance', 'kasir']);
  const { user } = useAuthStore();
  const canIssueInvoice = useMemo(() => ['super_admin', 'kasir'].includes(user?.role || ''), [user?.role]);
  const canAllocate = useMemo(() => ['super_admin', 'kasir'].includes(user?.role || ''), [user?.role]);
  const canViewAllocation = useMemo(() => ['super_admin', 'kasir', 'admin_gudang'].includes(user?.role || ''), [user?.role]);
  const canManageWarehouseFlow = useMemo(() => ['super_admin', 'admin_gudang'].includes(user?.role || ''), [user?.role]);
  const isFinanceRole = useMemo(() => user?.role === 'admin_finance', [user?.role]);
  const isWarehouseRole = useMemo(() => user?.role === 'admin_gudang', [user?.role]);
  const [orders, setOrders] = useState<any[]>([]);
  const [backorderIds, setBackorderIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [selectedCustomerKey, setSelectedCustomerKey] = useState<string | null>(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerFilter, setCustomerFilter] = useState<OrderSectionFilter>('all');
  const [orderQuery, setOrderQuery] = useState('');
  const [orderSectionFilter, setOrderSectionFilter] = useState<OrderSectionFilter>('all');
  const [orderDetails, setOrderDetails] = useState<Record<string, any>>({});
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [allocationDrafts, setAllocationDrafts] = useState<Record<string, Record<string, number>>>({});
  const [backorderHistoryByOrderId, setBackorderHistoryByOrderId] = useState<Record<string, BackorderSnapshot[]>>({});
  const [backorderTopupDrafts, setBackorderTopupDrafts] = useState<Record<string, Record<string, number>>>({});
  const [allocationSaving, setAllocationSaving] = useState<Record<string, boolean>>({});
  const [invoiceItemSummaryByInvoiceId, setInvoiceItemSummaryByInvoiceId] = useState<Record<string, InvoiceItemSummary | null>>({});
  const [invoiceDetailByInvoiceId, setInvoiceDetailByInvoiceId] = useState<Record<string, any | null>>({});
  const [busyInvoice, setBusyInvoice] = useState(false);
  const sectionFilterOptions = useMemo<OrderSectionFilter[]>(
    () => (isWarehouseRole ? ORDER_FILTER_OPTIONS_WAREHOUSE : ORDER_FILTER_OPTIONS_ALL),
    [isWarehouseRole]
  );
  const sectionOptions = useMemo<OrderSection[]>(
    () => (isWarehouseRole ? ORDER_SECTION_OPTIONS_WAREHOUSE : ORDER_SECTION_OPTIONS_ALL),
    [isWarehouseRole]
  );

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

  const classifyOrderSection = useCallback((order: any, detail: any): 'baru' | 'backorder' | 'pembayaran' | 'gudang' | 'selesai' => {
    const rawStatus = String(order?.status || '');
    const normalizedStatus = normalizeOrderStatus(rawStatus);
    const isCompleted = COMPLETED_STATUSES.has(rawStatus);
    const isPayment = PAYMENT_STATUSES.has(rawStatus);
    const isWarehouse = WAREHOUSE_STATUSES.has(normalizedStatus);
    const isBackorder = isOrderBackorder(order, detail, backorderIds);
    const isDelivered = normalizedStatus === 'delivered';
    const isPaidByRule = isSettlementCompleted(order, detail);

    // Untuk role gudang, status proses gudang diprioritaskan agar fokus ke proses kirim per-invoice.
    if (isWarehouseRole && isWarehouse) return 'gudang';
    if (isBackorder) return 'backorder';
    if (isCompleted) return 'selesai';
    if (isDelivered) return isPaidByRule ? 'selesai' : 'pembayaran';
    if (isPayment) return 'pembayaran';
    if (isWarehouse) return 'gudang';
    return 'baru';
  }, [backorderIds, isWarehouseRole]);

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

      const detail = orderDetails[String(order.id)];
      const section = classifyOrderSection(order, detail);
      group.counts[section] += 1;

      group.orders.push(order);
      map.set(key, group);
    });

    return Array.from(map.values()).sort((a, b) => {
      const aCount = a.counts.baru + a.counts.backorder + a.counts.pembayaran + a.counts.gudang + a.counts.selesai;
      const bCount = b.counts.baru + b.counts.backorder + b.counts.pembayaran + b.counts.gudang + b.counts.selesai;
      return bCount - aCount;
    });
  }, [orders, orderDetails, classifyOrderSection]);

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
    if (isWarehouseRole && customerFilter === 'backorder') return searched;
    return searched.filter((group) => group.counts[customerFilter] > 0);
  }, [customerGroups, customerQuery, customerFilter, isWarehouseRole]);

  const selectedGroup = useMemo(() => {
    if (!selectedCustomerKey) return null;
    return customerGroups.find((group) => group.key === selectedCustomerKey) || null;
  }, [customerGroups, selectedCustomerKey]);

  const groupedOrders = useMemo(() => {
    const group = selectedGroup;
    if (!group) return { baru: [], backorder: [], pembayaran: [], gudang: [], selesai: [] };
    const result = { baru: [] as any[], backorder: [] as any[], pembayaran: [] as any[], gudang: [] as any[], selesai: [] as any[] };
    const getRecencyTs = (order: any) => {
      const updatedTs = Date.parse(String(order?.updatedAt || ''));
      if (Number.isFinite(updatedTs)) return updatedTs;
      const createdTs = Date.parse(String(order?.createdAt || ''));
      if (Number.isFinite(createdTs)) return createdTs;
      return 0;
    };

    group.orders.forEach((order: any) => {
      const detail = orderDetails[String(order.id)];
      const section = classifyOrderSection(order, detail);
      result[section].push(order);
    });

    // Prioritaskan backorder terbaru di urutan teratas setelah alokasi berubah.
    result.backorder.sort((a: any, b: any) => {
      const diff = getRecencyTs(b) - getRecencyTs(a);
      if (diff !== 0) return diff;
      const aId = Number(a?.id);
      const bId = Number(b?.id);
      if (Number.isFinite(aId) && Number.isFinite(bId)) return bId - aId;
      return String(b?.id || '').localeCompare(String(a?.id || ''));
    });

    return result;
  }, [selectedGroup, orderDetails, classifyOrderSection]);

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
    const targetOrders = [...groupedOrders.baru, ...groupedOrders.backorder, ...groupedOrders.pembayaran, ...groupedOrders.gudang, ...groupedOrders.selesai];
    const missingDetails = targetOrders.filter((order) => !orderDetails[String(order.id)]);
    void loadOrderDetails(missingDetails);
  }, [groupedOrders.baru, groupedOrders.backorder, groupedOrders.pembayaran, groupedOrders.gudang, groupedOrders.selesai, selectedGroup, orderDetails, loadOrderDetails]);

  useEffect(() => {
    if (!selectedGroup) return;
    const targetOrders = [...groupedOrders.baru, ...groupedOrders.backorder, ...groupedOrders.pembayaran, ...groupedOrders.gudang, ...groupedOrders.selesai];
    const invoiceIds = Array.from(new Set(
      targetOrders
        .map((order) => {
          const detail = orderDetails[String(order.id)];
          return normalizeInvoiceRef(order?.invoice_id || order?.Invoice?.id || detail?.invoice_id || detail?.Invoice?.id);
        })
        .filter(Boolean)
    ));
    const toLoad = invoiceIds.filter(
      (invoiceId) =>
        invoiceItemSummaryByInvoiceId[invoiceId] === undefined
        || invoiceDetailByInvoiceId[invoiceId] === undefined
    );
    if (toLoad.length === 0) return;

    void (async () => {
      try {
        const responses = await Promise.allSettled(toLoad.map((invoiceId) => api.invoices.getById(invoiceId)));
        const summaryNext: Record<string, InvoiceItemSummary | null> = {};
        const detailNext: Record<string, any | null> = {};
        responses.forEach((result, idx) => {
          const invoiceId = toLoad[idx];
          if (result.status === 'fulfilled') {
            const data = result.value?.data || {};
            summaryNext[invoiceId] = buildInvoiceItemSummary(data);
            detailNext[invoiceId] = data;
          } else {
            summaryNext[invoiceId] = null;
            detailNext[invoiceId] = null;
          }
        });
        setInvoiceItemSummaryByInvoiceId((prev) => ({ ...prev, ...summaryNext }));
        setInvoiceDetailByInvoiceId((prev) => ({ ...prev, ...detailNext }));
      } catch {
        // ignore hard failure: card will fallback to allocation-based summary
      }
    })();
  }, [selectedGroup, groupedOrders.baru, groupedOrders.backorder, groupedOrders.pembayaran, groupedOrders.gudang, groupedOrders.selesai, orderDetails, invoiceDetailByInvoiceId, invoiceItemSummaryByInvoiceId]);

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

  const visibleOrdersForInvoiceBoard = useMemo(() => {
    if (orderSectionFilter === 'all') {
      return sectionOptions.flatMap((section) => filteredGroupedOrders[section]);
    }
    if (isWarehouseRole && orderSectionFilter === 'backorder') return [];
    return filteredGroupedOrders[orderSectionFilter] || [];
  }, [filteredGroupedOrders, isWarehouseRole, orderSectionFilter, sectionOptions]);

  useEffect(() => {
    if (!isWarehouseRole) return;
    if (customerFilter === 'backorder') setCustomerFilter('all');
    if (orderSectionFilter === 'backorder') setOrderSectionFilter('all');
  }, [isWarehouseRole, customerFilter, orderSectionFilter]);

  const invoiceStatusBoard = useMemo<InvoiceStatusSnapshot[]>(() => {
    const boardMap = new Map<
      string,
      {
        groupKey: string;
        invoiceId: string;
        invoiceNumber: string;
        orderIds: Set<string>;
        totalQty: number | null;
        totalAmount: number;
        paymentStatuses: Set<string>;
        shipmentStatuses: Set<string>;
        hasMissingInvoiceDetail: boolean;
        hasMissingInvoiceSummary: boolean;
        latestTs: number;
      }
    >();

    visibleOrdersForInvoiceBoard.forEach((order: any) => {
      const rowId = String(order?.id || '').trim();
      if (!rowId) return;
      const detail = orderDetails[rowId];
      const invoiceId = normalizeInvoiceRef(order?.invoice_id || order?.Invoice?.id || detail?.invoice_id || detail?.Invoice?.id);
      const invoiceNumber = normalizeInvoiceRef(
        order?.invoice_number || order?.Invoice?.invoice_number || detail?.invoice_number || detail?.Invoice?.invoice_number
      );
      const groupKey = invoiceId
        ? `id:${invoiceId}`
        : invoiceNumber
          ? `num:${invoiceNumber.toLowerCase()}`
          : 'no-invoice';
      const current = boardMap.get(groupKey) || {
        groupKey,
        invoiceId,
        invoiceNumber,
        orderIds: new Set<string>(),
        totalQty: null as number | null,
        totalAmount: 0,
        paymentStatuses: new Set<string>(),
        shipmentStatuses: new Set<string>(),
        hasMissingInvoiceDetail: false,
        hasMissingInvoiceSummary: false,
        latestTs: 0,
      };
      current.orderIds.add(rowId);
      current.totalAmount += Number(order?.total_amount || 0);

      const rowTs = Date.parse(String(order?.updatedAt || order?.createdAt || ''));
      if (Number.isFinite(rowTs)) current.latestTs = Math.max(current.latestTs, rowTs);

      if (invoiceId) {
        const invoiceSummary = invoiceItemSummaryByInvoiceId[invoiceId];
        if (invoiceSummary === undefined) {
          current.hasMissingInvoiceSummary = true;
        } else if (invoiceSummary && Number.isFinite(invoiceSummary.totalQty)) {
          current.totalQty = Number(invoiceSummary.totalQty || 0);
        }

        const invoiceDetail = invoiceDetailByInvoiceId[invoiceId];
        if (invoiceDetail === undefined) {
          current.hasMissingInvoiceDetail = true;
        }
        const paymentStatus = String(
          invoiceDetail?.payment_status || order?.Invoice?.payment_status || detail?.Invoice?.payment_status || ''
        ).trim().toLowerCase();
        const shipmentStatus = String(
          invoiceDetail?.shipment_status || order?.Invoice?.shipment_status || detail?.Invoice?.shipment_status || ''
        ).trim().toLowerCase();
        if (paymentStatus) current.paymentStatuses.add(paymentStatus);
        if (shipmentStatus) current.shipmentStatuses.add(shipmentStatus);
      }

      boardMap.set(groupKey, current);
    });

    return Array.from(boardMap.values())
      .map((bucket) => {
        const paymentStatus = bucket.paymentStatuses.size === 1
          ? Array.from(bucket.paymentStatuses)[0]
          : bucket.paymentStatuses.size > 1
            ? 'mixed'
            : '';
        const shipmentStatus = bucket.shipmentStatuses.size === 1
          ? Array.from(bucket.shipmentStatuses)[0]
          : bucket.shipmentStatuses.size > 1
            ? 'mixed'
            : '';
        return {
          groupKey: bucket.groupKey,
          invoiceId: bucket.invoiceId,
          invoiceNumber: bucket.invoiceNumber,
          orderIds: Array.from(bucket.orderIds),
          totalQty: bucket.totalQty,
          totalAmount: bucket.totalAmount,
          paymentStatus,
          shipmentStatus,
          hasMissingInvoiceDetail: bucket.hasMissingInvoiceDetail,
          hasMissingInvoiceSummary: bucket.hasMissingInvoiceSummary,
          latestTs: bucket.latestTs,
        };
      })
      .sort((a, b) => b.latestTs - a.latestTs);
  }, [invoiceDetailByInvoiceId, invoiceItemSummaryByInvoiceId, orderDetails, visibleOrdersForInvoiceBoard]);

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
    const normalized = Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
    const nextQty = Math.max(0, Math.min(maxQty, normalized));
    setAllocationDrafts((prev) => ({
      ...prev,
      [orderId]: {
        ...(prev[orderId] || {}),
        [productId]: nextQty
      }
    }));
  };

  const handleBackorderTopupChange = (orderId: string, productId: string, maxQty: number, rawValue: string) => {
    const parsed = Number(rawValue);
    const normalized = Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
    const nextQty = Math.max(0, Math.min(maxQty, normalized));
    setBackorderTopupDrafts((prev) => ({
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

  const buildAllocationPayload = (orderId: string, draft: Record<string, number>) => {
    const groupedItems = groupedItemsByOrderId[orderId] || [];
    const persistedAlloc = persistedAllocByOrderId[orderId] || {};
    const payload: Array<{ product_id: string; qty: number }> = [];

    groupedItems.forEach((item) => {
      const productId = String(item.product_id || '');
      if (!productId) return;
      const orderedQty = Math.max(0, Math.trunc(Number(item.qty || 0)));
      const persistedQty = Math.max(0, Math.trunc(Number(persistedAlloc[productId] || 0)));
      const requestedQtyRaw = draft[productId] !== undefined ? draft[productId] : persistedQty;
      const requestedQty = Math.max(0, Math.trunc(Number(requestedQtyRaw || 0)));
      const stockQtyRaw = Number(item?.Product?.stock_quantity);
      const stockQty = Number.isFinite(stockQtyRaw) ? Math.max(0, Math.trunc(stockQtyRaw)) : 0;
      const maxByStock = persistedQty + stockQty;
      const maxAllowed = Math.max(0, Math.min(orderedQty, maxByStock));
      const finalQty = Math.max(0, Math.min(maxAllowed, requestedQty));
      payload.push({ product_id: productId, qty: finalQty });
    });

    return payload;
  };

  const saveAllocationDraft = async (orderId: string, draft: Record<string, number>, confirmMessage: string) => {
    if (!confirm(confirmMessage)) return false;
    const items = buildAllocationPayload(orderId, draft);
    if (items.length === 0) {
      alert('Tidak ada item alokasi yang valid untuk disimpan.');
      return false;
    }
    setAllocationDrafts((prev) => ({
      ...prev,
      [orderId]: items.reduce<Record<string, number>>((acc, item) => {
        acc[item.product_id] = item.qty;
        return acc;
      }, {})
    }));
    try {
      setAllocationSaving((prev) => ({ ...prev, [orderId]: true }));
      await api.allocation.allocate(orderId, items);
      const refreshed = await api.orders.getOrderById(orderId);
      const detail = refreshed.data;
      if (detail?.id) {
        const nextOrderId = String(detail.id);
        setOrderDetails((prev) => ({ ...prev, [nextOrderId]: detail }));
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
        setAllocationDrafts((prev) => ({ ...prev, [nextOrderId]: draft }));

        const snapshot = buildBackorderSnapshotFromDetail(detail);
        setBackorderHistoryByOrderId((prev) => {
          const existing = prev[nextOrderId] || [];
          if (!snapshot) {
            if (existing.length === 0) return prev;
            return { ...prev, [nextOrderId]: [] };
          }
          const latest = existing[0];
          if (latest && isSameBackorderSnapshot(latest, snapshot)) return prev;
          return { ...prev, [nextOrderId]: [snapshot, ...existing] };
        });
      }
      await loadOrders();
      return true;
    } catch (error: any) {
      console.error('Allocation save failed:', error);
      alert(error?.response?.data?.message || 'Gagal menyimpan alokasi.');
      return false;
    } finally {
      setAllocationSaving((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  const handleSaveAllocation = async (orderId: string) => {
    const draft = allocationDrafts[orderId] || {};
    await saveAllocationDraft(orderId, draft, `Selesaikan alokasi untuk order #${orderId}?`);
  };

  const handleAutoFillBackorder = (orderId: string, backorderItems: BackorderEditableItem[]) => {
    if (allocationSaving[orderId]) return;
    setBackorderTopupDrafts((prev) => {
      const next = { ...(prev[orderId] || {}) };
      backorderItems.forEach((item) => {
        next[item.product_id] = Number(item.allocatableQty || 0);
      });
      return { ...prev, [orderId]: next };
    });
  };

  const handleSaveBackorderAllocation = async (orderId: string, backorderItems: BackorderEditableItem[]) => {
    if (allocationSaving[orderId]) return;
    const groupedItems = groupedItemsByOrderId[orderId] || [];
    const persisted = persistedAllocByOrderId[orderId] || {};
    const currentDraft = allocationDrafts[orderId] || {};
    const topupDraft = backorderTopupDrafts[orderId] || {};

    const nextDraft: Record<string, number> = { ...currentDraft };
    groupedItems.forEach((item) => {
      const key = String(item.product_id || '');
      if (!key) return;
      if (nextDraft[key] === undefined) nextDraft[key] = Number(persisted[key] || 0);
    });

    let totalTopup = 0;
    backorderItems.forEach((item) => {
      const requestedTopup = Number(topupDraft[item.product_id] || 0);
      const topupQty = Math.max(0, Math.min(item.allocatableQty, requestedTopup));
      if (topupQty <= 0) return;
      const currentAllocated = Number(nextDraft[item.product_id] || 0);
      nextDraft[item.product_id] = currentAllocated + topupQty;
      totalTopup += topupQty;
    });

    if (totalTopup <= 0) return;

    const saved = await saveAllocationDraft(
      orderId,
      nextDraft,
      `Selesaikan alokasi backorder ${totalTopup} item untuk order #${orderId}?`
    );
    if (!saved) return;
    setBackorderTopupDrafts((prev) => ({
      ...prev,
      [orderId]: {}
    }));
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
              {sectionFilterOptions.map((filter) => {
                const label = getSectionFilterLabel(filter);
                const active = customerFilter === filter;
                return (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setCustomerFilter(filter)}
                    className={`px-2 py-1 rounded-full text-[10px] font-bold border ${active ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'
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
                  className={`w-full text-left border rounded-2xl p-3 transition-all ${isActive ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 bg-white hover:bg-slate-50'
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
                    {!isWarehouseRole && (
                      <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700">Backorder {group.counts.backorder}</span>
                    )}
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
                  {sectionFilterOptions.map((filter) => {
                    const label = getSectionFilterLabel(filter);
                    const active = orderSectionFilter === filter;
                    return (
                      <button
                        key={filter}
                        type="button"
                        onClick={() => setOrderSectionFilter(filter)}
                        className={`px-2 py-1 rounded-full text-[10px] font-bold border ${active ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'
                          }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Ringkasan Status Invoice</h2>
                {invoiceStatusBoard.length === 0 ? (
                  <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                    <p className="text-xs text-slate-500">Belum ada invoice pada daftar order ini.</p>
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {invoiceStatusBoard.map((row) => {
                      const invoiceRef = formatInvoiceReference(row.invoiceId, row.invoiceNumber);
                      const isNoInvoice = !row.invoiceId && !row.invoiceNumber;
                      return (
                        <div key={row.groupKey} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                {isNoInvoice ? 'Belum Terbit Invoice' : 'Invoice'}
                              </p>
                              <p className="text-sm font-black text-slate-900">{invoiceRef}</p>
                              <p className="text-[11px] text-slate-500">{row.orderIds.length} order</p>
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] text-slate-500">Nilai</p>
                              <p className="text-xs font-black text-slate-900">{formatCurrency(row.totalAmount)}</p>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span className={`px-2 py-1 rounded-full border text-[10px] font-bold ${paymentStatusBadge(row.paymentStatus)}`}>
                              Bayar: {paymentStatusLabel(row.paymentStatus)}
                            </span>
                            <span className={`px-2 py-1 rounded-full border text-[10px] font-bold ${shipmentStatusBadge(row.shipmentStatus)}`}>
                              Kirim: {shipmentStatusLabel(row.shipmentStatus)}
                            </span>
                            <span className="px-2 py-1 rounded-full border border-blue-200 bg-blue-100 text-blue-700 text-[10px] font-bold">
                              Qty invoice: {row.totalQty === null ? '-' : row.totalQty}
                            </span>
                          </div>
                          {row.hasMissingInvoiceDetail && (
                            <p className="mt-2 text-[10px] text-slate-500">Status invoice sedang dimuat.</p>
                          )}
                          {row.hasMissingInvoiceSummary && (
                            <p className="mt-1 text-[10px] text-slate-500">Qty invoice sedang dimuat dari InvoiceItems.</p>
                          )}
                          {row.invoiceId ? (
                            <Link
                              href={`/admin/orders/${row.invoiceId}`}
                              className="inline-block mt-2 text-[10px] font-bold text-emerald-700"
                            >
                              Lihat Detail Invoice
                            </Link>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {detailsLoading && (
                <div className="text-xs text-slate-400">Memuat detail order...</div>
              )}

              {sectionOptions.map((section) => {
                if (orderSectionFilter !== 'all' && orderSectionFilter !== section) return null;
                const label = getSectionLabel(section);
                const list = filteredGroupedOrders[section];
                if (list.length === 0) return null;
                const isGudangCompactView = user?.role === 'admin_gudang';
                const isFinanceCompactView = isFinanceRole && ['pembayaran', 'gudang', 'selesai'].includes(section);
                const isInvoiceCompactView = isGudangCompactView || isFinanceCompactView;
                if (isInvoiceCompactView) {
                  const invoiceBuckets = list.reduce<Map<string, WarehouseInvoiceBucket>>((acc, row: any) => {
                    const rowId = String(row?.id || '');
                    if (!rowId) return acc;
                    const detail = orderDetails[rowId];
                    const invoiceId = normalizeInvoiceRef(row?.invoice_id || row?.Invoice?.id || detail?.invoice_id || detail?.Invoice?.id);
                    const invoiceNumber = normalizeInvoiceRef(
                      row?.invoice_number || row?.Invoice?.invoice_number || detail?.invoice_number || detail?.Invoice?.invoice_number
                    );
                    const groupKey = invoiceId ? `id:${invoiceId}` : invoiceNumber ? `num:${invoiceNumber.toLowerCase()}` : `order:${rowId}`;
                    const bucket: WarehouseInvoiceBucket = acc.get(groupKey) || {
                      groupKey,
                      invoiceId,
                      invoiceNumber,
                      orders: [],
                    };
                    bucket.orders.push(row);
                    acc.set(groupKey, bucket);
                    return acc;
                  }, new Map<string, WarehouseInvoiceBucket>());
                  const warehouseCards = Array.from(invoiceBuckets.values())
                    .map((bucket: WarehouseInvoiceBucket) => {
                      const invoiceSummary = bucket.invoiceId ? invoiceItemSummaryByInvoiceId[bucket.invoiceId] : undefined;
                      let allocatedQty = 0;
                      let totalAmount = 0;
                      let latestTs = 0;
                      let hasMissingDetails = false;
                      let hasMissingInvoiceSummary = false;
                      const allocatedSkuSet = new Set<string>();
                      const statusSet = new Set<string>();
                      const paymentMethodSet = new Set<string>();
                      const paymentStatusSet = new Set<string>();
                      bucket.orders.forEach((row: any) => {
                        const rowId = String(row?.id || '');
                        if (!rowId) return;
                        totalAmount += Number(row?.total_amount || 0);
                        const normalizedStatus = normalizeOrderStatus(row?.status);
                        if (normalizedStatus) statusSet.add(normalizedStatus);
                        const paymentMethod = String(row?.Invoice?.payment_method || '').trim();
                        if (paymentMethod) paymentMethodSet.add(paymentMethod);
                        const paymentStatus = String(row?.Invoice?.payment_status || '').trim();
                        if (paymentStatus) paymentStatusSet.add(paymentStatus);
                        const rowTs = Date.parse(String(row?.updatedAt || row?.createdAt || ''));
                        if (Number.isFinite(rowTs)) latestTs = Math.max(latestTs, rowTs);
                        if (invoiceSummary) {
                          allocatedQty += Number(invoiceSummary.qtyByOrderId[rowId] || 0);
                          const rowSkuCount = Number(invoiceSummary.skuByOrderId[rowId] || 0);
                          if (rowSkuCount > 0) {
                            // keep approximate set size using synthetic keys
                            for (let i = 0; i < rowSkuCount; i += 1) {
                              allocatedSkuSet.add(`${rowId}:${i}`);
                            }
                          }
                        } else {
                          if (invoiceSummary === undefined && bucket.invoiceId) {
                            hasMissingInvoiceSummary = true;
                          } else {
                            const totals = orderTotalsById[rowId];
                            if (totals && Number(totals.orderedQty || 0) > 0) {
                              const rowAllocated = Number(totals.allocQty || 0);
                              allocatedQty += Math.max(0, rowAllocated);
                            } else {
                              const detail = orderDetails[rowId];
                              if (!detail) {
                                hasMissingDetails = true;
                              } else {
                                const allocations = Array.isArray(detail.Allocations) ? detail.Allocations : [];
                                const rowAllocated = allocations.reduce((sum: number, alloc: any) => sum + Number(alloc?.allocated_qty || 0), 0);
                                allocatedQty += Math.max(0, rowAllocated);
                              }
                            }
                            const detail = orderDetails[rowId];
                            if (!detail) return;
                            const allocations = Array.isArray(detail.Allocations) ? detail.Allocations : [];
                            allocations.forEach((alloc: any) => {
                              const productId = String(alloc?.product_id || '');
                              const allocQty = Number(alloc?.allocated_qty || 0);
                              if (productId && allocQty > 0) allocatedSkuSet.add(productId);
                            });
                          }
                        }
                      });
                      if (invoiceSummary) {
                        allocatedQty = Number(invoiceSummary.totalQty || 0);
                      }
                      const orderIds = bucket.orders
                        .map((row: any) => String(row?.id || ''))
                        .filter(Boolean);
                      const previewIds = orderIds.slice(0, 3).map((id: string) => `#${id.slice(-8).toUpperCase()}`);
                      const extraOrderCount = Math.max(0, orderIds.length - previewIds.length);
                      const hasReadyToShip = bucket.orders.some((row: any) => normalizeOrderStatus(row?.status) === 'ready_to_ship');
                      const hasShipped = bucket.orders.some((row: any) => normalizeOrderStatus(row?.status) === 'shipped');
                      const primaryOrder =
                        bucket.orders.find((row: any) => normalizeOrderStatus(row?.status) === 'ready_to_ship') ||
                        bucket.orders[0] ||
                        null;
                      const primaryOrderId = String(primaryOrder?.id || '');
                      const statusLabel = statusSet.size <= 1 ? (Array.from(statusSet)[0] || '-') : `${statusSet.size} status`;
                      const actionLabel = isFinanceCompactView
                        ? 'Lihat Detail Invoice'
                        : hasReadyToShip
                          ? `Tunjuk Driver (${orderIds.length} order)`
                          : hasShipped
                            ? 'Lihat Pengiriman'
                            : isGudangCompactView
                              ? 'Lihat Detail Invoice'
                              : 'Proses Gudang';
                      const paymentMethodLabel = paymentMethodSet.size <= 1
                        ? (Array.from(paymentMethodSet)[0] || '-')
                        : `${paymentMethodSet.size} metode`;
                      const paymentStatusLabel = paymentStatusSet.size <= 1
                        ? (Array.from(paymentStatusSet)[0] || '-')
                        : `${paymentStatusSet.size} status bayar`;
                      const invoiceTitle = bucket.invoiceNumber
                        ? `Invoice ${bucket.invoiceNumber}`
                        : bucket.invoiceId
                          ? `Invoice ID ${bucket.invoiceId}`
                          : 'Invoice belum tercatat';
                      return {
                        groupKey: bucket.groupKey,
                        invoiceId: bucket.invoiceId,
                        invoiceTitle,
                        orderCount: orderIds.length,
                        previewIds,
                        extraOrderCount,
                        statusLabel,
                        totalAmount,
                        allocatedQty,
                        allocatedSkuCount: allocatedSkuSet.size,
                        primaryOrderId,
                        actionLabel,
                        paymentMethodLabel,
                        paymentStatusLabel,
                        hasMissingInvoiceSummary,
                        latestTs,
                        hasMissingDetails,
                      };
                    })
                    .filter((card) => (isFinanceCompactView ? true : card.hasMissingDetails || card.hasMissingInvoiceSummary || card.allocatedQty > 0))
                    .sort((a, b) => b.latestTs - a.latestTs);
                  return (
                    <div key={section} className="space-y-2">
                      <h2 className="text-xs font-black uppercase tracking-widest text-slate-400">{label}</h2>
                      {warehouseCards.length === 0 && (
                        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                          <p className="text-xs text-slate-500">
                            {isFinanceCompactView ? 'Belum ada invoice pada section ini.' : 'Belum ada barang teralokasi untuk diproses gudang.'}
                          </p>
                        </div>
                      )}
                      {warehouseCards.map((card) => (
                        <div key={card.groupKey} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-black text-slate-900">{card.invoiceTitle}</p>
                              <p className="text-[11px] text-slate-500">
                                {card.orderCount} order
                                {card.previewIds.length > 0 ? ` • ${card.previewIds.join(', ')}` : ''}
                                {card.extraOrderCount > 0 ? ` +${card.extraOrderCount}` : ''}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-[11px] text-slate-500">{card.statusLabel}</p>
                              <p className="text-sm font-black text-slate-900">{formatCurrency(card.totalAmount)}</p>
                              {(card.invoiceId || card.primaryOrderId) && (
                                <Link
                                  href={`/admin/orders/${card.invoiceId || card.primaryOrderId}`}
                                  className={`mt-1 text-[10px] font-black uppercase transition-all ${card.actionLabel.includes('Tunjuk Driver')
                                    ? 'inline-flex items-center px-3 py-2 bg-amber-600 text-white rounded-xl shadow-sm shadow-amber-200 hover:bg-amber-700 active:scale-95'
                                    : 'inline-block font-bold text-emerald-700 hover:text-emerald-800'
                                    }`}
                                >
                                  {card.actionLabel}
                                </Link>
                              )}
                              {isFinanceCompactView && section === 'pembayaran' && (
                                <Link href="/admin/finance/verifikasi" className="inline-block mt-1 text-[10px] font-bold text-blue-700">
                                  Buka Verifikasi
                                </Link>
                              )}
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-bold">
                            <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">Qty dialokasikan {card.allocatedQty}</span>
                            <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700">SKU dialokasikan {card.allocatedSkuCount}</span>
                            {isFinanceCompactView && (
                              <>
                                <span className="px-2 py-1 rounded-full bg-violet-100 text-violet-700">Metode {card.paymentMethodLabel}</span>
                                <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700">Bayar {card.paymentStatusLabel}</span>
                              </>
                            )}
                          </div>
                          {card.hasMissingDetails && (
                            <p className="mt-2 text-[10px] text-slate-500">Sebagian detail qty masih dimuat. Data akan ter-update otomatis.</p>
                          )}
                          {card.hasMissingInvoiceSummary && (
                            <p className="mt-2 text-[10px] text-slate-500">Ringkasan invoice sedang dimuat. Qty sementara dihitung dari alokasi order.</p>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                }
                const readyToShipInvoiceGroups = list.reduce((acc, row) => {
                  if (normalizeOrderStatus(row?.status) !== 'ready_to_ship') return acc;
                  const groupKey = invoiceGroupKeyForOrder(row);
                  if (!groupKey) return acc;
                  const bucket = acc.get(groupKey) || [];
                  const rowId = String(row?.id || '');
                  if (rowId) bucket.push(rowId);
                  acc.set(groupKey, bucket);
                  return acc;
                }, new Map<string, string[]>());
                return (
                  <div key={section} className="space-y-2">
                    <h2 className="text-xs font-black uppercase tracking-widest text-slate-400">{label}</h2>
                    {list.map((order) => {
                      const rawOrderStatus = String(order.status || '');
                      const orderStatus = normalizeOrderStatus(rawOrderStatus);
                      const detail = orderDetails[String(order.id)];
                      const totals = orderTotalsById[String(order.id)] || { orderedQty: 0, allocQty: 0, remainingQty: 0, allocPct: 0 };
                      const groupedItems = groupedItemsByOrderId[String(order.id)] || [];
                      const persistedAlloc = persistedAllocByOrderId[String(order.id)] || {};
                      const allocationDraft = allocationDrafts[String(order.id)] || {};
                      const shortageSummary = shortageSummaryByOrderId[String(order.id)] || { orderedTotal: 0, allocatedTotal: 0, shortageTotal: 0 };
                      const isAllocationEditable = ALLOCATION_EDITABLE_STATUSES.has(rawOrderStatus);
                      const isBackorderAllocationEditable = BACKORDER_REALLOCATABLE_STATUSES.has(rawOrderStatus);
                      const allocationBusy = Boolean(allocationSaving[String(order.id)]);
                      const invoiceGroupKey = invoiceGroupKeyForOrder(order);
                      const invoiceGroupOrderIds =
                        orderStatus === 'ready_to_ship' && invoiceGroupKey ? (readyToShipInvoiceGroups.get(invoiceGroupKey) || []) : [];
                      const invoiceGroupCount = invoiceGroupOrderIds.length;
                      const invoicePrimaryOrderId = invoiceGroupCount > 0 ? String(invoiceGroupOrderIds[0] || '') : '';
                      const invoicePrimaryOrderDisplayId = invoicePrimaryOrderId
                        ? invoicePrimaryOrderId.slice(-8).toUpperCase()
                        : '-';
                      const isInvoicePrimaryOrder = invoiceGroupCount <= 1 || String(order.id || '') === invoicePrimaryOrderId;
                      const canOpenWarehouseAction =
                        canManageWarehouseFlow &&
                        WAREHOUSE_STATUSES.has(orderStatus) &&
                        (orderStatus !== 'ready_to_ship' || isInvoicePrimaryOrder);
                      const invoiceId = normalizeInvoiceRef(order?.invoice_id || order?.Invoice?.id || detail?.invoice_id || detail?.Invoice?.id);
                      const invoiceNumber = normalizeInvoiceRef(
                        order?.invoice_number || order?.Invoice?.invoice_number || detail?.invoice_number || detail?.Invoice?.invoice_number
                      );
                      const invoiceRefLabel = formatInvoiceReference(invoiceId, invoiceNumber);
                      const invoiceDetail = invoiceId ? invoiceDetailByInvoiceId[invoiceId] : null;
                      const invoicePaymentStatus = String(
                        invoiceDetail?.payment_status || order?.Invoice?.payment_status || detail?.Invoice?.payment_status || ''
                      ).trim().toLowerCase();
                      const invoiceShipmentStatus = String(
                        invoiceDetail?.shipment_status || order?.Invoice?.shipment_status || detail?.Invoice?.shipment_status || ''
                      ).trim().toLowerCase();
                      const hasIssuedInvoice = Boolean(invoiceId || invoiceNumber);
                      const hasPassedWarehouseStage = (() => {
                        if (invoiceShipmentStatus) {
                          return ['delivered', 'canceled'].includes(invoiceShipmentStatus);
                        }
                        const normalized = normalizeOrderStatus(rawOrderStatus);
                        return normalized === 'delivered' || COMPLETED_STATUSES.has(normalized);
                      })();
                      const isBackorderInputUnlocked = hasIssuedInvoice && hasPassedWarehouseStage;
                      const isBackorderAllocationActionEnabled =
                        canAllocate && isBackorderAllocationEditable && isBackorderInputUnlocked;
                      const warehouseTargetId = normalizeInvoiceRef(invoiceId || order?.id);
                      const warehouseActionLabel = orderStatus === 'ready_to_ship'
                        ? invoiceGroupCount > 1
                          ? `Tunjuk Driver (${invoiceGroupCount} order)`
                          : 'Tunjuk Driver'
                        : orderStatus === 'shipped'
                          ? 'Lihat Pengiriman'
                          : 'Proses Gudang';
                      const allocationDirty = groupedItems.some((item) => {
                        const productId = String(item.product_id || '');
                        if (!productId) return false;
                        const draftQty = Number(allocationDraft[productId] ?? 0);
                        const persistedQty = Number(persistedAlloc[productId] ?? 0);
                        return draftQty !== persistedQty;
                      });
                      const backorderItems = groupedItems
                        .map((item) => {
                          const productId = String(item.product_id || '');
                          if (!productId) return null;
                          const orderedQty = Number(item.qty || 0);
                          const allocatedQty = Number(
                            allocationDraft[productId] !== undefined
                              ? allocationDraft[productId]
                              : persistedAlloc[productId] || 0
                          );
                          const shortageQty = Math.max(0, orderedQty - allocatedQty);
                          if (shortageQty <= 0) return null;
                          const stockQty = Number(item?.Product?.stock_quantity);
                          const persistedQty = Number(persistedAlloc[productId] || 0);
                          const maxAvailable = Number.isFinite(stockQty) ? stockQty + persistedQty : orderedQty;
                          const maxAlloc = Math.min(orderedQty, Math.max(0, maxAvailable));
                          const allocatableQty = Math.max(0, Math.min(shortageQty, maxAlloc - allocatedQty));
                          return {
                            product_id: productId,
                            name: item.Product?.name || 'Produk',
                            sku: item.Product?.sku || '-',
                            orderedQty,
                            allocatedQty,
                            shortageQty,
                            allocatableQty,
                          };
                        })
                        .filter(Boolean) as Array<{
                          product_id: string;
                          name: string;
                          sku: string;
                          orderedQty: number;
                          allocatedQty: number;
                          shortageQty: number;
                          allocatableQty: number;
                        }>;
                      const backorderSummary = backorderItems.reduce(
                        (acc, item) => ({
                          orderedTotal: acc.orderedTotal + item.orderedQty,
                          suppliedTotal: acc.suppliedTotal + item.allocatedQty,
                          shortageTotal: acc.shortageTotal + item.shortageQty,
                          allocatableTotal: acc.allocatableTotal + item.allocatableQty,
                        }),
                        { orderedTotal: 0, suppliedTotal: 0, shortageTotal: 0, allocatableTotal: 0 }
                      );
                      const backorderHistory = backorderHistoryByOrderId[String(order.id)] || [];
                      const previousBackorderCards = backorderHistory.slice(1);
                      const backorderDirty = backorderItems.some((item) => {
                        const requestedTopup = Number(backorderTopupDrafts[String(order.id)]?.[item.product_id] ?? 0);
                        const topupQty = Math.max(0, Math.min(item.allocatableQty, requestedTopup));
                        return topupQty > 0;
                      });
                      const backorderCard = canAllocate
                        && section !== 'selesai'
                        && detail
                        && Number(shortageSummary.allocatedTotal || 0) > 0
                        && backorderItems.length > 0 ? (
                        <div className="mt-3 space-y-2">
                          <div className="border border-amber-100 rounded-2xl p-3 bg-amber-50/60 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Backorder Stok</p>
                                <p className="text-[11px] text-amber-700">
                                  Total {backorderSummary.orderedTotal} • Tersuplai {backorderSummary.suppliedTotal}
                                  {backorderSummary.shortageTotal > 0 ? ` • Backorder ${backorderSummary.shortageTotal}` : ''}
                                  {backorderSummary.allocatableTotal > 0
                                    ? ` • Bisa dialokasikan lagi ${backorderSummary.allocatableTotal}`
                                    : ''}
                                </p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleAutoFillBackorder(String(order.id), backorderItems)}
                                  disabled={!isBackorderAllocationActionEnabled || allocationBusy}
                                  className="px-3 py-1 rounded-lg text-[10px] font-bold border border-amber-200 text-amber-700 disabled:opacity-50"
                                >
                                  Auto Fill
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleSaveBackorderAllocation(String(order.id), backorderItems)}
                                  disabled={!isBackorderAllocationActionEnabled || allocationBusy || !backorderDirty}
                                  className="px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-amber-600 text-white disabled:opacity-50"
                                >
                                  {allocationBusy ? 'Menyimpan...' : 'Selesai Alokasi'}
                                </button>
                              </div>
                            </div>
                            {!hasIssuedInvoice && (
                              <p className="text-[10px] text-amber-700">
                                Top up backorder dibuka setelah invoice sebelumnya diterbitkan dan melewati proses gudang.
                              </p>
                            )}
                            {hasIssuedInvoice && !hasPassedWarehouseStage && (
                              <p className="text-[10px] text-amber-700">
                                Top up backorder masih dikunci. Menunggu invoice sebelumnya melewati proses gudang
                                (status kirim saat ini: <span className="font-bold">{invoiceShipmentStatus || orderStatus || '-'}</span>).
                              </p>
                            )}
                            {!isBackorderAllocationEditable && (
                              <p className="text-[10px] text-amber-700">
                                Alokasi backorder dikunci pada status <span className="font-bold">{order.status}</span>.
                              </p>
                            )}
                            {!canAllocate && (
                              <p className="text-[10px] text-slate-500">
                                Hanya kasir atau super admin yang bisa mengalokasikan ulang backorder.
                              </p>
                            )}
                            {!backorderDirty && (
                              <p className="text-[10px] text-amber-700">
                                Belum ada perubahan top up backorder.
                              </p>
                            )}
                            <div className="space-y-2">
                              {backorderItems.map((item) => {
                                const topupDraft = Number(backorderTopupDrafts[String(order.id)]?.[item.product_id] ?? 0);
                                const topupQty = Math.max(0, Math.min(item.allocatableQty, topupDraft));
                                return (
                                  <div key={item.product_id} className="bg-white border border-amber-100 rounded-xl p-3">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                      <div>
                                        <p className="text-xs font-bold text-slate-900">{item.name}</p>
                                        <p className="text-[10px] text-slate-500">SKU: {item.sku}</p>
                                        <p className="text-[10px] text-slate-500">
                                          Pesan {item.orderedQty} • Tersuplai {item.allocatedQty}
                                        </p>
                                        <p className="text-[10px] font-bold text-rose-600">Backorder {item.shortageQty}</p>
                                        <p className="text-[10px] text-amber-700">
                                          {item.allocatableQty > 0
                                            ? `Bisa dialokasikan lagi ${item.allocatableQty}`
                                            : 'Belum ada stok tambahan untuk dialokasi'}
                                        </p>
                                      </div>
                                      <div className="text-right space-y-1 min-w-[150px]">
                                        <p className="text-[10px] text-amber-600">Top Up Alokasi</p>
                                        <input
                                          type="number"
                                          min={0}
                                          max={item.allocatableQty}
                                          value={topupQty}
                                          disabled={!isBackorderAllocationActionEnabled || allocationBusy || item.allocatableQty <= 0}
                                          onChange={(e) => handleBackorderTopupChange(String(order.id), item.product_id, item.allocatableQty, e.target.value)}
                                          className="w-full rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-right disabled:opacity-60"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          {previousBackorderCards.map((snapshot) => (
                            <div key={snapshot.snapshotId} className="border border-amber-100 rounded-2xl p-3 bg-amber-50/30 space-y-2">
                              <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">
                                  Backorder Stok (Riwayat)
                                </p>
                                <p className="text-[10px] text-amber-700">{formatDateTime(snapshot.createdAt)}</p>
                                <p className="text-[11px] text-amber-700">
                                  Total {snapshot.summary.orderedTotal} • Tersuplai {snapshot.summary.suppliedTotal} • Backorder {snapshot.summary.shortageTotal}
                                </p>
                              </div>
                              <div className="space-y-2">
                                {snapshot.items.map((item) => (
                                  <div key={`${snapshot.snapshotId}:${item.product_id}`} className="bg-white border border-amber-100 rounded-xl p-3">
                                    <p className="text-xs font-bold text-slate-900">{item.name}</p>
                                    <p className="text-[10px] text-slate-500">SKU: {item.sku}</p>
                                    <p className="text-[10px] text-slate-500">
                                      Pesan {item.orderedQty} • Tersuplai {item.allocatedQty} • Backorder {item.shortageQty}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null;
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
                              <p className="text-[10px] text-slate-500">
                                Invoice: {invoiceRefLabel} | Bayar: {paymentStatusLabel(invoicePaymentStatus)} | Kirim: {shipmentStatusLabel(invoiceShipmentStatus)}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-[11px] text-slate-500">{order.status}</p>
                              <p className="text-sm font-black text-slate-900">{formatCurrency(Number(order.total_amount || 0))}</p>
                              {canOpenWarehouseAction && (
                                <Link
                                  href={`/admin/orders/${warehouseTargetId}`}
                                  className={`mt-1 text-[10px] font-black uppercase transition-all ${warehouseActionLabel.includes('Tunjuk Driver')
                                    ? 'inline-flex items-center px-3 py-2 bg-amber-600 text-white rounded-xl shadow-sm shadow-amber-200 hover:bg-amber-700 active:scale-95'
                                    : 'inline-block font-bold text-emerald-700 hover:text-emerald-800'
                                    }`}
                                >
                                  {warehouseActionLabel}
                                </Link>
                              )}
                              {!canOpenWarehouseAction && canManageWarehouseFlow && orderStatus === 'ready_to_ship' && invoiceGroupCount > 1 && (
                                <p className="mt-1 text-[10px] text-amber-600">
                                  Invoice gabungan ({invoiceGroupCount} order), proses dari invoice (ref order #{invoicePrimaryOrderDisplayId}).
                                </p>
                              )}
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

                          {backorderCard}

                          {order.active_issue && (
                            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
                              <div className="flex items-center gap-2 text-amber-700">
                                <AlertCircle size={16} />
                                <p className="text-[10px] font-black uppercase tracking-widest">Laporan Masalah Driver</p>
                              </div>
                              <p className="text-xs font-semibold text-slate-800 bg-white/50 p-2 rounded-xl border border-amber-100 italic">
                                "{order.active_issue.note}"
                              </p>
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-[10px] text-amber-600">
                                  Tipe: <span className="font-bold">{order.active_issue.issue_type}</span> • Batas: {formatDateTime(order.active_issue.due_at)}
                                </p>
                                <Link
                                  href={`/admin/orders/${order.id}`}
                                  className="text-[10px] font-black uppercase px-3 py-1 bg-amber-600 text-white rounded-lg shadow-sm hover:bg-amber-700"
                                >
                                  Tinjau Detail
                                </Link>
                              </div>
                            </div>
                          )}

                          {section !== 'selesai' && detail && canViewAllocation && (
                            <div className="mt-3 border border-slate-100 rounded-2xl p-3 bg-slate-50/60 space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Alokasi Stok</p>
                                  <p className="text-[11px] text-slate-500">
                                    Total {shortageSummary.orderedTotal} • Dialokasikan {shortageSummary.allocatedTotal}
                                    {shortageSummary.shortageTotal > 0 ? ` • Kurang ${shortageSummary.shortageTotal}` : ''}
                                  </p>
                                </div>
                                {canAllocate ? (
                                  <div className="flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleAutoAllocate(String(order.id))}
                                      disabled={!isAllocationEditable || allocationBusy}
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
                                ) : (
                                  <p className="text-[10px] text-slate-500">Read only untuk role gudang.</p>
                                )}
                              </div>
                              {!allocationDirty && (
                                <p className="text-[10px] text-emerald-600">
                                  Alokasi tersimpan. {rawOrderStatus === 'waiting_invoice'
                                    ? 'Siap terbitkan invoice.'
                                    : orderStatus === 'ready_to_ship'
                                      ? 'Invoice sudah terbit. Lanjut proses gudang / tunjuk driver.'
                                      : 'Menunggu status waiting_invoice.'}
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
                                              disabled={!canAllocate || !isAllocationEditable}
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
