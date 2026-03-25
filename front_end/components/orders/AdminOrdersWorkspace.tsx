'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Minus, Package, Plus, Search, Users } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';
import { useAuthStore } from '@/store/authStore';
import { notifyOpen, notifyAlert } from '@/lib/notify';
import axios from 'axios';
import type { AdminOrderListRow, InvoiceDetailResponse, OrderDetailResponse, ProductLite } from '@/lib/apiTypes';

type AdminOrdersWorkspaceProps = {
  forcedCustomerId?: string;
  forcedCustomerName?: string;
  forcedCustomerKey?: string;
  initialSection?: OrderSectionFilter;
  initialFocusOrderId?: string;
};

type CustomerGroup = {
  key: string;
  customer_id: string | null;
  customer_name: string;
  orders: AdminOrderListRow[];
	  counts: {
	    baru: number;
	    allocated: number;
	    backorder: number;
	    pembayaran: number;
	    gudang: number;
	    checker: number;
	    pengiriman: number;
	    selesai: number;
	  };
	};

type OrderSection = 'baru' | 'allocated' | 'backorder' | 'pembayaran' | 'gudang' | 'checker' | 'pengiriman' | 'selesai';
type OrderSectionFilter = 'all' | OrderSection;

type BackorderSnapshotItem = {
  product_id: string;
  name: string;
  sku: string;
  orderedQty: number;
  allocatedQty: number;
  shortageQty: number;
  allocatableQty: number;
  canceledValue?: number;
};

type BackorderSnapshot = {
  snapshotId: string;
  createdAt: string;
  reason?: string;
  projectedStatus?: string;
  summary: {
    orderedTotal: number;
    suppliedTotal: number;
    shortageTotal: number;
    allocatableTotal: number;
    reducedValue?: number;
  };
  items: BackorderSnapshotItem[];
};

type BackorderTimelineEvent = {
  id?: string | number;
  event_type?: string;
  order_item_id?: string | null;
  reason?: string | null;
  occurred_at?: string | null;
  payload?: {
    delta?: {
      canceled_qty?: number | string;
    };
    before?: {
      shortage_qty?: number | string;
    };
  } | null;
};

type BackorderEditableItem = BackorderSnapshotItem;
type WarehouseInvoiceBucket = {
  groupKey: string;
  invoiceId: string;
  invoiceNumber: string;
  orders: AdminOrderListRow[];
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

type AllocationConfirmState = {
  orderId: string;
  step: 1 | 2;
  action: 'allocation' | 'backorder_allocation' | 'cancel_order' | 'cancel_backorder' | 'issue_invoice';
};

type WarehouseAssignConfirmCard = {
  groupKey: string;
  invoiceId?: string;
  invoiceTitle: string;
  orderCount: number;
  readyToShipOrderIds: string[];
  previewIds: string[];
  extraOrderCount: number;
  totalAmount: number;
  customerLabel: string;
};

type WarehouseAssignConfirmState = {
  step: 1 | 2;
  courierId: string;
  courierName: string;
  cards: WarehouseAssignConfirmCard[];
  totalOrdersCount: number;
};

type CourierOption = {
  id: string;
  name: string;
};

type DeliveryHandoverModalState = {
  step: 'check' | 'handover';
  invoiceId: string;
  invoiceTitle: string;
  note: string;
  result: 'pass' | 'fail';
  file: File | null;
};

const COMPLETED_STATUSES = new Set(['completed', 'canceled', 'expired']);
const PAYMENT_STATUSES = new Set(['waiting_admin_verification']);
const WAREHOUSE_STATUSES = new Set(['allocated', 'ready_to_ship', 'checked', 'waiting_payment', 'processing', 'hold']);
const ALLOCATION_EDITABLE_STATUSES = new Set(['pending', 'waiting_invoice', 'allocated', 'hold', 'partially_fulfilled']);
const BACKORDER_REALLOCATABLE_STATUSES = new Set(['pending', 'waiting_invoice', 'allocated', 'ready_to_ship', 'partially_fulfilled', 'hold', 'delivered', 'completed']);
const BACKORDER_TOPUP_GRACE_MS = 24 * 60 * 60 * 1000;
const ORDER_FILTER_OPTIONS_ALL: OrderSectionFilter[] = ['baru', 'allocated', 'backorder', 'pembayaran', 'gudang', 'checker', 'pengiriman', 'selesai'];
const ORDER_FILTER_OPTIONS_WAREHOUSE: OrderSectionFilter[] = ['baru', 'allocated', 'pembayaran', 'gudang', 'checker', 'pengiriman', 'selesai'];
const ORDER_SECTION_OPTIONS_ALL: OrderSection[] = ['baru', 'allocated', 'backorder', 'pembayaran', 'gudang', 'checker', 'pengiriman', 'selesai'];
const ORDER_SECTION_OPTIONS_WAREHOUSE: OrderSection[] = ['baru', 'allocated', 'pembayaran', 'gudang', 'checker', 'pengiriman', 'selesai'];
const CANCELABLE_ORDER_STATUSES = new Set([
  'pending',
  'waiting_invoice',
  'ready_to_ship',
  'allocated',
  'partially_fulfilled',
  'debt_pending',
  'processing',
  'hold',
]);

const getSectionFilterLabel = (filter: OrderSectionFilter) => {
  if (filter === 'all') return 'Semua';
  if (filter === 'baru') return 'Order Baru';
  if (filter === 'allocated') return 'Sudah Dialokasikan';
  if (filter === 'backorder') return 'Backorder';
  if (filter === 'pembayaran') return 'Menunggu Bayar';
  if (filter === 'gudang') return 'Proses Gudang';
  if (filter === 'checker') return 'Checker';
  if (filter === 'pengiriman') return 'Pengiriman';
  return 'Selesai';
};
const getSectionLabel = (section: OrderSection) => {
  if (section === 'baru') return 'Order Baru';
  if (section === 'allocated') return 'Sudah Dialokasikan';
  if (section === 'backorder') return 'Backorder';
  if (section === 'pembayaran') return 'Menunggu Pembayaran';
  if (section === 'gudang') return 'Proses Gudang';
  if (section === 'checker') return 'Checker';
  if (section === 'pengiriman') return 'Pengiriman';
  return 'Selesai';
};
const normalizeInvoiceRef = (raw: unknown) => String(raw || '').trim();
const resolveInvoiceRefForOrder = (order: AdminOrderListRow, detail?: OrderDetailResponse) => {
  const attachedInvoice = detail?.Invoice || order?.Invoice || null;
  const invoiceId = normalizeInvoiceRef(
    attachedInvoice?.id || detail?.invoice_id || order?.invoice_id
  );
  const invoiceNumber = normalizeInvoiceRef(
    attachedInvoice?.invoice_number || detail?.invoice_number || order?.invoice_number
  );
  return { invoiceId, invoiceNumber };
};
const invoiceGroupKeyForOrder = (order: AdminOrderListRow) => {
  const { invoiceId, invoiceNumber } = resolveInvoiceRefForOrder(order);
  if (invoiceId) return `id:${invoiceId}`;
  const invoiceNumberKey = invoiceNumber.toLowerCase();
  if (invoiceNumberKey) return `num:${invoiceNumberKey}`;
  return '';
};
const normalizeOrderStatus = (raw: unknown) => {
  const status = String(raw || '').trim();
  return status === 'waiting_payment' ? 'ready_to_ship' : status;
};

const resolveInvoiceCreatedAtMs = (invoiceDetail: any): number | null => {
  const raw = String(invoiceDetail?.createdAt || '').trim();
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const getBackorderAllocationLockReason = (params: {
  invoiceDetail: any;
  invoiceShipmentStatus: string;
}): string | null => {
  const shipment = String(params.invoiceShipmentStatus || '').trim().toLowerCase();
  if (!shipment) return null;
  if (['shipped', 'delivered', 'canceled'].includes(shipment)) return null;

  const createdAtMs = resolveInvoiceCreatedAtMs(params.invoiceDetail);
  if (!createdAtMs) return null;
  const ageMs = Date.now() - createdAtMs;
  if (!Number.isFinite(ageMs)) return null;
  if (ageMs <= BACKORDER_TOPUP_GRACE_MS) return null;
  return `Top up backorder dikunci karena invoice belum lewat gudang (>24 jam). Status kirim: ${shipment}`;
};

const resolveWorkspaceShipmentStatus = (order: AdminOrderListRow, detail?: OrderDetailResponse) => {
  const invoiceShipmentStatus = String(
    detail?.Invoice?.shipment_status ||
    order?.Invoice?.shipment_status ||
    ''
  ).trim();
  if (invoiceShipmentStatus) {
    return normalizeOrderStatus(invoiceShipmentStatus);
  }
  return normalizeOrderStatus(order?.status);
};

const resolveWorkspaceCourierId = (order: AdminOrderListRow, detail?: OrderDetailResponse) => {
  const invoice = detail?.Invoice || order?.Invoice || null;
  const courierId = String(
    (invoice as any)?.courier_id ||
    (order as any)?.courier_id ||
    (detail as any)?.courier_id ||
    ''
  ).trim();
  return courierId;
};
const isSettlementCompleted = (order: AdminOrderListRow, detail?: OrderDetailResponse) => {
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
  if (status === 'checked') return 'Dicek (Keluar Gudang)';
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
  if (status === 'checked') return 'bg-cyan-100 text-cyan-700 border-cyan-200';
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

const buildInvoiceItemSummary = (invoiceData?: InvoiceDetailResponse | null): InvoiceItemSummary => {
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

const hasActiveBackorderRows = (detail?: OrderDetailResponse): boolean => {
  if (!Array.isArray(detail?.Backorders)) return false;
  return detail.Backorders.some((row: any) => {
    const qtyPending = Number(row?.qty_pending || 0);
    const status = String(row?.status || '').trim().toLowerCase();
    return qtyPending > 0 && !['fulfilled', 'canceled', 'cancelled'].includes(status);
  });
};

const isOrderBackorder = (order: AdminOrderListRow, detail: OrderDetailResponse | undefined, backorderIds: Set<string>): boolean => {
  const orderId = String(order?.id || '');
  if (backorderIds.has(orderId)) return true;
  if (hasActiveBackorderRows(detail)) return true;
  return false;
};

const buildBackorderSnapshotFromDetail = (detail: OrderDetailResponse): BackorderSnapshot | null => {
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

const buildBackorderHistoryFromTimeline = (detail?: OrderDetailResponse): BackorderSnapshot[] => {
  if (!detail) return [];
  const timeline = Array.isArray(detail?.timeline) ? detail.timeline as BackorderTimelineEvent[] : [];
  const orderItems = Array.isArray(detail?.OrderItems) ? detail.OrderItems : [];
  if (timeline.length === 0 || orderItems.length === 0) return [];

  const itemById = new Map<string, any>();
  orderItems.forEach((item: any) => {
    const itemId = String(item?.id || '').trim();
    if (!itemId) return;
    itemById.set(itemId, item);
  });

  const grouped = new Map<string, BackorderSnapshot>();
  timeline.forEach((event) => {
    if (String(event?.event_type || '') !== 'backorder_canceled') return;
    const orderItemId = String(event?.order_item_id || '').trim();
    if (!orderItemId) return;

    const item = itemById.get(orderItemId);
    if (!item) return;

    const occurredAt = String(event?.occurred_at || '').trim() || new Date().toISOString();
    const reason = String(event?.reason || '').trim();
    const eventSecondKey = occurredAt ? occurredAt.slice(0, 19) : 'unknown';
    const groupKey = `${eventSecondKey}::${reason || '-'}::${String(event?.id || '')}`;

    const orderedQty = Math.max(0, Number(item?.ordered_qty_original || item?.qty || 0));
    const canceledQty = Math.max(
      0,
      Number(event?.payload?.delta?.canceled_qty ?? event?.payload?.before?.shortage_qty ?? 0)
    );
    if (canceledQty <= 0) return;

    const allocatedQty = Math.max(0, orderedQty - canceledQty);
    const price = Math.max(0, Number(item?.price_at_purchase || 0));
    const canceledValue = canceledQty * price;
    const product = item?.Product || {};

    const existing = grouped.get(groupKey) || {
      snapshotId: `event-${groupKey}`,
      createdAt: occurredAt,
      reason: reason || undefined,
      summary: {
        orderedTotal: 0,
        suppliedTotal: 0,
        shortageTotal: 0,
        allocatableTotal: 0,
        reducedValue: 0,
      },
      items: [],
    };

    existing.summary.orderedTotal += orderedQty;
    existing.summary.suppliedTotal += allocatedQty;
    existing.summary.reducedValue = Number(existing.summary.reducedValue || 0) + canceledValue;
    existing.items.push({
      product_id: String(item?.product_id || orderItemId),
      name: String(product?.name || 'Produk'),
      sku: String(product?.sku || item?.product_id || '-'),
      orderedQty,
      allocatedQty,
      shortageQty: 0,
      allocatableQty: 0,
      canceledValue,
    });

    grouped.set(groupKey, existing);
  });

  return Array.from(grouped.values()).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
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

export default function AdminOrdersWorkspace({
  forcedCustomerId,
  forcedCustomerName,
  forcedCustomerKey,
  initialSection,
  initialFocusOrderId,
}: AdminOrdersWorkspaceProps) {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'checker_gudang', 'admin_finance', 'kasir']);
  const { user } = useAuthStore();
  const normalizedRole = String(user?.role || '').trim();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hasRenderableAccess = isAuthenticated && ['super_admin', 'admin_gudang', 'checker_gudang', 'admin_finance', 'kasir'].includes(normalizedRole);
  const canIssueInvoice = useMemo(() => ['super_admin', 'kasir'].includes(normalizedRole), [normalizedRole]);
  const canAllocate = useMemo(() => ['super_admin', 'kasir'].includes(normalizedRole), [normalizedRole]);
  const canCancelOrder = useMemo(() => ['super_admin', 'kasir'].includes(normalizedRole), [normalizedRole]);
  const canEditPricing = useMemo(() => ['super_admin', 'kasir'].includes(normalizedRole), [normalizedRole]);
  const canViewAllocation = useMemo(() => ['super_admin', 'kasir', 'admin_gudang', 'admin_finance'].includes(normalizedRole), [normalizedRole]);
  const canMoveToIndentAction = useMemo(() => ['super_admin', 'kasir', 'admin_gudang', 'admin_finance'].includes(normalizedRole), [normalizedRole]);
  const canManageWarehouseFlow = useMemo(() => ['super_admin', 'admin_gudang', 'checker_gudang'].includes(normalizedRole), [normalizedRole]);
  const isFinanceRole = useMemo(() => normalizedRole === 'admin_finance', [normalizedRole]);
  const isWarehouseRole = useMemo(() => normalizedRole === 'admin_gudang' || normalizedRole === 'checker_gudang', [normalizedRole]);
  const canAssignDriverWarehouse = useMemo(() => normalizedRole === 'admin_gudang' || normalizedRole === 'super_admin', [normalizedRole]);
  type OrderDetailsMap = Record<string, OrderDetailResponse | undefined>;
  type InvoiceDetailsMap = Record<string, InvoiceDetailResponse | null | undefined>;
  type PricingEditorItem = {
    order_item_id: string;
    product_name: string;
    sku: string;
    qty: number;
    baseline_unit_price: number;
    current_unit_price: number;
    cost_at_purchase: number | null;
  };

  const [orders, setOrders] = useState<AdminOrderListRow[]>([]);
  const [backorderIds, setBackorderIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [customerQuery, setCustomerQuery] = useState('');
  const [orderQuery, setOrderQuery] = useState('');
  const [orderSectionFilter, setOrderSectionFilter] = useState<OrderSectionFilter>(initialSection || 'baru');
  const [orderDetails, setOrderDetails] = useState<OrderDetailsMap>({});
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [orderDetailErrors, setOrderDetailErrors] = useState<Record<string, string>>({});
  const [allocationDrafts, setAllocationDrafts] = useState<Record<string, Record<string, number>>>({});
  const [backorderHistoryByOrderId, setBackorderHistoryByOrderId] = useState<Record<string, BackorderSnapshot[]>>({});
  const [backorderTopupDrafts, setBackorderTopupDrafts] = useState<Record<string, Record<string, number>>>({});
  const [allocationSaving, setAllocationSaving] = useState<Record<string, boolean>>({});
  const [invoiceItemSummaryByInvoiceId, setInvoiceItemSummaryByInvoiceId] = useState<Record<string, InvoiceItemSummary | null>>({});
  const [invoiceDetailByInvoiceId, setInvoiceDetailByInvoiceId] = useState<InvoiceDetailsMap>({});
  const [busyInvoice, setBusyInvoice] = useState(false);
  const [allocationConfirm, setAllocationConfirm] = useState<AllocationConfirmState | null>(null);
  const [backorderCancelReason, setBackorderCancelReason] = useState('');
  const [couriers, setCouriers] = useState<CourierOption[]>([]);
  const [deliveryHandoverModal, setDeliveryHandoverModal] = useState<DeliveryHandoverModalState | null>(null);
  const [deliveryHandoverBusy, setDeliveryHandoverBusy] = useState(false);
  const [selectedWarehouseCourierId, setSelectedWarehouseCourierId] = useState('');
  const [selectedWarehouseInvoiceGroups, setSelectedWarehouseInvoiceGroups] = useState<string[]>([]);
  const [warehouseBatchAssigning, setWarehouseBatchAssigning] = useState(false);
  const [warehouseAssignConfirm, setWarehouseAssignConfirm] = useState<WarehouseAssignConfirmState | null>(null);
  const [pricingEditor, setPricingEditor] = useState<{
    orderId: string;
    orderReason: string;
    items: PricingEditorItem[];
    drafts: Record<string, { unit_price_override: string; reason: string }>;
    saving: boolean;
    error: string;
  } | null>(null);
  const ordersRef = useRef<AdminOrderListRow[]>([]);
  const warehouseCustomerFocusMode = isWarehouseRole && Boolean(forcedCustomerId || forcedCustomerKey);
  const showInlineOrderDetailPanel = Boolean(forcedCustomerId || forcedCustomerKey);
  const sectionFilterOptions = useMemo<OrderSectionFilter[]>(
    () => (warehouseCustomerFocusMode ? ['gudang', 'checker', 'pengiriman'] : isWarehouseRole ? ORDER_FILTER_OPTIONS_WAREHOUSE : ORDER_FILTER_OPTIONS_ALL),
    [isWarehouseRole, warehouseCustomerFocusMode]
  );
  const sectionOptions = useMemo<OrderSection[]>(
    () => (warehouseCustomerFocusMode ? ['gudang', 'checker', 'pengiriman'] : isWarehouseRole ? ORDER_SECTION_OPTIONS_WAREHOUSE : ORDER_SECTION_OPTIONS_ALL),
    [isWarehouseRole, warehouseCustomerFocusMode]
  );

  const loadOrders = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!hasRenderableAccess) return;
    try {
      if (!silent) setLoading(true);
      const [allRes, backorderRes] = await Promise.all([
        api.admin.orderManagement.getAll({ page: 1, limit: 200, status: 'all' }),
        api.admin.orderManagement.getAll({ page: 1, limit: 200, status: 'all', is_backorder: 'true' })
      ]);
      const allOrders = Array.isArray(allRes.data?.orders) ? allRes.data.orders : [];
      const backorderSet = new Set<string>(
        (Array.isArray(backorderRes.data?.orders) ? backorderRes.data.orders : []).map((o) => String(o?.id || ''))
      );
      const previousOrders = Array.isArray(ordersRef.current) ? ordersRef.current : [];
      const previousById = new Map(previousOrders.map((row) => [String(row?.id || ''), row]));
      const nextById = new Map(allOrders.map((row) => [String(row?.id || ''), row]));
      const changedOrderIds = new Set<string>();
      const touchedInvoiceIds = new Set<string>();

      allOrders.forEach((order) => {
        const orderId = String(order?.id || '');
        if (!orderId) return;
        const prevOrder = previousById.get(orderId);
        const nextInvoiceId = resolveInvoiceRefForOrder(order).invoiceId;
        if (!prevOrder) {
          changedOrderIds.add(orderId);
          if (nextInvoiceId) touchedInvoiceIds.add(nextInvoiceId);
          return;
        }

        const prevInvoiceId = resolveInvoiceRefForOrder(prevOrder).invoiceId;
        const statusChanged = String(prevOrder?.status || '') !== String(order?.status || '');
        const updatedChanged = String(prevOrder?.updatedAt || '') !== String(order?.updatedAt || '');
        const invoiceChanged = prevInvoiceId !== nextInvoiceId;
        if (statusChanged || updatedChanged || invoiceChanged) {
          changedOrderIds.add(orderId);
          if (prevInvoiceId) touchedInvoiceIds.add(prevInvoiceId);
          if (nextInvoiceId) touchedInvoiceIds.add(nextInvoiceId);
        }
      });

      previousOrders.forEach((order) => {
        const orderId = String(order?.id || '');
        if (!orderId || nextById.has(orderId)) return;
        changedOrderIds.add(orderId);
        const prevInvoiceId = resolveInvoiceRefForOrder(order).invoiceId;
        if (prevInvoiceId) touchedInvoiceIds.add(prevInvoiceId);
      });

      setOrders(allOrders);
      setBackorderIds(backorderSet);
      if (changedOrderIds.size > 0 || previousOrders.length !== allOrders.length) {
        setOrderDetails((prev) => {
          const next: Record<string, OrderDetailResponse | undefined> = {};
          Object.entries(prev).forEach(([orderId, detail]) => {
            if (!nextById.has(orderId)) return;
            if (changedOrderIds.has(orderId)) return;
            next[orderId] = detail;
          });
          return next;
        });
      }
      if (touchedInvoiceIds.size > 0) {
        const touched = touchedInvoiceIds;
        setInvoiceItemSummaryByInvoiceId((prev) => {
          const next = { ...prev };
          touched.forEach((invoiceId) => {
            delete next[invoiceId];
          });
          return next;
        });
        setInvoiceDetailByInvoiceId((prev) => {
          const next = { ...prev };
          touched.forEach((invoiceId) => {
            delete next[invoiceId];
          });
          return next;
        });
      }
      ordersRef.current = allOrders;

    } catch (error) {
      console.error('Failed to load orders:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [hasRenderableAccess]);

  const loadCouriers = useCallback(async () => {
    if (!canManageWarehouseFlow) return;
    try {
      const res = await api.admin.orderManagement.getCouriers();
      const rows = Array.isArray(res.data?.employees) ? res.data.employees : [];
      setCouriers(
        rows.map((item: any) => ({
          id: String(item?.id || ''),
          name: String(item?.display_name || item?.name || 'Driver'),
        })).filter((item: CourierOption) => Boolean(item.id))
      );
    } catch (error) {
      console.error('Failed to load couriers:', error);
    }
  }, [canManageWarehouseFlow]);

  const classifyOrderSections = useCallback((order: AdminOrderListRow, detail?: OrderDetailResponse): OrderSection[] => {
    const rawStatus = String(order?.status || '');
    const normalizedStatus = resolveWorkspaceShipmentStatus(order, detail);
    const courierId = resolveWorkspaceCourierId(order, detail);
    const isCompleted = COMPLETED_STATUSES.has(rawStatus);
    const isPayment = PAYMENT_STATUSES.has(rawStatus);
    const isWarehouse = WAREHOUSE_STATUSES.has(normalizedStatus);
    const isShipping = normalizedStatus === 'shipped';
    const isCheckerStage = normalizedStatus === 'checked' || (normalizedStatus === 'ready_to_ship' && Boolean(courierId));
    const isBackorder = isOrderBackorder(order, detail, backorderIds);
    const isDelivered = normalizedStatus === 'delivered';
    const isPartiallyFulfilled = normalizedStatus === 'partially_fulfilled';
    const isPaidByRule = isSettlementCompleted(order, detail);
    const isAllocatedReady = normalizedStatus === 'waiting_invoice';
    const sections: OrderSection[] = [];

    if (isCompleted) return ['selesai'];
    if (isDelivered) return [isPaidByRule ? 'selesai' : 'pembayaran'];
    if (isPartiallyFulfilled && !isBackorder) {
      return [isPaidByRule ? 'selesai' : 'pengiriman'];
    }

    if (isBackorder) sections.push('backorder');
    if (isPayment) sections.push('pembayaran');
    if (isShipping) sections.push('pengiriman');
    if (isAllocatedReady) sections.push('allocated');
    if (isWarehouse) sections.push(isCheckerStage ? 'checker' : 'gudang');

    if (sections.length === 0) sections.push('baru');
    return Array.from(new Set(sections));
  }, [backorderIds]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    void loadCouriers();
  }, [loadCouriers]);

  useRealtimeRefresh({
    enabled: hasRenderableAccess,
    onRefresh: () => loadOrders({ silent: true }),
    domains: ['order', 'retur', 'cod', 'admin'],
    pollIntervalMs: 15000,
  });

  const customerGroups = useMemo<CustomerGroup[]>(() => {
    const map = new Map<string, CustomerGroup>();
    orders.forEach((order) => {
      const customerId = order.customer_id ? String(order.customer_id) : null;
      const name = String(order.customer_name || order.Customer?.name || 'Customer');
      const key = customerId || `guest:${name}`;
      const group = map.get(key) || {
        key,
        customer_id: customerId,
        customer_name: name,
        orders: [],
        counts: { baru: 0, allocated: 0, backorder: 0, pembayaran: 0, gudang: 0, checker: 0, pengiriman: 0, selesai: 0 },
      };

      const detail = orderDetails[String(order.id)];
      const sections = classifyOrderSections(order, detail);
      sections.forEach((section) => {
        group.counts[section] += 1;
      });

      group.orders.push(order);
      map.set(key, group);
    });

    return Array.from(map.values()).sort((a, b) => {
      const aCount = a.counts.baru + a.counts.allocated + a.counts.backorder + a.counts.pembayaran + a.counts.gudang + a.counts.checker + a.counts.pengiriman + a.counts.selesai;
      const bCount = b.counts.baru + b.counts.allocated + b.counts.backorder + b.counts.pembayaran + b.counts.gudang + b.counts.checker + b.counts.pengiriman + b.counts.selesai;
      return bCount - aCount;
    });
  }, [orders, orderDetails, classifyOrderSections]);

  const filteredCustomerGroups = useMemo(() => {
    if (forcedCustomerId) {
      return customerGroups.filter((group) => String(group.customer_id || '') === forcedCustomerId);
    }
    if (forcedCustomerKey) {
      return customerGroups.filter((group) => group.key === forcedCustomerKey);
    }
    const query = customerQuery.trim().toLowerCase();
    return !query
      ? customerGroups
      : customerGroups.filter((group) => {
        const name = String(group.customer_name || '').toLowerCase();
        const id = String(group.customer_id || '').toLowerCase();
        return name.includes(query) || id.includes(query) || group.key.toLowerCase().includes(query);
      });
  }, [customerGroups, customerQuery, forcedCustomerId, forcedCustomerKey]);

  const selectedGroup = useMemo<CustomerGroup | null>(() => {
    if (filteredCustomerGroups.length === 0) return null;
    if (forcedCustomerId || forcedCustomerKey || filteredCustomerGroups.length === 1) {
      return filteredCustomerGroups[0] || null;
    }
    return filteredCustomerGroups.reduce<CustomerGroup>(
      (acc, group) => {
        acc.orders.push(...group.orders);
        acc.counts.baru += group.counts.baru;
        acc.counts.allocated += group.counts.allocated;
        acc.counts.backorder += group.counts.backorder;
        acc.counts.pembayaran += group.counts.pembayaran;
        acc.counts.gudang += group.counts.gudang;
        acc.counts.checker += group.counts.checker;
        acc.counts.pengiriman += group.counts.pengiriman;
        acc.counts.selesai += group.counts.selesai;
        return acc;
      },
      {
        key: '__all__',
        customer_id: null,
        customer_name: 'Semua Customer',
        orders: [],
        counts: { baru: 0, allocated: 0, backorder: 0, pembayaran: 0, gudang: 0, checker: 0, pengiriman: 0, selesai: 0 },
      }
    );
  }, [filteredCustomerGroups, forcedCustomerId, forcedCustomerKey]);

  const groupedOrders = useMemo(() => {
    const group = selectedGroup;
    if (!group) return { baru: [], allocated: [], backorder: [], pembayaran: [], gudang: [], checker: [], pengiriman: [], selesai: [] };
    const result = { baru: [] as AdminOrderListRow[], allocated: [] as AdminOrderListRow[], backorder: [] as AdminOrderListRow[], pembayaran: [] as AdminOrderListRow[], gudang: [] as AdminOrderListRow[], checker: [] as AdminOrderListRow[], pengiriman: [] as AdminOrderListRow[], selesai: [] as AdminOrderListRow[] };
    const getRecencyTs = (order: AdminOrderListRow) => {
      const updatedTs = Date.parse(String(order?.updatedAt || ''));
      if (Number.isFinite(updatedTs)) return updatedTs;
      const createdTs = Date.parse(String(order?.createdAt || ''));
      if (Number.isFinite(createdTs)) return createdTs;
      return 0;
    };

    group.orders.forEach((order) => {
      const detail = orderDetails[String(order.id)];
      const sections = classifyOrderSections(order, detail);
      sections.forEach((section) => {
        result[section].push(order);
      });
    });

    // Prioritaskan backorder terbaru di urutan teratas setelah alokasi berubah.
    result.backorder.sort((a: AdminOrderListRow, b: AdminOrderListRow) => {
      const diff = getRecencyTs(b) - getRecencyTs(a);
      if (diff !== 0) return diff;
      const aId = Number(a?.id);
      const bId = Number(b?.id);
      if (Number.isFinite(aId) && Number.isFinite(bId)) return bId - aId;
      return String(b?.id || '').localeCompare(String(a?.id || ''));
    });

    return result;
  }, [selectedGroup, orderDetails, classifyOrderSections]);

  const filteredGroupedOrders = useMemo(() => {
    const query = orderQuery.trim().toLowerCase();
    if (!query) return groupedOrders;
    const matchOrder = (order: AdminOrderListRow) => {
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
      allocated: groupedOrders.allocated.filter(matchOrder),
      backorder: groupedOrders.backorder.filter(matchOrder),
      pembayaran: groupedOrders.pembayaran.filter(matchOrder),
      gudang: groupedOrders.gudang.filter(matchOrder),
      checker: groupedOrders.checker.filter(matchOrder),
      pengiriman: groupedOrders.pengiriman.filter(matchOrder),
      selesai: groupedOrders.selesai.filter(matchOrder),
    };
  }, [groupedOrders, orderDetails, orderQuery]);

  const loadOrderDetails = useCallback(async (ordersToLoad: AdminOrderListRow[]) => {
    const validOrders = ordersToLoad.filter((order) => String(order?.id || '').trim());
    if (validOrders.length === 0) return;
    setDetailsLoading(true);
    try {
      const results = await Promise.allSettled(
        validOrders.map((order) => api.orders.getOrderById(String(order.id)))
      );

      const nextMap: Record<string, OrderDetailResponse> = {};
      const nextErrors: Record<string, string> = {};
      const successfulIds = new Set<string>();

      results.forEach((result, index) => {
        const requestedId = String(validOrders[index]?.id || '').trim();
        if (!requestedId) return;

        if (result.status === 'fulfilled') {
          const detail = result.value?.data as any;
          const resolvedId = String(detail?.id || '').trim();
          if (resolvedId) {
            nextMap[resolvedId] = detail;
            // Also map by requested ID (handles cases where user clicked invoice ID, etc.)
            nextMap[requestedId] = detail;
            successfulIds.add(requestedId);
            successfulIds.add(resolvedId);
          } else {
            nextErrors[requestedId] = 'Detail order kosong atau tidak valid.';
          }
          return;
        }

        const err = result.reason as unknown;
        const message = axios.isAxiosError(err)
          ? String((err.response?.data as any)?.message || err.message || 'Gagal memuat detail order.')
          : 'Gagal memuat detail order.';
        nextErrors[requestedId] = message;
      });

      if (Object.keys(nextMap).length > 0) {
        setOrderDetails((prev) => ({ ...prev, ...nextMap }));
      }
      if (successfulIds.size > 0) {
        setOrderDetailErrors((prev) => {
          let changed = false;
          const next = { ...prev };
          successfulIds.forEach((id) => {
            if (!next[id]) return;
            delete next[id];
            changed = true;
          });
          return changed ? next : prev;
        });
      }
      if (Object.keys(nextErrors).length > 0) {
        setOrderDetailErrors((prev) => ({ ...prev, ...nextErrors }));
      }
      if (Object.keys(nextErrors).length > 0) {
        console.error('Failed to load some order details:', nextErrors);
      }
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  const retryLoadOrderDetail = useCallback((order: AdminOrderListRow) => {
    const orderId = String(order?.id || '').trim();
    if (!orderId) return;
    setOrderDetailErrors((prev) => {
      if (!prev[orderId]) return prev;
      const next = { ...prev };
      delete next[orderId];
      return next;
    });
    void loadOrderDetails([order]);
  }, [loadOrderDetails]);

  const openPricingEditor = useCallback(async (orderIdRaw: string) => {
    const orderId = String(orderIdRaw || '').trim();
    if (!orderId) return;
    if (!canEditPricing) return;

    const toFinite = (value: unknown) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    const toObjectOrEmpty = (value: unknown): Record<string, any> => {
      if (!value) return {};
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return {};
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, any>;
        } catch { }
        return {};
      }
      if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
      return {};
    };

    try {
      const cached = orderDetails[orderId];
      const detail = cached || (await api.orders.getOrderById(orderId)).data;
      if (!cached && detail && typeof detail === 'object') {
        setOrderDetails((prev) => ({ ...prev, [orderId]: detail }));
      }

      const orderItems = Array.isArray((detail as any)?.OrderItems) ? (detail as any).OrderItems : [];
      if (orderItems.length === 0) {
        notifyAlert('Order belum memiliki item.');
        return;
      }

      const items: PricingEditorItem[] = orderItems.map((row: any) => {
        const snapshot = toObjectOrEmpty(row?.pricing_snapshot);
        const baseline = toFinite(snapshot?.computed_unit_price ?? snapshot?.computedUnitPrice) ?? toFinite(row?.price_at_purchase) ?? 0;
        const current = toFinite(row?.price_at_purchase) ?? 0;
        const cost = toFinite(row?.cost_at_purchase);
        const product = row?.Product || {};
        return {
          order_item_id: String(row?.id || ''),
          product_name: String(product?.name || 'Produk'),
          sku: String(product?.sku || '-'),
          qty: Math.max(0, Number(row?.qty || 0)),
          baseline_unit_price: Math.max(0, baseline),
          current_unit_price: Math.max(0, current),
          cost_at_purchase: cost !== null ? Math.max(0, cost) : null,
        };
      }).filter((row: PricingEditorItem) => Boolean(row.order_item_id));

      const drafts: Record<string, { unit_price_override: string; reason: string }> = {};
      items.forEach((row) => {
        drafts[row.order_item_id] = { unit_price_override: String(row.current_unit_price || 0), reason: '' };
      });

      setPricingEditor({
        orderId,
        orderReason: String((detail as any)?.pricing_override_note || '').trim(),
        items,
        drafts,
        saving: false,
        error: ''
      });
    } catch (error: unknown) {
      console.error('Failed to open pricing editor:', error);
      const message = axios.isAxiosError(error)
        ? String((error.response?.data as any)?.message || error.message || 'Gagal memuat detail order.')
        : 'Gagal memuat detail order.';
      notifyAlert(message);
    }
  }, [canEditPricing, orderDetails]);

  const savePricingEditor = useCallback(async () => {
    if (!pricingEditor) return;
    if (!canEditPricing) return;

    const orderId = pricingEditor.orderId;
    const toFinite = (value: unknown) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };

    const payloadItems = pricingEditor.items.map((item) => {
      const draft = pricingEditor.drafts[item.order_item_id];
      const unitPrice = toFinite(draft?.unit_price_override);
      return {
        order_item_id: item.order_item_id,
        unit_price_override: unitPrice ?? 0,
        ...(String(draft?.reason || '').trim() ? { reason: String(draft.reason).trim() } : {})
      };
    });

    if (payloadItems.some((row) => !row.order_item_id)) {
      setPricingEditor((prev) => prev ? { ...prev, error: 'Order item tidak valid.' } : prev);
      return;
    }
    if (payloadItems.some((row) => !Number.isFinite(row.unit_price_override) || row.unit_price_override <= 0)) {
      setPricingEditor((prev) => prev ? { ...prev, error: 'Harga deal harus > 0.' } : prev);
      return;
    }

    setPricingEditor((prev) => prev ? { ...prev, saving: true, error: '' } : prev);
    try {
      const reason = pricingEditor.orderReason.trim();
      await api.admin.orderManagement.updatePricing(orderId, {
        items: payloadItems,
        ...(reason ? { reason } : {})
      });
      await loadOrders();

      try {
        const refreshed = await api.orders.getOrderById(orderId);
        setOrderDetails((prev) => ({ ...prev, [orderId]: refreshed.data }));
      } catch { }

      setPricingEditor(null);
    } catch (error: unknown) {
      console.error('Failed to save pricing editor:', error);
      const message = axios.isAxiosError(error)
        ? String((error.response?.data as any)?.message || error.message || 'Gagal menyimpan harga nego.')
        : 'Gagal menyimpan harga nego.';
      setPricingEditor((prev) => prev ? { ...prev, saving: false, error: message } : prev);
    }
  }, [pricingEditor, canEditPricing, loadOrders]);

  useEffect(() => {
    if (!selectedGroup) return;
    const targetOrders = [...groupedOrders.baru, ...groupedOrders.allocated, ...groupedOrders.backorder, ...groupedOrders.pembayaran, ...groupedOrders.gudang, ...groupedOrders.checker, ...groupedOrders.pengiriman, ...groupedOrders.selesai];
    const missingDetails = targetOrders.filter((order) => {
      const orderId = String(order?.id || '').trim();
      if (!orderId) return false;
      if (orderDetailErrors[orderId]) return false;
      return !orderDetails[orderId];
    });
    void loadOrderDetails(missingDetails);
  }, [groupedOrders.baru, groupedOrders.allocated, groupedOrders.backorder, groupedOrders.pembayaran, groupedOrders.gudang, groupedOrders.selesai, selectedGroup, orderDetails, orderDetailErrors, loadOrderDetails]);

  useEffect(() => {
    const detailEntries = Object.entries(orderDetails);
    if (detailEntries.length === 0) return;

    setBackorderHistoryByOrderId((prev) => {
      let changed = false;
      const next = { ...prev };

      detailEntries.forEach(([orderId, detail]) => {
        if (!detail) return;
        const currentSnapshot = buildBackorderSnapshotFromDetail(detail);
        const timelineSnapshots = buildBackorderHistoryFromTimeline(detail);
        const merged = currentSnapshot ? [currentSnapshot, ...timelineSnapshots] : timelineSnapshots;
        const currentIds = (prev[orderId] || []).map((snapshot) => snapshot.snapshotId).join('|');
        const nextIds = merged.map((snapshot) => snapshot.snapshotId).join('|');
        if (currentIds === nextIds) return;
        next[orderId] = merged;
        changed = true;
      });

      return changed ? next : prev;
    });
  }, [orderDetails]);

  useEffect(() => {
    if (!selectedGroup) return;
    const targetOrders = [...groupedOrders.baru, ...groupedOrders.allocated, ...groupedOrders.backorder, ...groupedOrders.pembayaran, ...groupedOrders.gudang, ...groupedOrders.selesai];
    const invoiceIds = Array.from(new Set(
      targetOrders
        .map((order) => {
          const orderId = String(order?.id || '').trim();
          const detail = orderId ? orderDetails[orderId] : undefined;
          return resolveInvoiceRefForOrder(order, detail).invoiceId;
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
        const detailNext: Record<string, InvoiceDetailResponse | null> = {};
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
  }, [selectedGroup, groupedOrders.baru, groupedOrders.allocated, groupedOrders.backorder, groupedOrders.pembayaran, groupedOrders.gudang, groupedOrders.checker, groupedOrders.pengiriman, groupedOrders.selesai, orderDetails, invoiceDetailByInvoiceId, invoiceItemSummaryByInvoiceId]);

  const visibleOrdersForInvoiceBoard = useMemo<AdminOrderListRow[]>(() => {
    if (orderSectionFilter === 'all') {
      return sectionOptions
        .filter((section) => section !== 'selesai')
        .flatMap((section) => filteredGroupedOrders[section]);
    }
    if (orderSectionFilter === 'selesai') return [];
    if (isWarehouseRole && orderSectionFilter === 'backorder') return [];
    return filteredGroupedOrders[orderSectionFilter] || [];
  }, [filteredGroupedOrders, isWarehouseRole, orderSectionFilter, sectionOptions]);

  const backorderActiveOrders = useMemo<AdminOrderListRow[]>(() => {
    if (!forcedCustomerId) return [];
    return filteredGroupedOrders.backorder;
  }, [filteredGroupedOrders.backorder, forcedCustomerId]);

  useEffect(() => {
    if (warehouseCustomerFocusMode) {
      if (!['gudang', 'checker', 'pengiriman'].includes(orderSectionFilter)) setOrderSectionFilter('gudang');
      return;
    }
    if (!isWarehouseRole) return;
    if (orderSectionFilter === 'backorder' || orderSectionFilter === 'all') setOrderSectionFilter('baru');
  }, [isWarehouseRole, orderSectionFilter, warehouseCustomerFocusMode]);

  useEffect(() => {
    if (orderSectionFilter === 'all') setOrderSectionFilter('baru');
  }, [orderSectionFilter]);

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

    visibleOrdersForInvoiceBoard.forEach((order) => {
      const rowId = String(order?.id || '').trim();
      if (!rowId) return;
      const detail = orderDetails[rowId];
      const { invoiceId, invoiceNumber } = resolveInvoiceRefForOrder(order, detail);
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
          current.totalAmount += Number(order?.total_amount || 0);
        } else if (invoiceDetail) {
          current.totalAmount = Number(invoiceDetail?.total || 0);
        }
        const paymentStatus = String(
          invoiceDetail?.payment_status || order?.Invoice?.payment_status || detail?.Invoice?.payment_status || ''
        ).trim().toLowerCase();
        const shipmentStatus = String(
          invoiceDetail?.shipment_status || order?.Invoice?.shipment_status || detail?.Invoice?.shipment_status || ''
        ).trim().toLowerCase();
        if (paymentStatus) current.paymentStatuses.add(paymentStatus);
        if (shipmentStatus) current.shipmentStatuses.add(shipmentStatus);
      } else {
        current.totalAmount += Number(order?.total_amount || 0);
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

  const invoiceStatusBoardSummary = useMemo(() => {
    const paymentCounts = new Map<string, number>();
    const shipmentCounts = new Map<string, number>();
    const managedInvoiceRows = invoiceStatusBoard.filter((row) => Boolean(String(row.invoiceId || row.invoiceNumber || '').trim()));
    let totalValue = 0;
    let totalOrders = 0;

    managedInvoiceRows.forEach((row) => {
      totalValue += row.totalAmount;
      totalOrders += row.orderIds.length;
      paymentCounts.set(row.paymentStatus, Number(paymentCounts.get(row.paymentStatus) || 0) + 1);
      shipmentCounts.set(row.shipmentStatus, Number(shipmentCounts.get(row.shipmentStatus) || 0) + 1);
    });

    const paymentBadges = Array.from(paymentCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([status, count]) => ({
        status,
        count,
        label: paymentStatusLabel(status),
        className: paymentStatusBadge(status),
      }));

    const shipmentBadges = Array.from(shipmentCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([status, count]) => ({
        status,
        count,
        label: shipmentStatusLabel(status),
        className: shipmentStatusBadge(status),
      }));

    return {
      totalInvoices: managedInvoiceRows.length,
      totalOrders,
      totalValue,
      paymentBadges,
      shipmentBadges,
      hiddenPaymentCount: Math.max(0, paymentCounts.size - paymentBadges.length),
      hiddenShipmentCount: Math.max(0, shipmentCounts.size - shipmentBadges.length),
      latestInvoice: managedInvoiceRows[0] || null,
    };
  }, [invoiceStatusBoard]);

  const availabilityByOrderId = useMemo(() => {
    const result: Record<string, Record<string, { allocQty: number; maxInvoice: number }>> = {};
    Object.values(orderDetails).forEach((detail) => {
      if (!detail) return;
      const orderId = String(detail.id);
      const allocations = Array.isArray(detail.Allocations) ? detail.Allocations : [];
      const items = Array.isArray(detail.OrderItems) ? detail.OrderItems : [];
      const itemSummaries = Array.isArray(detail.item_summaries) ? detail.item_summaries : [];
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
          const itemId = String(item.id || '');
          const summaryRow = itemSummaries.find((row: any) => String(row?.order_item_id || '') === itemId);
          const invoicedQty = Number(summaryRow?.invoiced_qty_total || 0);
          availability[String(item.id)] = {
            allocQty,
            maxInvoice: Math.max(0, allocQty - invoicedQty),
          };
        }
      });
      result[orderId] = availability;
    });
    return result;
  }, [orderDetails]);

  const groupedItemsByOrderId = useMemo(() => {
    const result: Record<string, Array<{ product_id: string; qty: number; Product?: ProductLite | null }>> = {};
    Object.values(orderDetails).forEach((detail) => {
      if (!detail) return;
      const orderId = String(detail.id);
      const items = Array.isArray(detail.OrderItems) ? detail.OrderItems : [];
      const byProduct = new Map<string, { product_id: string; qty: number; Product?: ProductLite | null }>();
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
            Product: (item?.Product as ProductLite | null) || null,
          });
        }
      });
      result[orderId] = Array.from(byProduct.values());
    });
    return result;
  }, [orderDetails]);

  const persistedAllocByOrderId = useMemo(() => {
    const result: Record<string, Record<string, number>> = {};
    Object.values(orderDetails).forEach((detail) => {
      if (!detail) return;
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
    Object.values(orderDetails).forEach((detail) => {
      if (!detail) return;
      const orderId = String(detail.id);
      const items = Array.isArray(detail.OrderItems) ? detail.OrderItems : [];
      const allocations = Array.isArray(detail.Allocations) ? detail.Allocations : [];
      const orderedByProduct = new Map<string, number>();
      items.forEach((item: any) => {
        const key = String(item?.product_id || '');
        if (!key) return;
        orderedByProduct.set(
          key,
          Number(orderedByProduct.get(key) || 0) + Math.max(0, Number(item?.ordered_qty_original || item?.qty || 0))
        );
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
    Object.values(orderDetails).forEach((detail) => {
      if (!detail) return;
      const orderId = String(detail.id);
      const items = Array.isArray(detail.OrderItems) ? detail.OrderItems : [];
      const allocations = Array.isArray(detail.Allocations) ? detail.Allocations : [];
      const orderedQty = items.reduce(
        (sum: number, item: any) => sum + Math.max(0, Number(item?.ordered_qty_original || item?.qty || 0)),
        0
      );
      const allocQty = allocations.reduce((sum: number, alloc: any) => sum + Number(alloc?.allocated_qty || 0), 0);
      const remainingQty = Math.max(0, orderedQty - allocQty);
      const allocPct = orderedQty > 0 ? Math.round((allocQty / orderedQty) * 100) : 0;
      result[orderId] = { orderedQty, allocQty, remainingQty, allocPct };
    });
    return result;
  }, [orderDetails]);

  const readyOrderIds = useMemo(() => {
    if (!selectedGroup) return [] as string[];
    const candidateIds = Array.from(
      new Set(
        [...groupedOrders.baru, ...groupedOrders.allocated, ...groupedOrders.backorder]
          .map((order) => String(order?.id || ''))
          .filter(Boolean)
      )
    );

    return candidateIds.filter((orderId) => {
      const detail = orderDetails[orderId];
      if (!detail?.id) return false;

      const rawStatus = String(detail.status || '');
      if (rawStatus !== 'waiting_invoice') return false;

      const availability = availabilityByOrderId[orderId] || {};
      const hasInvoiceableQty = Object.values(availability).some((row) => Number(row?.maxInvoice || 0) > 0);
      return hasInvoiceableQty;
    });
  }, [
    selectedGroup,
    groupedOrders.baru,
    groupedOrders.allocated,
    groupedOrders.backorder,
    orderDetails,
    availabilityByOrderId,
  ]);

  const invoiceableAmountByOrderId = useMemo(() => {
    const result: Record<string, number> = {};
    Object.entries(orderDetails).forEach(([orderId, detail]) => {
      const availability = availabilityByOrderId[orderId] || {};
      const items = Array.isArray(detail?.OrderItems) ? detail.OrderItems : [];
      const amount = items.reduce((sum: number, item: any) => {
        const qty = Number(availability[String(item?.id || '')]?.maxInvoice || 0);
        if (qty <= 0) return sum;
        return sum + Number(item?.price_at_purchase || 0) * qty;
      }, 0);
      result[orderId] = amount;
    });
    return result;
  }, [orderDetails, availabilityByOrderId]);

  const readyInvoiceSummary = useMemo(() => {
    let itemCount = 0;
    readyOrderIds.forEach((orderId) => {
      const detail = orderDetails[orderId];
      if (!detail) return;
      const availability = availabilityByOrderId[orderId] || {};
      const items = Array.isArray(detail.OrderItems) ? detail.OrderItems : [];
      items.forEach((item: any) => {
        const qty = Number(availability[String(item?.id || '')]?.maxInvoice || 0);
        if (qty <= 0) return;
        itemCount += 1;
      });
    });
    const total = readyOrderIds.reduce((sum, orderId) => sum + Number(invoiceableAmountByOrderId[orderId] || 0), 0);
    return { total, itemCount };
  }, [readyOrderIds, orderDetails, availabilityByOrderId, invoiceableAmountByOrderId]);

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

  const saveAllocationDraft = async (orderId: string, draft: Record<string, number>) => {
    const items = buildAllocationPayload(orderId, draft);
    if (items.length === 0) {
      notifyOpen({
        variant: 'warning',
        title: 'Tidak ada alokasi valid',
        message: 'Isi qty alokasi minimal 1 item (dan pastikan tidak melebihi stok/permintaan).',
      });
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
      notifyOpen({
        variant: 'success',
        title: 'Alokasi tersimpan',
        message: 'Qty alokasi sudah tersimpan dan data order diperbarui.',
        autoCloseMs: 1600,
      });
      return true;
    } catch (error: unknown) {
      console.error('Allocation save failed:', error);
      const message = axios.isAxiosError(error)
        ? String((error.response?.data as any)?.message || error.message || 'Gagal menyimpan alokasi.')
        : 'Gagal menyimpan alokasi.';
      notifyOpen({ variant: 'error', title: 'Gagal menyimpan alokasi', message });
      return false;
    } finally {
      setAllocationSaving((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  const handleSaveAllocation = async (orderId: string) => {
    setAllocationConfirm({ orderId, step: 1, action: 'allocation' });
  };

  const handleSaveBackorderAllocationWithConfirm = async (orderId: string) => {
    setAllocationConfirm({ orderId, step: 1, action: 'backorder_allocation' });
  };

  const handleConfirmAllocationStep = async () => {
    if (!allocationConfirm) return;
    if (allocationConfirm.step === 1) {
      if (allocationConfirm.action === 'cancel_backorder' && !backorderCancelReason.trim()) {
        return;
      }
      setAllocationConfirm((prev) => (prev ? { ...prev, step: 2 } : prev));
      return;
    }
    if (allocationConfirm.action === 'cancel_order') {
      try {
        setAllocationSaving((prev) => ({ ...prev, [allocationConfirm.orderId]: true }));
        await api.admin.orderManagement.updateStatus(allocationConfirm.orderId, { status: 'canceled' });
        await loadOrders();
        setAllocationConfirm(null);
      } catch (error: unknown) {
        console.error('Cancel order failed:', error);
        const message = axios.isAxiosError(error)
          ? String((error.response?.data as any)?.message || error.message || 'Gagal membatalkan order.')
          : 'Gagal membatalkan order.';
        notifyAlert(message);
      } finally {
        setAllocationSaving((prev) => ({ ...prev, [allocationConfirm.orderId]: false }));
      }
      return;
    }
    if (allocationConfirm.action === 'cancel_backorder') {
      try {
        const meta = allocationConfirmMeta;
        setAllocationSaving((prev) => ({ ...prev, [allocationConfirm.orderId]: true }));
        await api.allocation.cancelBackorder(allocationConfirm.orderId, backorderCancelReason.trim());
        if (meta) {
          const snapshot: BackorderSnapshot = {
            snapshotId: `cancel-${allocationConfirm.orderId}-${Date.now()}`,
            createdAt: new Date().toISOString(),
            reason: backorderCancelReason.trim(),
            projectedStatus: String(meta.projectedStatus || ''),
            summary: {
              orderedTotal: Number(meta.totals.orderedQty || 0),
              suppliedTotal: Number(meta.totals.allocQty || 0),
              shortageTotal: 0,
              allocatableTotal: 0,
              reducedValue: Number((meta.totals as any)?.reducedValue || 0),
            },
            items: meta.changedItems.map((item) => ({
              product_id: String(item.productId || ''),
              name: String(item.name || 'Produk'),
              sku: String(item.sku || '-'),
              orderedQty: Number(item.orderedQty || 0),
              allocatedQty: Math.max(0, Number(item.orderedQty || 0) - Number(item.beforeQty || 0)),
              shortageQty: 0,
              allocatableQty: 0,
              canceledValue: Number((item as any)?.canceledValue || 0),
            })),
          };
          setBackorderHistoryByOrderId((prev) => ({
            ...prev,
            [allocationConfirm.orderId]: [snapshot, ...(prev[allocationConfirm.orderId] || [])]
          }));
        }
        await loadOrders();
        setBackorderCancelReason('');
        setAllocationConfirm(null);
      } catch (error: unknown) {
        console.error('Batal backorder gagal:', error);
        const message = axios.isAxiosError(error)
          ? String((error.response?.data as any)?.message || error.message || 'Gagal membatalkan backorder.')
          : 'Gagal membatalkan backorder.';
        notifyAlert(message);
      } finally {
        setAllocationSaving((prev) => ({ ...prev, [allocationConfirm.orderId]: false }));
      }
      return;
    }
    if (allocationConfirm.action === 'issue_invoice') {
      try {
        setBusyInvoice(true);
        await api.admin.finance.issueInvoiceBatch(readyOrderIds);
        await loadOrders();
        setAllocationConfirm(null);
      } catch (error: unknown) {
        console.error('Issue invoice failed:', error);
        const message = axios.isAxiosError(error)
          ? String((error.response?.data as any)?.message || error.message || 'Gagal menerbitkan invoice.')
          : 'Gagal menerbitkan invoice.';
        notifyAlert(message);
      } finally {
        setBusyInvoice(false);
      }
      return;
    }
    if (allocationConfirm.action === 'backorder_allocation') {
      const orderId = allocationConfirm.orderId;
      const groupedItems = groupedItemsByOrderId[orderId] || [];
      const persistedAlloc = persistedAllocByOrderId[orderId] || {};
      const allocationDraft = allocationDrafts[orderId] || {};
      const backorderEditorItems = groupedItems
        .map((item) => {
          const productId = String(item?.product_id || '');
          if (!productId) return null;
          const orderedQty = Number(item?.qty || 0);
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
            name: String(item?.Product?.name || 'Produk'),
            sku: String(item?.Product?.sku || '-'),
            orderedQty,
            allocatedQty,
            shortageQty,
            allocatableQty,
          };
        })
        .filter(Boolean) as BackorderEditableItem[];

      const saved = await handleSaveBackorderAllocation(orderId, backorderEditorItems);
      if (saved) {
        setAllocationConfirm(null);
      } else {
        notifyOpen({
          variant: 'warning',
          title: 'Tidak ada top up valid',
          message: 'Tambah qty top up minimal 1 item lalu simpan kembali.',
        });
      }
      return;
    }
    const draft = allocationDrafts[allocationConfirm.orderId] || {};
    const success = await saveAllocationDraft(allocationConfirm.orderId, draft);
    if (success) {
      setAllocationConfirm(null);
    }
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
    if (allocationSaving[orderId]) return false;
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

    if (totalTopup <= 0) return false;

    const saved = await saveAllocationDraft(orderId, nextDraft);
    if (!saved) return false;
    setBackorderTopupDrafts((prev) => ({
      ...prev,
      [orderId]: {}
    }));
    return true;
  };

  const handleCancelBackorder = async (orderId: string) => {
    setBackorderCancelReason('');
    setAllocationConfirm({ orderId, step: 1, action: 'cancel_backorder' });
  };

  const handleCancelOrder = async (orderId: string) => {
    setAllocationConfirm({ orderId, step: 1, action: 'cancel_order' });
  };

  const handleMoveToIndent = async (orderId: string) => {
    if (!orderId) return;
    if (allocationSaving[orderId]) return;
    setAllocationSaving((prev) => ({ ...prev, [orderId]: true }));
    try {
      await api.admin.orderManagement.moveToIndent(orderId);
      setAllocationDrafts((prev) => ({ ...prev, [orderId]: {} }));
      setOrderDetails((prev) => {
        if (!prev[orderId]) return prev;
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
      await loadOrders();
    } catch (error: unknown) {
      console.error('Move to indent failed:', error);
      const message = axios.isAxiosError(error)
        ? String((error.response?.data as any)?.message || error.message || 'Gagal memindahkan order ke indent.')
        : 'Gagal memindahkan order ke indent.';
      notifyAlert(message);
    } finally {
      setAllocationSaving((prev) => ({ ...prev, [orderId]: false }));
    }
  };

  const handleIssueInvoice = async () => {
    if (readyOrderIds.length === 0) return;
    setAllocationConfirm({ orderId: '__batch_invoice__', step: 1, action: 'issue_invoice' });
  };

  const handleBatchAssignWarehouseDriver = async (
    cards: Array<{
      groupKey: string;
      invoiceId?: string;
      invoiceTitle: string;
      orderCount: number;
      readyToShipOrderIds: string[];
      previewIds: string[];
      extraOrderCount: number;
      totalAmount: number;
      customerLabel: string;
    }>
  ) => {
    if (!selectedWarehouseCourierId) {
      notifyAlert('Pilih driver terlebih dahulu.');
      return;
    }
    const selectedCards = cards.filter((card) => selectedWarehouseInvoiceGroups.includes(card.groupKey));
    if (selectedCards.length === 0) {
      notifyAlert('Checklist minimal satu invoice atau order yang siap kirim.');
      return;
    }

    const selectedCourier = couriers.find((item) => item.id === selectedWarehouseCourierId);
    if (!selectedCourier) {
      notifyAlert('Driver tidak ditemukan.');
      return;
    }

    const totalOrdersCount = selectedCards.reduce((sum, c) => sum + c.readyToShipOrderIds.length, 0);
    setWarehouseAssignConfirm({
      step: 1,
      courierId: selectedWarehouseCourierId,
      courierName: selectedCourier.name,
      cards: selectedCards,
      totalOrdersCount,
    });
  };

  const handleConfirmWarehouseAssign = async () => {
    if (!warehouseAssignConfirm) return;
    if (warehouseAssignConfirm.step === 1) {
      setWarehouseAssignConfirm((prev) => (prev ? { ...prev, step: 2 } : prev));
      return;
    }

    try {
      setWarehouseBatchAssigning(true);

      const tasks = warehouseAssignConfirm.cards.map(async (card) => {
        if (card.invoiceId) {
          // Process at Invoice level
          return api.invoices.assignDriver(card.invoiceId, {
            courier_id: warehouseAssignConfirm.courierId
          });
        } else {
          // Process individual orders for non-invoiced groups
          const subTasks = card.readyToShipOrderIds.map(id =>
            api.admin.orderManagement.updateStatus(id, {
              status: 'shipped',
              courier_id: warehouseAssignConfirm.courierId,
            })
          );
          return Promise.all(subTasks);
        }
      });

      const results = await Promise.allSettled(tasks);
      const failedCount = results.filter((result) => result.status === 'rejected').length;

      await loadOrders();
      setSelectedWarehouseInvoiceGroups([]);
      setWarehouseAssignConfirm(null);

      if (failedCount > 0) {
        notifyAlert(`Sebagian grup gagal ditugaskan ke driver (${failedCount}/${warehouseAssignConfirm.cards.length}).`);
      }
    } catch (error: unknown) {
      const message = axios.isAxiosError(error)
        ? String((error.response?.data as any)?.message || error.message || 'Gagal assign driver batch.')
        : 'Gagal assign driver batch.';
      notifyAlert(message);
    } finally {
      setWarehouseBatchAssigning(false);
    }
  };

  const openDeliveryHandoverModal = (invoiceId: string, invoiceTitle: string) => {
    setDeliveryHandoverModal({
      step: 'handover',
      invoiceId,
      invoiceTitle,
      note: '',
      result: 'pass',
      file: null,
    });
  };

  const submitDeliveryHandoverModal = async () => {
    if (!deliveryHandoverModal) return;
    if (!deliveryHandoverModal.invoiceId) return;
    setDeliveryHandoverBusy(true);
    try {
      if (deliveryHandoverModal.step === 'check') {
        const formData = new FormData();
        formData.append('invoice_id', deliveryHandoverModal.invoiceId);
        if (deliveryHandoverModal.note) formData.append('note', deliveryHandoverModal.note);
        formData.append('result', deliveryHandoverModal.result);
        if (deliveryHandoverModal.file) formData.append('evidence', deliveryHandoverModal.file);
        await api.deliveryHandovers.check(formData);
        notifyOpen({ variant: 'success', title: 'Berhasil', message: 'Checking tersimpan.' });
      } else {
        const latest = await api.deliveryHandovers.latest(deliveryHandoverModal.invoiceId);
        const handoverId = Number((latest.data as any)?.handover?.id || 0);
        if (!handoverId) {
          notifyAlert('Handover tidak ditemukan untuk invoice ini.');
          return;
        }
        await api.deliveryHandovers.handover(handoverId);
        notifyOpen({ variant: 'success', title: 'Berhasil', message: 'Handover berhasil. Status menjadi shipped.' });
      }
      setDeliveryHandoverModal(null);
      await loadOrders();
    } catch (error: unknown) {
      const message = axios.isAxiosError(error)
        ? String((error.response?.data as any)?.message || error.message || 'Gagal memproses checker/handover.')
        : 'Gagal memproses checker/handover.';
      notifyAlert(message);
    } finally {
      setDeliveryHandoverBusy(false);
    }
  };

  const allocationConfirmMeta = useMemo(() => {
    if (!allocationConfirm) return null;
    if (allocationConfirm.action === 'issue_invoice') {
      const uniqueReadyOrderIds = Array.from(new Set(readyOrderIds));
      const ordersToInvoice = uniqueReadyOrderIds
        .map((orderId) => {
          const detail = orderDetails[orderId];
          const availability = availabilityByOrderId[orderId] || { orderedQty: 0, allocQty: 0, remainingQty: 0 };
          const orderItems = Array.isArray(detail?.OrderItems) ? detail.OrderItems : [];
          const allocations = Array.isArray(detail?.Allocations) ? detail.Allocations : [];
          const allocatedByProductId = allocations.reduce<Record<string, number>>((acc, allocation) => {
            const productId = String(allocation?.product_id || '');
            if (!productId) return acc;
            acc[productId] = Number(acc[productId] || 0) + Number(allocation?.allocated_qty || 0);
            return acc;
          }, {});
          return {
            orderId,
            customerName: String(detail?.customer_name || detail?.Customer?.name || selectedGroup?.customer_name || 'Customer'),
            orderedQty: Number(availability.orderedQty || 0),
            allocQty: Number(availability.allocQty || 0),
            amount: Number(invoiceableAmountByOrderId[orderId] || 0),
            items: orderItems.map((item) => {
              const productId = String(item?.product_id || '');
              return {
                productId: productId || String(item?.id || ''),
                name: String(item?.Product?.name || 'Produk'),
                sku: String(item?.Product?.sku || '-'),
                orderedQty: Number(item?.qty || 0),
                allocatedQty: Number(allocatedByProductId[productId] || 0),
              };
            }),
          };
        })
        .filter((row) => row.orderId);

      return {
        orderId: allocationConfirm.orderId,
        totals: {
          orderedQty: ordersToInvoice.reduce((sum, row) => sum + row.orderedQty, 0),
          allocQty: ordersToInvoice.reduce((sum, row) => sum + row.allocQty, 0),
          remainingQty: Math.max(0, ordersToInvoice.reduce((sum, row) => sum + row.orderedQty, 0) - ordersToInvoice.reduce((sum, row) => sum + row.allocQty, 0)),
        },
        changedItems: [] as Array<{ productId: string; name: string; sku: string; orderedQty: number; beforeQty: number; afterQty: number }>,
        ordersToInvoice,
      };
    }
    const orderId = allocationConfirm.orderId;
    const groupedItems = groupedItemsByOrderId[orderId] || [];
    const persisted = persistedAllocByOrderId[orderId] || {};
    const draft = allocationDrafts[orderId] || {};
    const orderedQty = groupedItems.reduce((sum, item) => sum + Number(item?.qty || 0), 0);
    const allocQty = groupedItems.reduce((sum, item) => {
      const productId = String(item?.product_id || '');
      if (!productId) return sum;
      const currentQty = Number(draft[productId] !== undefined ? draft[productId] : persisted[productId] || 0);
      return sum + currentQty;
    }, 0);
    const totals = {
      orderedQty,
      allocQty,
      remainingQty: Math.max(0, orderedQty - allocQty),
      allocPct: orderedQty > 0 ? Math.round((allocQty / orderedQty) * 100) : 0,
    };
    if (allocationConfirm.action === 'backorder_allocation') {
      const topupDraft = backorderTopupDrafts[orderId] || {};
      const changedItems = groupedItems
        .map((item) => {
          const productId = String(item?.product_id || '');
          if (!productId) return null;
          const orderedQtyItem = Number(item?.qty || 0);
          const allocatedQtyItem = Number(draft[productId] !== undefined ? draft[productId] : persisted[productId] || 0);
          const shortageQty = Math.max(0, orderedQtyItem - allocatedQtyItem);
          if (shortageQty <= 0) return null;
          const stockQty = Number(item?.Product?.stock_quantity);
          const persistedQty = Number(persisted[productId] || 0);
          const maxAvailable = Number.isFinite(stockQty) ? stockQty + persistedQty : orderedQtyItem;
          const maxAlloc = Math.min(orderedQtyItem, Math.max(0, maxAvailable));
          const allocatableQty = Math.max(0, Math.min(shortageQty, maxAlloc - allocatedQtyItem));
          const requestedTopup = Number(topupDraft[productId] || 0);
          const topupQty = Math.max(0, Math.min(allocatableQty, requestedTopup));
          if (topupQty <= 0) return null;
          return {
            productId,
            name: String(item?.Product?.name || 'Produk'),
            sku: String(item?.Product?.sku || '-'),
            orderedQty: orderedQtyItem,
            beforeQty: allocatedQtyItem,
            afterQty: allocatedQtyItem + topupQty,
          };
        })
        .filter(Boolean) as Array<{ productId: string; name: string; sku: string; orderedQty: number; beforeQty: number; afterQty: number }>;

      const topupQty = changedItems.reduce((sum, item) => sum + Math.max(0, Number(item.afterQty) - Number(item.beforeQty)), 0);
      const allocQtyAfter = allocQty + topupQty;
      return {
        orderId,
        totals: {
          ...totals,
          topupQty,
          allocQty: allocQtyAfter,
          remainingQty: Math.max(0, orderedQty - allocQtyAfter),
          allocPct: orderedQty > 0 ? Math.round((allocQtyAfter / orderedQty) * 100) : 0,
        },
        changedItems,
        ordersToInvoice: [] as Array<{
          orderId: string;
          customerName: string;
          orderedQty: number;
          allocQty: number;
          amount: number;
          items: Array<{ productId: string; name: string; sku: string; orderedQty: number; allocatedQty: number }>;
        }>,
      };
    }
    if (allocationConfirm.action === 'cancel_backorder') {
      const detail = orderDetails[orderId];
      const orderItems = Array.isArray(detail?.OrderItems) ? detail.OrderItems : [];
      const allocations = Array.isArray(detail?.Allocations) ? detail.Allocations : [];
      const allocatedByProductId = allocations.reduce<Record<string, number>>((acc, allocation: any) => {
        const productId = String(allocation?.product_id || '');
        if (!productId) return acc;
        acc[productId] = Number(acc[productId] || 0) + Number(allocation?.allocated_qty || 0);
        return acc;
      }, {});
      const changedItems = groupedItems
        .map((item) => {
          const productId = String(item.product_id || '');
          if (!productId) return null;
          const orderedQtyItem = orderItems
            .filter((row: any) => String(row?.product_id || '') === productId)
            .reduce((sum: number, row: any) => sum + Number(row?.qty || 0), 0);
          const allocatedQtyItem = Number(allocatedByProductId[productId] || 0);
          const backorderQty = Math.max(0, orderedQtyItem - allocatedQtyItem);
          if (backorderQty <= 0) return null;
          return {
            productId,
            name: String(item?.Product?.name || 'Produk'),
            sku: String(item?.Product?.sku || '-'),
            orderedQty: orderedQtyItem,
            beforeQty: backorderQty,
            afterQty: 0,
            canceledValue: backorderQty * Number((orderItems.find((row: any) => String(row?.product_id || '') === productId)?.price_at_purchase) || 0),
          };
        })
        .filter(Boolean) as Array<{ productId: string; name: string; sku: string; orderedQty: number; beforeQty: number; afterQty: number; canceledValue: number }>;
      const reducedValue = orderItems.reduce((sum: number, row: any) => {
        const orderedQtyItem = Number(row?.qty || 0);
        const allocatedQtyItem = Number(allocatedByProductId[String(row?.product_id || '')] || 0);
        const canceledQty = Math.max(0, orderedQtyItem - allocatedQtyItem);
        return sum + (canceledQty * Number(row?.price_at_purchase || 0));
      }, 0);
      const currentTotalAmount = Number(detail?.total_amount || 0);
      const projectedValue = Math.max(0, currentTotalAmount - reducedValue);
      const rawStatus = String(detail?.status || '');
      const projectedStatus = projectedValue <= 0 ? 'canceled' : (rawStatus === 'hold' ? 'waiting_invoice' : rawStatus);
      return {
        orderId,
        totals: {
          ...totals,
          canceledQty: changedItems.reduce((sum, item) => sum + item.beforeQty, 0),
          reducedValue,
          projectedValue,
        },
        changedItems,
        projectedStatus,
        ordersToInvoice: [] as Array<{
          orderId: string;
          customerName: string;
          orderedQty: number;
          allocQty: number;
          amount: number;
          items: Array<{ productId: string; name: string; sku: string; orderedQty: number; allocatedQty: number }>;
        }>,
      };
    }
    const changedItems = groupedItems
      .map((item) => {
        const productId = String(item.product_id || '');
        if (!productId) return null;
        const beforeQty = Number(persisted[productId] || 0);
        const afterQty = Number(draft[productId] !== undefined ? draft[productId] : beforeQty);
        if (beforeQty === afterQty) return null;
        return {
          productId,
          name: String(item?.Product?.name || 'Produk'),
          sku: String(item?.Product?.sku || '-'),
          orderedQty: Number(item?.qty || 0),
          beforeQty,
          afterQty,
        };
      })
      .filter(Boolean) as Array<{ productId: string; name: string; sku: string; orderedQty: number; beforeQty: number; afterQty: number }>;

    return {
      orderId,
      totals,
      changedItems,
      ordersToInvoice: [] as Array<{
        orderId: string;
        customerName: string;
        orderedQty: number;
        allocQty: number;
        amount: number;
        items: Array<{ productId: string; name: string; sku: string; orderedQty: number; allocatedQty: number }>;
      }>,
    };
  }, [allocationConfirm, allocationDrafts, groupedItemsByOrderId, persistedAllocByOrderId, readyOrderIds, orderDetails, availabilityByOrderId, selectedGroup?.customer_name, invoiceableAmountByOrderId, backorderTopupDrafts]);

  if (!allowed && !hasRenderableAccess) {
    return (
      <div className="space-y-4 p-5 pb-24">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold text-slate-700">
            {!isAuthenticated ? 'Sesi login belum aktif.' : 'Memeriksa akses detail order customer...'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {!isAuthenticated
              ? 'Masuk ulang jika halaman ini dibuka setelah refresh browser.'
              : user?.role
                ? `Role terdeteksi: ${user.role}. Jika akses valid, detail order customer akan dimuat otomatis.`
                : 'Jika akses valid, detail order customer akan dimuat otomatis.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 pb-24 space-y-5">
		      {allocationConfirm && allocationConfirmMeta && (
		        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 pb-28 sm:p-6">
          <div className="flex max-h-[calc(100vh-8rem)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-5 pb-4 pt-5">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">
                {allocationConfirm.action === 'cancel_order'
                  ? 'Verifikasi Pembatalan'
                  : allocationConfirm.action === 'backorder_allocation'
                    ? 'Verifikasi Alokasi Backorder'
                  : allocationConfirm.action === 'cancel_backorder'
                    ? 'Verifikasi Cancel Backorder'
                  : allocationConfirm.action === 'issue_invoice'
                    ? 'Verifikasi Issue Invoice'
                    : 'Verifikasi Alokasi'}
              </p>
              <h3 className="mt-2 text-lg font-black text-slate-900">
                {allocationConfirm.action === 'cancel_order'
                  ? allocationConfirm.step === 1
                    ? 'Periksa order sebelum dibatalkan'
                    : 'Konfirmasi batalkan order'
                  : allocationConfirm.action === 'backorder_allocation'
                    ? allocationConfirm.step === 1
                      ? 'Periksa top up backorder sebelum disimpan'
                      : 'Konfirmasi simpan top up backorder'
                  : allocationConfirm.action === 'cancel_backorder'
                    ? allocationConfirm.step === 1
                      ? 'Periksa backorder sebelum dibatalkan'
                      : 'Konfirmasi batalkan backorder'
                  : allocationConfirm.action === 'issue_invoice'
                    ? allocationConfirm.step === 1
                      ? 'Periksa order yang akan dibuat invoice'
                      : 'Konfirmasi terbitkan invoice'
                    : allocationConfirm.step === 1
                      ? 'Periksa alokasi sebelum disimpan'
                      : 'Konfirmasi simpan alokasi'}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {allocationConfirm.action === 'issue_invoice'
                  ? `${allocationConfirmMeta.ordersToInvoice.length} order siap invoice`
                  : `Order #${allocationConfirmMeta.orderId}`}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-[11px] text-slate-700">
                {allocationConfirm.action === 'issue_invoice' ? (
                  <div className="space-y-3">
                    <p>
                      Qty dialokasikan <span className="font-black">{allocationConfirmMeta.totals.allocQty}</span> •
                      Estimasi invoice <span className="font-black">{formatCurrency(readyInvoiceSummary.total)}</span>
                    </p>
                    <div className="space-y-2">
                      {allocationConfirmMeta.ordersToInvoice.slice(0, 8).map((row) => (
                        <div key={row.orderId} className="rounded-xl bg-white px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-semibold text-slate-800">#{row.orderId}</span>
                            <span className="text-slate-500">{formatCurrency(row.amount)}</span>
                          </div>
                          <p className="mt-1 text-[10px] text-slate-500">{row.customerName}</p>
                          <p className="mt-1 text-[10px] text-slate-600">
                            Diminta <span className="font-black">{row.orderedQty}</span> •
                            Dialokasikan <span className="font-black">{row.allocQty}</span>
                          </p>
                          {row.items.length > 0 && (
                            <div className="mt-2 space-y-1 rounded-lg border border-slate-100 bg-slate-50 px-2 py-2">
                              {row.items.slice(0, 4).map((item) => (
                                <div key={item.productId} className="flex items-start justify-between gap-3 text-[10px] text-slate-600">
                                  <div>
                                    <p className="font-semibold text-slate-800">{item.name}</p>
                                    <p className="text-slate-500">SKU {item.sku}</p>
                                  </div>
                                  <div className="text-right">
                                    <p>Pesan <span className="font-black text-slate-900">{item.orderedQty}</span></p>
                                    <p>Alokasi <span className="font-black text-emerald-700">{item.allocatedQty}</span></p>
                                  </div>
                                </div>
                              ))}
                              {row.items.length > 4 && (
                                <p className="text-[10px] text-slate-500">+{row.items.length - 4} barang lain</p>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                      {allocationConfirmMeta.ordersToInvoice.length > 8 && (
                        <p className="text-[10px] text-slate-500">
                          +{allocationConfirmMeta.ordersToInvoice.length - 8} order lain akan ikut diterbitkan invoice
                        </p>
                      )}
                    </div>
                  </div>
                ) : allocationConfirm.action === 'cancel_backorder' ? (
                  <div className="space-y-3">
                    <p>
                      Qty backorder yang dibatalkan <span className="font-black">{Number((allocationConfirmMeta.totals as any)?.canceledQty || 0)}</span> •
                      Nilai dikurangi <span className="font-black">{formatCurrency(Number((allocationConfirmMeta.totals as any)?.reducedValue || 0))}</span> •
                      Status berikutnya <span className="font-black">{String(allocationConfirmMeta.projectedStatus || '-')}</span>
                    </p>
                    <div className="space-y-2">
                      {allocationConfirmMeta.changedItems.map((item) => (
                        <div key={item.productId} className="rounded-xl bg-white px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-semibold text-slate-800">{item.name}</p>
                              <p className="text-[10px] text-slate-500">SKU {item.sku}</p>
                            </div>
                            <div className="text-right text-[10px] text-slate-600">
                              <p>Pesan <span className="font-black text-slate-900">{item.orderedQty}</span></p>
                              <p>Backorder dibatalkan <span className="font-black text-rose-700">{item.beforeQty}</span></p>
                              <p>Nilai <span className="font-black text-rose-700">{formatCurrency(Number((item as any)?.canceledValue || 0))}</span></p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div>
                      <label className="text-[10px] font-black uppercase tracking-widest text-rose-700">
                        Alasan Pembatalan
                      </label>
                      <textarea
                        value={backorderCancelReason}
                        onChange={(e) => setBackorderCancelReason(e.target.value)}
                        rows={3}
                        placeholder="Contoh: customer tidak ingin menunggu sisa qty."
                        className="mt-2 w-full rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none focus:border-rose-400"
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <p>
                      Qty diminta <span className="font-black">{allocationConfirmMeta.totals.orderedQty}</span> •
                      dialokasikan <span className="font-black">{allocationConfirmMeta.totals.allocQty}</span> •
                      sisa <span className="font-black">{allocationConfirmMeta.totals.remainingQty}</span>
                    </p>
                    {allocationConfirm.action === 'backorder_allocation' && Number((allocationConfirmMeta.totals as Record<string, unknown>).topupQty || 0) > 0 && (
                      <p className="mt-2 text-[10px] text-slate-600">
                        Top up backorder <span className="font-black text-amber-700">{Number((allocationConfirmMeta.totals as Record<string, unknown>).topupQty || 0)}</span> qty akan ditambahkan.
                      </p>
                    )}
                  </>
                )}
                {(allocationConfirm.action === 'allocation' || allocationConfirm.action === 'backorder_allocation') && allocationConfirmMeta.changedItems.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {allocationConfirmMeta.changedItems.slice(0, 5).map((item) => (
                      <div key={item.productId} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2">
                        <div>
                          <span className="font-semibold text-slate-800">{item.name}</span>
                          <p className="text-[10px] text-slate-500">SKU {item.sku} • Pesan {item.orderedQty}</p>
                        </div>
                        <div className="text-right text-slate-500">
                          <p>
                            Alokasi <span className="font-black text-slate-900">{item.afterQty}</span>
                          </p>
                          <p className="text-[10px]">sebelumnya {item.beforeQty}</p>
                        </div>
                      </div>
                    ))}
                    {allocationConfirmMeta.changedItems.length > 5 && (
                      <p className="text-[10px] text-slate-500">
                        +{allocationConfirmMeta.changedItems.length - 5} perubahan item lain
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className={`mt-4 rounded-2xl px-4 py-3 text-[11px] ${allocationConfirm.action === 'cancel_order' || allocationConfirm.action === 'cancel_backorder' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-800'}`}>
                {allocationConfirm.action === 'cancel_order'
                  ? allocationConfirm.step === 1
                    ? 'Pastikan order ini memang harus dibatalkan. Setelah dibatalkan, customer akan melihat status order sebagai dibatalkan.'
                    : 'Ini adalah konfirmasi akhir. Batalkan order sekarang?'
                  : allocationConfirm.action === 'backorder_allocation'
                    ? allocationConfirm.step === 1
                      ? 'Periksa qty tambahan backorder yang akan dialokasikan. Pastikan stok tambahan sudah benar sebelum disimpan.'
                      : 'Ini adalah konfirmasi akhir. Simpan top up backorder sekarang?'
                  : allocationConfirm.action === 'cancel_backorder'
                    ? allocationConfirm.step === 1
                      ? 'Pastikan sisa qty ini memang tidak akan ditunggu lagi oleh customer. Qty yang sudah tersuplai tetap dipertahankan.'
                      : 'Ini adalah konfirmasi akhir. Batalkan backorder sekarang?'
                  : allocationConfirm.action === 'issue_invoice'
                    ? allocationConfirm.step === 1
                      ? 'Periksa kembali daftar order yang akan digabung ke invoice. Invoice akan dibuat dari qty alokasi yang saat ini sudah tersimpan.'
                      : 'Ini adalah konfirmasi akhir. Terbitkan invoice untuk daftar order ini sekarang?'
                    : allocationConfirm.step === 1
                      ? 'Pastikan qty yang dijatah sudah sesuai keputusan admin. Setelah disimpan, order yang sudah punya alokasi tidak bisa dibatalkan dari tombol Cancel Order.'
                      : 'Ini adalah konfirmasi akhir. Simpan alokasi sekarang dan lanjutkan order sesuai qty yang sudah dijatah.'}
              </div>
            </div>

	            <div className="border-t border-slate-200 bg-white px-5 py-4">
	              <div className="flex flex-wrap items-center justify-end gap-2">
	                <button
	                  type="button"
	                  onClick={() => setAllocationConfirm(null)}
	                  className="btn-3d rounded-xl border border-slate-200 px-4 py-2 text-[11px] font-bold text-slate-600"
	                >
	                  Batal
	                </button>
	                {allocationConfirm.step === 2 && (
	                  <button
	                    type="button"
	                    onClick={() => setAllocationConfirm({ orderId: allocationConfirm.orderId, step: 1, action: allocationConfirm.action })}
	                    className={`btn-3d rounded-xl px-4 py-2 text-[11px] font-bold ${allocationConfirm.action === 'cancel_order' || allocationConfirm.action === 'cancel_backorder' ? 'border border-rose-200 bg-rose-50 text-rose-700' : 'border border-amber-200 bg-amber-50 text-amber-700'}`}
	                  >
	                    Kembali
	                  </button>
	                )}
	                <button
	                  type="button"
	                  onClick={() => void handleConfirmAllocationStep()}
	                  disabled={allocationConfirm.action === 'cancel_backorder' && allocationConfirm.step === 1 && !backorderCancelReason.trim()}
	                  className={`btn-3d rounded-xl px-4 py-2 text-[11px] font-black uppercase tracking-wider text-white disabled:opacity-50 ${allocationConfirm.action === 'cancel_order' || allocationConfirm.action === 'cancel_backorder' ? 'bg-rose-600' : 'bg-emerald-600'}`}
	                >
                  {allocationConfirm.step === 1
                    ? 'Lanjut Verifikasi'
                    : allocationConfirm.action === 'cancel_order'
                      ? 'Ya, Batalkan Order'
                      : allocationConfirm.action === 'backorder_allocation'
                        ? 'Ya, Simpan Backorder'
                      : allocationConfirm.action === 'cancel_backorder'
                        ? 'Ya, Batalkan Backorder'
                      : allocationConfirm.action === 'issue_invoice'
                        ? 'Ya, Terbitkan Invoice'
                        : 'Ya, Simpan Alokasi'}
                </button>
              </div>
            </div>
          </div>
        </div>
	      )}
	      {pricingEditor && (
	        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 pb-28 sm:p-6">
	          <div className="flex max-h-[calc(100vh-8rem)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
	            <div className="border-b border-slate-200 px-5 pb-4 pt-5">
	              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Harga Nego</p>
	              <h3 className="mt-2 text-lg font-black text-slate-900">Edit harga deal sebelum invoice</h3>
	              <p className="mt-1 text-xs text-slate-500">Order #{pricingEditor.orderId}</p>
	            </div>

	            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
	              <div>
	                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Keterangan Nego (Opsional)</label>
	                <textarea
	                  value={pricingEditor.orderReason}
	                  onChange={(e) => setPricingEditor((prev) => prev ? { ...prev, orderReason: e.target.value } : prev)}
	                  rows={2}
	                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
	                  placeholder="Mis: harga khusus kenalan / diskon nego..."
	                />
	                <p className="mt-1 text-[11px] text-slate-500">
	                  Catatan: kasir tidak boleh di bawah modal, dan harga deal tidak boleh lebih tinggi dari harga normal (baseline).
	                </p>
	              </div>

	              {pricingEditor.error ? (
	                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
	                  {pricingEditor.error}
	                </div>
	              ) : null}

	              <div className="space-y-2">
	                {pricingEditor.items.map((row) => {
	                  const draft = pricingEditor.drafts[row.order_item_id];
	                  return (
	                    <div key={row.order_item_id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
	                      <div className="flex flex-wrap items-start justify-between gap-3">
	                        <div className="min-w-0">
	                          <p className="text-xs font-black text-slate-900 truncate">{row.product_name}</p>
	                          <p className="text-[10px] text-slate-500 truncate">SKU {row.sku} • Qty {row.qty}</p>
	                          <p className="mt-1 text-[10px] text-slate-500">
	                            Baseline {formatCurrency(row.baseline_unit_price)} • Saat ini {formatCurrency(row.current_unit_price)}
	                            {row.cost_at_purchase !== null ? ` • Modal ${formatCurrency(row.cost_at_purchase)}` : ''}
	                          </p>
	                        </div>
	                        <div className="flex flex-col items-end gap-2">
	                          <div className="flex items-center gap-2">
	                            <label className="text-[10px] font-bold text-slate-500">Harga deal</label>
	                            <input
	                              type="number"
	                              min={0}
	                              value={draft?.unit_price_override ?? ''}
	                              onChange={(e) => {
	                                const value = e.target.value;
	                                setPricingEditor((prev) => {
	                                  if (!prev) return prev;
	                                  return {
	                                    ...prev,
	                                    drafts: {
	                                      ...prev.drafts,
	                                      [row.order_item_id]: { ...(prev.drafts[row.order_item_id] || { unit_price_override: '', reason: '' }), unit_price_override: value }
	                                    }
	                                  };
	                                });
	                              }}
	                              className="w-28 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-right"
	                            />
	                          </div>
	                          <input
	                            type="text"
	                            placeholder="Keterangan item (opsional)"
	                            value={draft?.reason ?? ''}
	                            onChange={(e) => {
	                              const value = e.target.value;
	                              setPricingEditor((prev) => {
	                                if (!prev) return prev;
	                                return {
	                                  ...prev,
	                                  drafts: {
	                                    ...prev.drafts,
	                                    [row.order_item_id]: { ...(prev.drafts[row.order_item_id] || { unit_price_override: '', reason: '' }), reason: value }
	                                  }
	                                };
	                              });
	                            }}
	                            className="w-60 max-w-full rounded-xl border border-slate-200 bg-slate-50 px-2 py-1 text-xs"
	                          />
	                        </div>
	                      </div>
	                    </div>
	                  );
	                })}
	              </div>
	            </div>

	            <div className="border-t border-slate-200 bg-white px-5 py-4 flex flex-wrap items-center justify-end gap-2">
	              <button
	                type="button"
	                onClick={() => setPricingEditor(null)}
	                disabled={pricingEditor.saving}
	                className="btn-3d rounded-xl border border-slate-200 bg-white px-4 py-2 text-[11px] font-bold text-slate-700 disabled:opacity-50"
	              >
	                Batal
	              </button>
	              <button
	                type="button"
	                onClick={() => void savePricingEditor()}
	                disabled={pricingEditor.saving}
	                className="btn-3d rounded-xl bg-slate-900 px-4 py-2 text-[11px] font-black uppercase tracking-wider text-white disabled:opacity-50"
	              >
	                {pricingEditor.saving ? 'Menyimpan...' : 'Simpan Harga'}
	              </button>
	            </div>
	          </div>
	        </div>
	      )}
	      {warehouseAssignConfirm && (
	        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 pb-28 sm:p-6">
          <div className="flex max-h-[calc(100vh-8rem)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-5 pb-4 pt-5">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-600">Verifikasi Tunjuk Driver</p>
              <h3 className="mt-2 text-lg font-black text-slate-900">
                {warehouseAssignConfirm.step === 1 ? 'Periksa invoice yang akan dikirim' : 'Konfirmasi tunjuk driver'}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Driver tujuan: <span className="font-bold text-slate-700">{warehouseAssignConfirm.courierName}</span> •
                {' '} {warehouseAssignConfirm.cards.length} grup • {warehouseAssignConfirm.totalOrdersCount} order
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="space-y-3">
                {warehouseAssignConfirm.cards.map((card) => (
                  <div key={card.groupKey} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-slate-900">{card.invoiceTitle}</p>
                        <p className="text-[10px] text-slate-500">{card.customerLabel}</p>
                      </div>
                      <p className="text-[11px] font-bold text-slate-700">{formatCurrency(card.totalAmount)}</p>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-600">
                      {card.orderCount} order • {card.readyToShipOrderIds.length} order siap kirim
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {card.previewIds.map((id) => (
                        <span key={id} className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-slate-600">
                          {id}
                        </span>
                      ))}
                      {card.extraOrderCount > 0 && (
                        <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-slate-500">
                          +{card.extraOrderCount} order lain
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-slate-200 px-5 py-4">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] text-amber-800">
                Pastikan invoice yang dicentang memang akan dikirim oleh driver yang sama. Invoice yang tidak dicentang tidak akan ikut diproses.
              </div>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (warehouseBatchAssigning) return;
                    setWarehouseAssignConfirm(null);
                  }}
                  className="btn-3d rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600"
                  disabled={warehouseBatchAssigning}
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmWarehouseAssign()}
                  className="btn-3d rounded-xl bg-amber-600 px-4 py-2 text-xs font-black uppercase tracking-wider text-white disabled:opacity-50"
                  disabled={warehouseBatchAssigning}
                >
                  {warehouseBatchAssigning
                    ? 'Memproses...'
                    : warehouseAssignConfirm.step === 1
                      ? 'Lanjut Verifikasi'
                      : 'Ya, Tunjuk Driver'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] mb-1">Order Command</p>
          <h1 className="text-xl font-black text-slate-900">
            {forcedCustomerId ? (forcedCustomerName || selectedGroup?.customer_name || 'Detail Order Customer') : 'Daftar Customer Order'}
          </h1>
          <p className="text-xs text-slate-500">
            {forcedCustomerId
              ? 'Fokus pada order customer terpilih. Gunakan halaman ini untuk meninjau order, invoice, gudang, dan backorder customer tersebut.'
              : 'Klik customer untuk melihat order dan pilih item untuk invoice.'}
          </p>
        </div>
      </div>

	      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
	        <div className="space-y-3">
	          {forcedCustomerId && (
	            <Link
	              href="/admin/orders"
	              className="btn-3d inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 shadow-sm hover:bg-slate-50"
	            >
	              Kembali ke daftar customer
	            </Link>
	          )}
	          <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm flex items-center gap-2">
	            <Users size={16} className="text-slate-400" />
	            <p className="text-xs text-slate-600">
	              {forcedCustomerId
                ? `Customer ${selectedGroup?.customer_name || forcedCustomerName || forcedCustomerId}`
                : `Scope Customer (${filteredCustomerGroups.length}/${customerGroups.length})`}
            </p>
          </div>
          {forcedCustomerId && (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-slate-500">Customer terpilih</p>
                <p className="text-lg font-black text-slate-900">
                  {selectedGroup?.customer_name || forcedCustomerName || 'Customer'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-slate-400">Order baru aktif</p>
                <p className="text-sm font-black text-slate-900">{selectedGroup?.counts.baru || 0}</p>
                <p className="text-[10px] text-slate-500">Backorder aktif</p>
                <p className="text-xs font-bold text-amber-700">{selectedGroup?.counts.backorder || 0}</p>
              </div>
            </div>
          )}
          {!forcedCustomerId && (
            <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Filter Customer</label>
              <div className="flex items-center gap-2">
                <Search size={14} className="text-slate-400" />
                <input
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                  placeholder="Nama atau ID customer"
                  className="w-full bg-transparent text-xs font-semibold text-slate-700 focus:outline-none"
                />
              </div>
              <p className="text-[11px] text-slate-500">
                Halaman ini fokus menampilkan daftar order masuk dan backorder. Pilih detail per order dari card di sisi kanan.
              </p>
            </div>
          )}
          <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              {forcedCustomerId ? 'Ringkasan Customer' : 'Ringkasan Filter'}
            </p>
            {loading ? (
              <div className="mt-2 h-16 rounded-xl bg-slate-100 animate-pulse" />
            ) : (
              <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-bold">
                <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">Baru {selectedGroup?.counts.baru || 0}</span>
                {!isWarehouseRole && (
                  <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700">Backorder {selectedGroup?.counts.backorder || 0}</span>
                )}
                <span className="px-2 py-1 rounded-full bg-cyan-100 text-cyan-700">Sedang Terkirim {selectedGroup?.counts.pengiriman || 0}</span>
                <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700">Bayar {selectedGroup?.counts.pembayaran || 0}</span>
                <span className="px-2 py-1 rounded-full bg-indigo-100 text-indigo-700">Proses Gudang {selectedGroup?.counts.gudang || 0}</span>
                <span className="px-2 py-1 rounded-full bg-sky-100 text-sky-700">Checker {selectedGroup?.counts.checker || 0}</span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {selectedGroup ? (
            <>
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-slate-500">
                    {forcedCustomerId ? 'Detail order customer' : 'Scope data'}
                  </p>
                  <p className="text-lg font-black text-slate-900">
                    {forcedCustomerId ? (selectedGroup?.customer_name || forcedCustomerName || 'Order Customer') : 'Daftar Order Terfilter'}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {forcedCustomerId
                      ? `${selectedGroup?.orders.length || 0} order milik customer ini`
                      : `${filteredCustomerGroups.length} customer cocok dengan filter customer saat ini`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-slate-400">Order siap invoice</p>
                  <p className="text-sm font-black text-slate-900">{readyOrderIds.length}</p>
                  <p className="text-[10px] text-slate-500">Estimasi nilai invoice</p>
                  <p className="text-xs text-emerald-700 font-bold">{formatCurrency(readyInvoiceSummary.total)}</p>
                </div>
              </div>

              {!isWarehouseRole && (
                <div className="bg-slate-900 text-white rounded-2xl p-4 flex flex-col gap-2">
                  <p className="text-xs font-bold">Terbitkan Invoice</p>
                  <p className="text-[11px] text-white/70">
                    {forcedCustomerId
                      ? 'Invoice dihitung dari qty yang sudah dialokasikan untuk order customer ini yang siap invoice.'
                      : 'Invoice dihitung dari qty yang sudah dialokasikan untuk order yang siap invoice (lintas order ID).'}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-xl bg-white/10 px-3 py-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-white/60">Sudah Berinvoice</p>
                      <p className="mt-1 text-lg font-black text-white">{formatCurrency(invoiceStatusBoardSummary.totalValue)}</p>
                      <p className="text-[11px] text-white/70">Hanya menghitung order yang invoice-nya sudah terbit.</p>
                    </div>
                    <div className="rounded-xl bg-emerald-500/15 px-3 py-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-emerald-200">Nilai Siap Invoice</p>
                      <p className="mt-1 text-lg font-black text-white">{formatCurrency(readyInvoiceSummary.total)}</p>
                      <p className="text-[11px] text-emerald-100/90">Order yang sudah dialokasikan dan siap diterbitkan invoice.</p>
                    </div>
                  </div>
                  {canIssueInvoice ? (
                    <button
                      onClick={handleIssueInvoice}
                      disabled={busyInvoice || readyOrderIds.length === 0}
                      className="btn-3d mt-2 px-4 py-2 rounded-xl bg-emerald-500 text-xs font-black uppercase disabled:opacity-50"
                    >
                      {busyInvoice ? 'Memproses...' : 'Issue Invoice'}
                    </button>
                  ) : (
                    <p className="text-[11px] text-white/70">Hanya kasir atau super admin yang bisa menerbitkan invoice.</p>
                  )}
                </div>
              )}

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
                    const count = selectedGroup ? selectedGroup.counts[filter as OrderSection] || 0 : 0;
                    return (
                      <button
                        key={filter}
                        type="button"
                        onClick={() => setOrderSectionFilter(filter)}
                        className={`btn-3d px-2 py-1 rounded-full text-[10px] font-bold border ${active ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'
                          }`}
                      >
                        <span>{label}</span>
                        <span className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[9px] font-black ${active ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                          {count}
                        </span>
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
                  <div className="space-y-3">
                    <div className="flex justify-end">
                      <Link
                        href={
                          selectedGroup?.customer_id
                            ? `/admin/orders/invoice-history?customerId=${encodeURIComponent(selectedGroup.customer_id)}&customerName=${encodeURIComponent(selectedGroup.customer_name)}`
                            : '/admin/orders/invoice-history'
                        }
                        className="btn-3d inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                      >
                        Buka Riwayat Invoice Selesai
                      </Link>
                    </div>

                  </div>
                )}
              </div>

              {forcedCustomerId && orderSectionFilter === 'backorder' && (
                <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h2 className="text-xs font-black uppercase tracking-widest text-slate-400">Backorder Aktif</h2>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Lacak sisa item backorder per order, termasuk qty yang sudah tersuplai dan yang masih tertahan.
                        </p>
                      </div>
                      <span className="rounded-full bg-amber-50 px-3 py-1 text-[10px] font-black text-amber-700">
                        {backorderActiveOrders.length} order backorder
                      </span>
                    </div>
                    {backorderActiveOrders.length === 0 ? (
                      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <p className="text-xs text-slate-500">Belum ada backorder aktif untuk customer ini.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
	                        {backorderActiveOrders.map((order) => {
	                          const orderId = String(order?.id || '');
	                      const detail = orderDetails[orderId];
	                      const rawOrderStatus = String(order?.status || '');
	                      const orderStatus = normalizeOrderStatus(rawOrderStatus);
	                      const { invoiceId, invoiceNumber } = resolveInvoiceRefForOrder(order, detail);
	                      const invoiceDetail = invoiceId ? invoiceDetailByInvoiceId[invoiceId] : null;
	                      const canCancelBackorderEarly = canAllocate;
                      const allocationBusy = Boolean(allocationSaving[orderId]);
                          const groupedItems = groupedItemsByOrderId[orderId] || [];
                          const persistedAlloc = persistedAllocByOrderId[orderId] || {};
                          const allocationDraft = allocationDrafts[orderId] || {};
                          const invoiceShipmentStatus = String(invoiceDetail?.shipment_status || order?.shipment_status || '').trim().toLowerCase();
                          const isBackorderAllocationEditable = BACKORDER_REALLOCATABLE_STATUSES.has(rawOrderStatus);
                          const backorderLockReason = getBackorderAllocationLockReason({
                            invoiceDetail,
                            invoiceShipmentStatus
                          });
                          const isBackorderAllocationActionEnabled =
                            canAllocate && isBackorderAllocationEditable && !backorderLockReason;
                          const backorderEditorItems = groupedItems
                            .map((item) => {
                              const productId = String(item?.product_id || '');
                              if (!productId) return null;
                              const orderedQty = Number(item?.qty || 0);
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
                                name: String(item?.Product?.name || 'Produk'),
                                sku: String(item?.Product?.sku || '-'),
                                orderedQty,
                                allocatedQty,
                                shortageQty,
                                allocatableQty,
                              };
                            })
                            .filter(Boolean) as BackorderEditableItem[];
                          const backorderEditorSummary = backorderEditorItems.reduce(
                            (acc, item) => ({
                              orderedTotal: acc.orderedTotal + item.orderedQty,
                              suppliedTotal: acc.suppliedTotal + item.allocatedQty,
                              shortageTotal: acc.shortageTotal + item.shortageQty,
                              allocatableTotal: acc.allocatableTotal + item.allocatableQty,
                            }),
                            { orderedTotal: 0, suppliedTotal: 0, shortageTotal: 0, allocatableTotal: 0 }
                          );
                          const backorderDirty = backorderEditorItems.some((item) => {
                            const requestedTopup = Number(backorderTopupDrafts[orderId]?.[item.product_id] ?? 0);
                            const topupQty = Math.max(0, Math.min(item.allocatableQty, requestedTopup));
                            return topupQty > 0;
                          });
                          if (backorderEditorItems.length === 0) return null;

                          return (
                            <div
                              key={`backorder:${orderId}`}
                              className={`rounded-2xl border bg-amber-50/40 p-4 shadow-sm ${
                                orderId === initialFocusOrderId
                                  ? 'border-amber-400 ring-2 ring-amber-200'
                                  : 'border-amber-200'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-black text-slate-900">Order #{orderId}</p>
                                  <p className="text-[11px] text-slate-500">{formatDateTime(order?.createdAt)}</p>
                                  <p className="mt-1 text-[11px] text-amber-700">
                                    Status fulfillment {normalizeOrderStatus(order?.status) || '-'}
                                    {invoiceId || invoiceNumber ? ` • Invoice ${formatInvoiceReference(invoiceId, invoiceNumber)}` : ' • Belum invoice'}
                                  </p>
                                </div>
                                <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-700">
                                  {backorderEditorItems.length} item backorder
                                </span>
                              </div>
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleAutoFillBackorder(orderId, backorderEditorItems)}
                                  disabled={!isBackorderAllocationActionEnabled || allocationBusy || backorderEditorItems.length === 0}
                                  className="btn-3d px-3 py-1 rounded-lg text-[10px] font-bold border border-amber-200 text-amber-700 disabled:opacity-50"
                                >
                                  Auto Fill
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleSaveBackorderAllocationWithConfirm(orderId)}
                                  disabled={!isBackorderAllocationActionEnabled || allocationBusy || !backorderDirty}
                                  className="btn-3d px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-amber-600 text-white disabled:opacity-50"
                                >
                                  {allocationBusy ? 'Menyimpan...' : 'Selesai Alokasi'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleCancelBackorder(orderId)}
                                  disabled={!canCancelBackorderEarly || allocationBusy}
                                  className="btn-3d px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-rose-600 text-white disabled:opacity-50"
                                >
                                  Cancel Backorder
                                </button>
                              </div>
                              <div className="mt-3 rounded-2xl border border-amber-100 bg-amber-50/60 p-3 space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Edit Backorder</p>
                                    <p className="text-[11px] text-amber-700">
                                      Total {backorderEditorSummary.orderedTotal} • Tersuplai {backorderEditorSummary.suppliedTotal}
                                      {backorderEditorSummary.shortageTotal > 0 ? ` • Backorder ${backorderEditorSummary.shortageTotal}` : ''}
                                      {backorderEditorSummary.allocatableTotal > 0
                                        ? ` • Bisa dialokasikan lagi ${backorderEditorSummary.allocatableTotal}`
                                        : ' • Belum ada stok tambahan'}
                                    </p>
                                  </div>
                                  <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-amber-700 border border-amber-200">
                                    {backorderEditorItems.length} item editable
                                  </span>
                                </div>
                                {backorderLockReason && (
                                  <p className="text-[10px] text-amber-700">
                                    {backorderLockReason}
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
                                  {backorderEditorItems.map((item) => {
                                    const topupDraft = Number(backorderTopupDrafts[orderId]?.[item.product_id] ?? 0);
                                    const topupQty = Math.max(0, Math.min(item.allocatableQty, topupDraft));
                                    return (
                                      <div key={`editor:${item.product_id}`} className="rounded-xl border border-amber-100 bg-white px-3 py-3">
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                          <div>
                                            <p className="text-xs font-bold text-slate-900">{item.name}</p>
                                            <p className="text-[10px] text-slate-500">SKU {item.sku}</p>
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
                                          <div className="min-w-[150px] space-y-1 text-right">
                                            <p className="text-[10px] text-amber-600">Top Up Alokasi</p>
                                            <div className="flex items-center justify-end gap-1">
                                              <button
                                                type="button"
                                                onClick={() => handleBackorderTopupChange(orderId, item.product_id, item.allocatableQty, String(topupQty - 1))}
                                                disabled={!isBackorderAllocationActionEnabled || allocationBusy || item.allocatableQty <= 0 || topupQty <= 0}
                                                className="btn-3d inline-flex h-7 w-7 items-center justify-center rounded-lg border border-amber-200 bg-white text-amber-700 disabled:opacity-50"
                                                aria-label="Kurangi top up alokasi"
                                              >
                                                <Minus size={14} />
                                              </button>
                                              <input
                                                type="number"
                                                min={0}
                                                max={item.allocatableQty}
                                                value={topupQty}
                                                disabled={!isBackorderAllocationActionEnabled || allocationBusy || item.allocatableQty <= 0}
                                                onChange={(e) => handleBackorderTopupChange(orderId, item.product_id, item.allocatableQty, e.target.value)}
                                                className="w-24 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-right disabled:opacity-60"
                                              />
                                              <button
                                                type="button"
                                                onClick={() => handleBackorderTopupChange(orderId, item.product_id, item.allocatableQty, String(topupQty + 1))}
                                                disabled={!isBackorderAllocationActionEnabled || allocationBusy || item.allocatableQty <= 0 || topupQty >= item.allocatableQty}
                                                className="btn-3d inline-flex h-7 w-7 items-center justify-center rounded-lg border border-amber-200 bg-white text-amber-700 disabled:opacity-50"
                                                aria-label="Tambah top up alokasi"
                                              >
                                                <Plus size={14} />
                                              </button>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
              )}

              {detailsLoading && (
                <div className="text-xs text-slate-400">Memuat detail order...</div>
              )}

              {sectionOptions.map((section) => {
                if (forcedCustomerId && section === 'backorder') return null;
                if (orderSectionFilter !== 'all' && orderSectionFilter !== section) return null;
                const label = getSectionLabel(section);
                const list = filteredGroupedOrders[section] as AdminOrderListRow[];
                if (list.length === 0) return null;
	                const isWarehouseCompactView = isWarehouseRole || (canManageWarehouseFlow && ['gudang', 'checker', 'pengiriman'].includes(section));
                const canUseWarehouseChecklist = canAssignDriverWarehouse;
                const isFinanceCompactView = isFinanceRole && ['pembayaran', 'gudang', 'pengiriman', 'selesai'].includes(section);
                const isInvoiceCompactView = isWarehouseCompactView || isFinanceCompactView;
                if (isInvoiceCompactView) {
                  const invoiceBuckets = list.reduce<Map<string, WarehouseInvoiceBucket>>((acc, row) => {
                    const rowId = String(row?.id || '');
                    if (!rowId) return acc;
                    const detail = orderDetails[rowId];
                    const invoiceId = normalizeInvoiceRef(row?.invoice_id || row?.Invoice?.id || detail?.invoice_id || detail?.Invoice?.id);
                    const invoiceNumber = normalizeInvoiceRef(
                      row?.invoice_number || row?.Invoice?.invoice_number || detail?.invoice_number || detail?.Invoice?.invoice_number
                    );
                    const groupKey = invoiceId ? `id:${invoiceId}` : invoiceNumber ? `num:${invoiceNumber.toLowerCase()}` : `order:${rowId}`;

                    // To ensure we get ALL orders for this invoice (even those not in the current 'list' section),
                    // we can't just reduce 'list'. However, to maintain the tab's filtering, we initialize from 'list' 
                    // and then we will enrichment it below if needed, OR we can just find all related orders now.

                    const bucket: WarehouseInvoiceBucket = acc.get(groupKey) || {
                      groupKey,
                      invoiceId,
                      invoiceNumber,
                      orders: [],
                    };

                    // Only add if not already present (shouldn't happen in reduce but safe)
                    if (!bucket.orders.some((bucketOrder) => String(bucketOrder?.id || '') === rowId)) {
                      bucket.orders.push(row);
                    }

                    acc.set(groupKey, bucket);
                    return acc;
                  }, new Map<string, WarehouseInvoiceBucket>());

                  // Enrichment: Ensure all orders for the same invoice are in the bucket if they exist in the customer group
                  if (selectedGroup) {
                    invoiceBuckets.forEach((bucket) => {
                      if (!bucket.invoiceId && !bucket.invoiceNumber) return;
                      selectedGroup.orders.forEach((otherOrder) => {
                        const otherOrderId = String(otherOrder?.id || '');
                        if (bucket.orders.some((bucketOrder) => String(bucketOrder?.id || '') === otherOrderId)) return;

                        const otherDetail = orderDetails[otherOrderId];
                        const otherInvoiceId = normalizeInvoiceRef(otherOrder?.invoice_id || otherOrder?.Invoice?.id || otherDetail?.invoice_id || otherDetail?.Invoice?.id);
                        const otherInvoiceNum = normalizeInvoiceRef(otherOrder?.invoice_number || otherOrder?.Invoice?.invoice_number || otherDetail?.invoice_number || otherDetail?.Invoice?.invoice_number);

                        const isSameInvoice = (bucket.invoiceId && otherInvoiceId === bucket.invoiceId) ||
                          (bucket.invoiceNumber && otherInvoiceNum.toLowerCase() === bucket.invoiceNumber.toLowerCase());

                        if (isSameInvoice) {
                          bucket.orders.push(otherOrder);
                        }
                      });
                    });
                  }

                  const warehouseCards = Array.from(invoiceBuckets.values())
                    .map((bucket: WarehouseInvoiceBucket) => {
                      const invoiceId = bucket.invoiceId;
                      const invoiceSummary = invoiceId ? invoiceItemSummaryByInvoiceId[invoiceId] : undefined;
                      const invoiceDetail = invoiceId ? invoiceDetailByInvoiceId[invoiceId] : null;

                      let allocatedQty = 0;
                      let totalAmount = invoiceDetail ? Number(invoiceDetail.total || 0) : 0;
                      let latestTs = 0;
                      let hasMissingDetails = false;
                      let hasMissingInvoiceSummary = false;
                      const allocatedSkuSet = new Set<string>();
                      const statusSet = new Set<string>();
                      const paymentMethodSet = new Set<string>();
                      const paymentStatusSet = new Set<string>();

                      bucket.orders.forEach((row) => {
                        const rowId = String(row?.id || '');
                        if (!rowId) return;

                        // Fallback totalAmount if invoice detail not loaded
                        if (!invoiceDetail) {
                          totalAmount += Number(row?.total_amount || 0);
                        }

                        const detail = orderDetails[rowId];
                        const normalizedStatus = resolveWorkspaceShipmentStatus(row, detail);
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
                        .map((row) => String(row?.id || ''))
                        .filter(Boolean);
                      const previewIds = orderIds.slice(0, 3).map((id: string) => `#${id.slice(-8).toUpperCase()}`);
                      const extraOrderCount = Math.max(0, orderIds.length - previewIds.length);
                      const hasReadyToShip = bucket.orders.some((row) => {
                        const rowId = String(row?.id || '');
                        return resolveWorkspaceShipmentStatus(row, orderDetails[rowId]) === 'ready_to_ship';
                      });
                      const hasChecked = bucket.orders.some((row) => {
                        const rowId = String(row?.id || '');
                        return resolveWorkspaceShipmentStatus(row, orderDetails[rowId]) === 'checked';
                      });
                      const readyToShipOrderIds = bucket.orders
                        .filter((row) => {
                          const rowId = String(row?.id || '');
                          return resolveWorkspaceShipmentStatus(row, orderDetails[rowId]) === 'ready_to_ship';
                        })
                        .map((row) => String(row?.id || ''))
                        .filter(Boolean);
                      const hasShipped = bucket.orders.some((row) => {
                        const rowId = String(row?.id || '');
                        return resolveWorkspaceShipmentStatus(row, orderDetails[rowId]) === 'shipped';
                      });
                      const primaryOrder =
                        bucket.orders.find((row) => {
                          const rowId = String(row?.id || '');
                          return resolveWorkspaceShipmentStatus(row, orderDetails[rowId]) === 'ready_to_ship';
                        }) ||
                        bucket.orders[0] ||
                        null;
                      const primaryOrderId = String(primaryOrder?.id || '');
                      const primaryOrderDetail = primaryOrderId ? orderDetails[primaryOrderId] : undefined;
                      const courierId = String(
                        (invoiceDetail as any)?.courier_id ||
                        (primaryOrderDetail as any)?.Invoice?.courier_id ||
                        (primaryOrder as any)?.Invoice?.courier_id ||
                        (primaryOrder as any)?.courier_id ||
                        ''
                      ).trim();
                      const statusLabel = statusSet.size <= 1 ? (Array.from(statusSet)[0] || '-') : `${statusSet.size} status`;
                      const actionLabel = isFinanceCompactView
                        ? 'Lihat Detail Invoice'
                        : hasReadyToShip
                          ? `Tunjuk Driver (${orderIds.length} order)`
                          : hasShipped
                            ? 'Lihat Pengiriman'
                            : isWarehouseCompactView
                              ? 'Lihat Detail Invoice'
                              : 'Proses Gudang';
                      const paymentMethodLabel = (() => {
                        if (paymentMethodSet.size !== 1) return `${paymentMethodSet.size} metode`;
                        const raw = String(Array.from(paymentMethodSet)[0] || '').trim().toLowerCase();
                        if (!raw || raw === 'pending') return 'Mengikuti Driver';
                        if (raw === 'cod') return 'COD';
                        if (raw === 'transfer_manual') return 'Transfer';
                        if (raw === 'cash_store') return 'Cash Store';
                        return raw.toUpperCase();
                      })();
                      const paymentStatusLabel = paymentStatusSet.size <= 1
                        ? (Array.from(paymentStatusSet)[0] || '-')
                        : `${paymentStatusSet.size} status bayar`;
                      const invoiceTitle = bucket.invoiceNumber
                        ? `Invoice ${bucket.invoiceNumber}`
                        : bucket.invoiceId
                          ? `Invoice ID ${bucket.invoiceId}`
                          : 'Invoice belum tercatat';
                      const customerLabel = Array.from(
                        new Set(
                          bucket.orders
                            .map((row) => String((row as any)?.customer_name || row?.Customer?.name || selectedGroup?.customer_name || 'Customer'))
                            .filter(Boolean)
                        )
                      ).join(', ');
                      return {
                        groupKey: bucket.groupKey,
                        invoiceId: bucket.invoiceId,
                        invoiceTitle,
                        customerLabel,
                        orderCount: orderIds.length,
                        previewIds,
                        extraOrderCount,
                        statusLabel,
                        totalAmount,
                        allocatedQty,
                        allocatedSkuCount: allocatedSkuSet.size,
                        readyToShipOrderIds,
                        primaryOrderId,
                        courierId,
                        hasReadyToShip,
                        hasChecked,
                        hasShipped,
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
                      {canUseWarehouseChecklist && section === 'gudang' && warehouseCards.some((card) => card.readyToShipOrderIds.length > 0) && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Checklist Tunjuk Driver</p>
                              <p className="text-[11px] text-amber-700">
                                Pilih invoice yang ingin dikirim dengan driver yang sama. Invoice yang tidak dicentang otomatis dikecualikan.
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => setSelectedWarehouseInvoiceGroups(warehouseCards.filter((card) => card.readyToShipOrderIds.length > 0).map((card) => card.groupKey))}
                                className="rounded-lg border border-amber-200 bg-white px-3 py-1 text-[10px] font-bold text-amber-700"
                              >
                                Pilih Semua
                              </button>
                              <button
                                type="button"
                                onClick={() => setSelectedWarehouseInvoiceGroups([])}
                                className="rounded-lg border border-amber-200 bg-white px-3 py-1 text-[10px] font-bold text-amber-700"
                              >
                                Hapus Checklist
                              </button>
                            </div>
                          </div>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <select
                              value={selectedWarehouseCourierId}
                              onChange={(e) => setSelectedWarehouseCourierId(e.target.value)}
                              className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm outline-none"
                              disabled={warehouseBatchAssigning}
                            >
                              <option value="">Pilih driver/kurir</option>
                              {couriers.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => void handleBatchAssignWarehouseDriver(warehouseCards)}
                              disabled={warehouseBatchAssigning || !selectedWarehouseCourierId || selectedWarehouseInvoiceGroups.length === 0}
                              className="rounded-xl bg-amber-600 px-4 py-2 text-[11px] font-black uppercase tracking-wider text-white disabled:opacity-50"
                            >
                              {warehouseBatchAssigning ? 'Memproses...' : `Tunjuk Driver (${selectedWarehouseInvoiceGroups.length} invoice)`}
                            </button>
                          </div>
                        </div>
                      )}
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
                              {canUseWarehouseChecklist && section === 'gudang' && card.readyToShipOrderIds.length > 0 && (
                                <label className="mb-2 inline-flex items-center gap-2 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">
                                  <input
                                    type="checkbox"
                                    checked={selectedWarehouseInvoiceGroups.includes(card.groupKey)}
                                    onChange={(e) => {
                                      setSelectedWarehouseInvoiceGroups((prev) =>
                                        e.target.checked
                                          ? Array.from(new Set([...prev, card.groupKey]))
                                          : prev.filter((groupKey) => groupKey !== card.groupKey)
                                      );
                                    }}
                                    className="h-3.5 w-3.5 rounded border-amber-300 text-amber-600"
                                  />
                                  Checklist kirim invoice ini
                                </label>
                              )}
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
                              {(card.invoiceId || card.primaryOrderId) && section !== 'checker' && (
                                <Link
                                  href={`/admin/orders/${card.invoiceId || card.primaryOrderId}`}
                                  className={`mt-1 text-[10px] font-black uppercase transition-all ${card.actionLabel.includes('Tunjuk Driver')
                                    ? 'btn-3d inline-flex items-center px-3 py-2 bg-amber-600 text-white rounded-xl shadow-sm shadow-amber-200 hover:bg-amber-700 active:scale-95'
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
                              {canManageWarehouseFlow && section === 'checker' && card.invoiceId && (
                                <div className="mt-2 flex flex-col items-end gap-2">
                                  {card.hasReadyToShip && !card.hasChecked && !card.hasShipped && (
                                    card.courierId ? (
                                      <Link
                                        href={`/admin/tracker-gudang/${encodeURIComponent(card.invoiceId)}`}
                                        className="rounded-xl bg-cyan-600 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-white hover:bg-cyan-700 active:scale-95"
                                      >
                                        Mulai Checking
                                      </Link>
                                    ) : (
                                      <button
                                        type="button"
                                        disabled
                                        className="rounded-xl bg-slate-200 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-500"
                                      >
                                        Assign driver dulu
                                      </button>
                                    )
                                  )}
                                  {card.hasChecked && !card.hasShipped && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (!card.courierId) {
                                          notifyAlert('Invoice belum ditugaskan ke driver.');
                                          return;
                                        }
                                        openDeliveryHandoverModal(card.invoiceId, card.invoiceTitle);
                                      }}
                                      className="rounded-xl bg-blue-600 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-white hover:bg-blue-700 active:scale-95 disabled:opacity-50"
                                      disabled={deliveryHandoverBusy || !card.courierId}
                                    >
                                      Handover: Set Shipped
                                    </button>
                                  )}
                                </div>
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
                      const detail = orderDetails[String(order.id)];
                      const orderStatus = resolveWorkspaceShipmentStatus(order, detail);
                      const totals = orderTotalsById[String(order.id)] || { orderedQty: 0, allocQty: 0, remainingQty: 0, allocPct: 0 };
                      const groupedItems = groupedItemsByOrderId[String(order.id)] || [];
                      const persistedAlloc = persistedAllocByOrderId[String(order.id)] || {};
                      const allocationDraft = allocationDrafts[String(order.id)] || {};
                      const shortageSummary = shortageSummaryByOrderId[String(order.id)] || { orderedTotal: 0, allocatedTotal: 0, shortageTotal: 0 };
                      const isAllocatedOnlyView = Boolean(forcedCustomerId && orderSectionFilter === 'allocated');
                      const invoiceableOrderAmount = Number(invoiceableAmountByOrderId[String(order.id)] || 0);
                      const showInvoiceableAmount = rawOrderStatus === 'waiting_invoice' && invoiceableOrderAmount > 0;
                      const isAllocationEditable = ALLOCATION_EDITABLE_STATUSES.has(rawOrderStatus);
                      const isBackorderAllocationEditable = BACKORDER_REALLOCATABLE_STATUSES.has(rawOrderStatus);
                      const canCancelBackorderEarly = canAllocate;
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
                      const { invoiceId, invoiceNumber } = resolveInvoiceRefForOrder(order as any, detail as any);
                      const invoiceRefLabel = formatInvoiceReference(invoiceId, invoiceNumber);
                      const invoiceDetail = invoiceId ? invoiceDetailByInvoiceId[invoiceId] : null;
                      const invoicePaymentStatus = String(
                        invoiceDetail?.payment_status || order?.Invoice?.payment_status || detail?.Invoice?.payment_status || ''
                      ).trim().toLowerCase();
                      const invoiceShipmentStatus = String(
                        invoiceDetail?.shipment_status || order?.Invoice?.shipment_status || detail?.Invoice?.shipment_status || ''
                      ).trim().toLowerCase();
                      const backorderLockReason = getBackorderAllocationLockReason({
                        invoiceDetail,
                        invoiceShipmentStatus
                      });
                      const isBackorderAllocationActionEnabled =
                        canAllocate && isBackorderAllocationEditable && !backorderLockReason;
                      const warehouseTargetId = normalizeInvoiceRef(invoiceId || order?.id);
                      const warehouseActionLabel = orderStatus === 'ready_to_ship'
                        ? invoiceGroupCount > 1
                          ? `Tunjuk Driver (${invoiceGroupCount} order)`
                          : 'Tunjuk Driver'
                        : orderStatus === 'shipped'
                          ? 'Lihat Pengiriman'
                          : 'Proses Gudang';
                      const isBackorder = isOrderBackorder(order, detail, backorderIds);
                      const isOrderCancelable =
                        canCancelOrder &&
                        CANCELABLE_ORDER_STATUSES.has(rawOrderStatus) &&
                        !isBackorder &&
                        Number(totals.allocQty || 0) <= 0;
                      const allocationDirty = groupedItems.some((item) => {
                        const productId = String(item.product_id || '');
                        if (!productId) return false;
                        const draftQty = Number(allocationDraft[productId] ?? 0);
                        const persistedQty = Number(persistedAlloc[productId] ?? 0);
                        return draftQty !== persistedQty;
                      });
                      const indentCandidates = groupedItems
                        .map((item) => {
                          const productId = String(item?.product_id || '').trim();
                          if (!productId) return null;
                          const orderedQty = Math.max(0, Number(item?.qty || 0));
                          if (orderedQty <= 0) return null;

                          const allocatedQty = Math.max(0, Number(persistedAlloc[productId] || 0));
                          if (allocatedQty > 0) return null;

                          const stockQtyRaw = Number(item?.Product?.stock_quantity);
                          if (!Number.isFinite(stockQtyRaw) || stockQtyRaw > 0) return null;

                          const shortageQty = Math.max(0, orderedQty - allocatedQty);
                          if (shortageQty <= 0) return null;

                          return {
                            product_id: productId,
                            sku: String(item?.Product?.sku || '-'),
                            name: String(item?.Product?.name || 'Produk'),
                            shortageQty,
                          };
                        })
                        .filter(Boolean) as Array<{ product_id: string; sku: string; name: string; shortageQty: number }>;
                      const indentQty = indentCandidates.reduce((sum, row) => sum + Number(row.shortageQty || 0), 0);
                      const canMoveToIndent =
                        canMoveToIndentAction &&
                        isAllocationEditable &&
                        !allocationBusy &&
                        !allocationDirty &&
                        !isBackorder &&
                        Number(totals.allocQty || 0) <= 0 &&
                        indentQty > 0;
                      const allocationAttentionSummary = groupedItems.reduce(
                        (acc, item) => {
                          const productId = String(item.product_id || '');
                          if (!productId) return acc;
                          const orderedQty = Number(item.qty || 0);
                          const persistedQty = Number(persistedAlloc[productId] || 0);
                          const allocatedQty = Number(
                            allocationDraft[productId] !== undefined
                              ? allocationDraft[productId]
                              : persistedQty
                          );
                          const shortageQty = Math.max(0, orderedQty - allocatedQty);
                          if (shortageQty <= 0) return acc;

                          const stockQty = Number(item?.Product?.stock_quantity);
                          const maxAvailable = Number.isFinite(stockQty) ? stockQty + persistedQty : orderedQty;
                          const maxAlloc = Math.min(orderedQty, Math.max(0, maxAvailable));
                          const allocatableNow = Math.max(0, Math.min(shortageQty, maxAlloc - allocatedQty));

                          acc.hasShortage = true;
                          acc.allocatableNowTotal += allocatableNow;
                          if (allocatableNow < shortageQty) acc.hasStockConstraint = true;
                          return acc;
                        },
                        { hasShortage: false, hasStockConstraint: false, allocatableNowTotal: 0 }
                      );
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
                      const backorderCard = orderSectionFilter === 'backorder'
                        && canAllocate
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
                                  className="btn-3d px-3 py-1 rounded-lg text-[10px] font-bold border border-amber-200 text-amber-700 disabled:opacity-50"
                                >
                                  Auto Fill
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleSaveBackorderAllocationWithConfirm(String(order.id))}
                                  disabled={!isBackorderAllocationActionEnabled || allocationBusy || !backorderDirty}
                                  className="btn-3d px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-amber-600 text-white disabled:opacity-50"
                                >
                                  {allocationBusy ? 'Menyimpan...' : 'Selesai Alokasi'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleCancelBackorder(String(order.id))}
                                  disabled={!canCancelBackorderEarly || allocationBusy}
                                  className="btn-3d px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-rose-600 text-white disabled:opacity-50"
                                >
                                  Cancel Backorder
                                </button>
                              </div>
                            </div>
                            {backorderLockReason && (
                              <p className="text-[10px] text-amber-700">
                                {backorderLockReason}
                              </p>
                            )}
                            {canCancelBackorderEarly && !isBackorderAllocationActionEnabled && (
                              <p className="text-[10px] text-rose-700">
                                Backorder sudah bisa dibatalkan lebih awal bila customer tidak ingin menunggu sisa qty.
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
                                        <div className="flex items-center justify-end gap-1">
                                          <button
                                            type="button"
                                            onClick={() => handleBackorderTopupChange(String(order.id), item.product_id, item.allocatableQty, String(topupQty - 1))}
                                            disabled={!isBackorderAllocationActionEnabled || allocationBusy || item.allocatableQty <= 0 || topupQty <= 0}
                                            className="btn-3d inline-flex h-7 w-7 items-center justify-center rounded-lg border border-amber-200 bg-white text-amber-700 disabled:opacity-50"
                                            aria-label="Kurangi top up alokasi"
                                          >
                                            <Minus size={14} />
                                          </button>
                                          <input
                                            type="number"
                                            min={0}
                                            max={item.allocatableQty}
                                            value={topupQty}
                                            disabled={!isBackorderAllocationActionEnabled || allocationBusy || item.allocatableQty <= 0}
                                            onChange={(e) => handleBackorderTopupChange(String(order.id), item.product_id, item.allocatableQty, e.target.value)}
                                            className="w-24 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-right disabled:opacity-60"
                                          />
                                          <button
                                            type="button"
                                            onClick={() => handleBackorderTopupChange(String(order.id), item.product_id, item.allocatableQty, String(topupQty + 1))}
                                            disabled={!isBackorderAllocationActionEnabled || allocationBusy || item.allocatableQty <= 0 || topupQty >= item.allocatableQty}
                                            className="btn-3d inline-flex h-7 w-7 items-center justify-center rounded-lg border border-amber-200 bg-white text-amber-700 disabled:opacity-50"
                                            aria-label="Tambah top up alokasi"
                                          >
                                            <Plus size={14} />
                                          </button>
                                        </div>
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
                                  {Number(snapshot.summary.reducedValue || 0) > 0 ? ` • Nilai berkurang ${formatCurrency(Number(snapshot.summary.reducedValue || 0))}` : ''}
                                </p>
                                {snapshot.reason && (
                                  <p className="text-[10px] text-amber-700">
                                    Alasan: <span className="font-bold">{snapshot.reason}</span>
                                  </p>
                                )}
                                {snapshot.projectedStatus && (
                                  <p className="text-[10px] text-amber-700">
                                    Status setelah pembatalan: <span className="font-bold">{snapshot.projectedStatus}</span>
                                  </p>
                                )}
                              </div>
                              <div className="space-y-2">
                                {snapshot.items.map((item) => (
                                  <div key={`${snapshot.snapshotId}:${item.product_id}`} className="bg-white border border-amber-100 rounded-xl p-3">
                                    <p className="text-xs font-bold text-slate-900">{item.name}</p>
                                    <p className="text-[10px] text-slate-500">SKU: {item.sku}</p>
                                    <p className="text-[10px] text-slate-500">
                                      Pesan {item.orderedQty} • Tersuplai {item.allocatedQty} • Backorder {item.shortageQty}
                                    </p>
                                    {Number(item.canceledValue || 0) > 0 && (
                                      <p className="text-[10px] font-bold text-rose-600">
                                        Nilai dibatalkan {formatCurrency(Number(item.canceledValue || 0))}
                                      </p>
                                    )}
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
                              <p className="mt-1 text-sm font-black text-slate-900">
                                {formatCurrency(showInvoiceableAmount ? invoiceableOrderAmount : Number(order.total_amount || 0))}
                              </p>
                              {showInvoiceableAmount && (
                                <p className="text-[10px] font-bold text-emerald-700">Nilai siap invoice</p>
                              )}
	                              {canOpenWarehouseAction && (
	                                <Link
	                                  href={`/admin/orders/${warehouseTargetId}`}
	                                  className={`mt-1 text-[10px] font-black uppercase transition-all ${warehouseActionLabel.includes('Tunjuk Driver')
	                                    ? 'btn-3d inline-flex items-center px-3 py-2 bg-amber-600 text-white rounded-xl shadow-sm shadow-amber-200 hover:bg-amber-700 active:scale-95'
	                                    : 'inline-block font-bold text-emerald-700 hover:text-emerald-800'
	                                    }`}
	                                >
	                                  {warehouseActionLabel}
	                                </Link>
	                              )}
	                              {canEditPricing
	                                && !invoiceId
	                                && !invoiceNumber
	                                && ['pending', 'waiting_invoice', 'allocated', 'hold', 'partially_fulfilled'].includes(String(rawOrderStatus || '').trim().toLowerCase())
	                                && (
	                                  <button
	                                    type="button"
	                                    onClick={() => void openPricingEditor(String(order.id))}
	                                    className="btn-3d mt-1 inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50"
	                                  >
	                                    Harga Nego
	                                  </button>
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

                          <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-bold">
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
                              Qty {totals.orderedQty}
                            </span>
                            <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">
                              Alokasi {totals.allocQty}
                            </span>
                            {totals.remainingQty > 0 && (
                              <span
                                className={`rounded-full px-2 py-1 ${allocationAttentionSummary.hasStockConstraint
                                  ? 'bg-rose-100 text-rose-700'
                                  : 'bg-amber-100 text-amber-700'
                                  }`}
                              >
                                {allocationAttentionSummary.hasStockConstraint ? 'Stok kurang' : 'Belum dialokasikan'} {totals.remainingQty}
                              </span>
                            )}
                            {!isBackorder && Number(totals.allocQty || 0) <= 0 && indentQty > 0 && (
                              <span className="rounded-full bg-indigo-100 px-2 py-1 text-indigo-700">
                                Indent {indentQty}
                              </span>
                            )}
                            {isBackorder && (
                              <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">
                                Backorder {backorderSummary.shortageTotal || totals.remainingQty}
                              </span>
                            )}
                            {Boolean((order as any)?.active_issue) && (
                              <span className="rounded-full bg-rose-100 px-2 py-1 text-rose-700">
                                Ada issue driver
                              </span>
                            )}
                          </div>

                          {!showInlineOrderDetailPanel && (
                            <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                Detail Order Dipisah
                              </p>
                              <p className="mt-1 text-[11px] text-slate-600">
                                Halaman ini fokus ke daftar order masuk dan backorder. Detail alokasi, invoice, gudang, driver, dan riwayat order dibuka dari halaman detail order.
                              </p>
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <Link
                                  href={`/admin/orders/${order.id}`}
                                  className="btn-3d inline-flex items-center rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-white"
                                >
                                  Buka Detail Order
                                </Link>
                                {canOpenWarehouseAction && warehouseTargetId && (
                                  <Link
                                    href={`/admin/orders/${warehouseTargetId}`}
                                    className={`text-[10px] font-black uppercase transition-all ${warehouseActionLabel.includes('Tunjuk Driver')
                                      ? 'btn-3d inline-flex items-center px-3 py-2 bg-amber-600 text-white rounded-lg shadow-sm shadow-amber-200 hover:bg-amber-700 active:scale-95'
                                      : 'btn-3d inline-flex items-center rounded-lg border border-emerald-200 bg-white px-3 py-2 text-emerald-700 hover:bg-emerald-50'
                                      }`}
                                  >
                                    {warehouseActionLabel}
                                  </Link>
                                )}
                                {isOrderCancelable && (
                                  <button
                                    type="button"
                                    onClick={() => void handleCancelOrder(String(order.id))}
                                    disabled={allocationBusy}
                                    className="btn-3d px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider bg-rose-600 text-white disabled:opacity-50"
                                  >
                                    Cancel Order
                                  </button>
                                )}
                              </div>
                            </div>
                          )}

                          {showInlineOrderDetailPanel && backorderCard}

                          {showInlineOrderDetailPanel && Boolean((order as any)?.active_issue) && (
                            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
                              <div className="flex items-center gap-2 text-amber-700">
                                <AlertCircle size={16} />
                                <p className="text-[10px] font-black uppercase tracking-widest">Laporan Masalah Driver</p>
                              </div>
                              <p className="text-xs font-semibold text-slate-800 bg-white/50 p-2 rounded-xl border border-amber-100 italic">
                                {String((order as any)?.active_issue?.note || '')}
                              </p>
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-[10px] text-amber-600">
                                  Tipe: <span className="font-bold">{String((order as any)?.active_issue?.issue_type || '-')}</span> • Batas: {formatDateTime((order as any)?.active_issue?.due_at ? String((order as any)?.active_issue?.due_at) : null)}
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

                          {showInlineOrderDetailPanel && section !== 'selesai' && !detail && canViewAllocation && (
                            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-3 space-y-2">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="space-y-1">
                                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Detail order belum termuat</p>
                                  <p className="text-[11px] text-amber-700">
                                    {orderDetailErrors[String(order.id)]
                                      ? `Gagal memuat detail: ${orderDetailErrors[String(order.id)]}`
                                      : detailsLoading
                                        ? 'Sedang memuat detail order...'
                                        : 'Detail order belum tersedia. Coba muat ulang.'}
                                  </p>
                                  <p className="text-[10px] text-amber-700/80">
                                    Tanpa detail order, tombol alokasi/indent bisa tidak muncul. Jika masih gagal, kemungkinan data order bermasalah di server.
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => retryLoadOrderDetail(order)}
                                    disabled={detailsLoading}
                                    className="btn-3d rounded-lg border border-amber-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wider text-amber-700 disabled:opacity-50"
                                  >
                                    Muat Ulang
                                  </button>
                                  {canMoveToIndentAction &&
                                    ALLOCATION_EDITABLE_STATUSES.has(rawOrderStatus) &&
                                    !allocationBusy &&
                                    !isBackorder &&
                                    (Array.isArray((order as any)?.Allocations)
                                      ? (order as any).Allocations.reduce((sum: number, row: any) => sum + Number(row?.allocated_qty || 0), 0)
                                      : 0) <= 0 && (
                                      <button
                                        type="button"
                                        onClick={() => void handleMoveToIndent(String(order.id))}
                                        disabled={allocationBusy}
                                        className="btn-3d rounded-lg bg-indigo-700 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-white disabled:opacity-50"
                                      >
                                        Pindahkan ke Indent
                                      </button>
                                    )}
                                  <Link
                                    href={`/admin/orders/${order.id}`}
                                    className="btn-3d inline-flex items-center rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-white"
                                  >
                                    Buka Detail
                                  </Link>
                                </div>
                              </div>
                            </div>
                          )}

                          {showInlineOrderDetailPanel && section !== 'selesai' && detail && canViewAllocation && (
                            <div className="mt-3 border border-slate-100 rounded-2xl p-3 bg-slate-50/60 space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Alokasi Stok</p>
                                  <p className="text-[11px] text-slate-500">
                                    Total {shortageSummary.orderedTotal} • Dialokasikan {shortageSummary.allocatedTotal}
                                    {!isAllocatedOnlyView && shortageSummary.shortageTotal > 0 ? ` • Kurang ${shortageSummary.shortageTotal}` : ''}
                                  </p>
                                </div>
                                {canAllocate ? (
                                  <div className="flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleAutoAllocate(String(order.id))}
                                      disabled={!isAllocationEditable || allocationBusy}
                                      className="btn-3d px-3 py-1 rounded-lg text-[10px] font-bold border border-slate-200 text-slate-600 disabled:opacity-50"
                                    >
                                      Auto Fill
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleSaveAllocation(String(order.id))}
                                      disabled={!isAllocationEditable || allocationBusy || !allocationDirty}
                                      className="btn-3d px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-emerald-600 text-white disabled:opacity-50"
                                    >
                                      {allocationBusy ? 'Menyimpan...' : 'Selesai Alokasi'}
                                    </button>
                                    {isOrderCancelable && (
                                      <button
                                        type="button"
                                        onClick={() => void handleCancelOrder(String(order.id))}
                                        disabled={allocationBusy}
                                        className="btn-3d px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider bg-rose-600 text-white disabled:opacity-50"
                                      >
                                        Cancel Order
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <p className="text-[10px] text-slate-500">Read only untuk role gudang.</p>
                                )}
                              </div>
                              {!isAllocatedOnlyView && shortageSummary.shortageTotal > 0 && (
                                <div
                                  className={`rounded-xl px-3 py-3 ${allocationAttentionSummary.hasStockConstraint
                                    ? 'border border-rose-200 bg-rose-50'
                                    : 'border border-amber-200 bg-amber-50'
                                    }`}
                                >
                                  <div className="flex items-start gap-2">
                                    <AlertCircle
                                      size={16}
                                      className={`mt-0.5 shrink-0 ${allocationAttentionSummary.hasStockConstraint ? 'text-rose-600' : 'text-amber-600'}`}
                                    />
                                    <div className="space-y-1">
                                      <p
                                        className={`text-[11px] font-black uppercase tracking-wide ${allocationAttentionSummary.hasStockConstraint ? 'text-rose-700' : 'text-amber-700'}`}
                                      >
                                        {allocationAttentionSummary.hasStockConstraint
                                          ? 'Stok Kurang'
                                          : shortageSummary.allocatedTotal > 0
                                            ? 'Order Ini Dialokasikan Sebagian'
                                            : 'Order Ini Belum Dialokasikan'}
                                      </p>
                                      <p className={`text-[11px] ${allocationAttentionSummary.hasStockConstraint ? 'text-rose-700' : 'text-amber-700'}`}>
                                        {allocationAttentionSummary.hasStockConstraint ? (
                                          <>
                                            Diminta <span className="font-black">{shortageSummary.orderedTotal}</span> qty •
                                            dialokasikan <span className="font-black">{shortageSummary.allocatedTotal}</span> qty •
                                            kurang <span className="font-black">{shortageSummary.shortageTotal}</span> qty.
                                            Stok yang tersedia belum cukup untuk memenuhi seluruh permintaan.
                                          </>
                                        ) : shortageSummary.allocatedTotal > 0 ? (
                                          <>
                                            Diminta <span className="font-black">{shortageSummary.orderedTotal}</span> qty •
                                            dialokasikan <span className="font-black">{shortageSummary.allocatedTotal}</span> qty •
                                            sisa <span className="font-black">{shortageSummary.shortageTotal}</span> qty.
                                            Order ini sudah dijatah sebagian dan sisa qty belum dialokasikan.
                                          </>
                                        ) : (
                                          <>
                                            Diminta <span className="font-black">{shortageSummary.orderedTotal}</span> qty •
                                            dialokasikan <span className="font-black">{shortageSummary.allocatedTotal}</span> qty •
                                            belum dialokasikan <span className="font-black">{shortageSummary.shortageTotal}</span> qty.
                                            Stok masih cukup, tetapi order ini belum diisi alokasinya.
                                          </>
                                        )}
                                      </p>
                                      {!allocationAttentionSummary.hasStockConstraint && allocationAttentionSummary.allocatableNowTotal > 0 && (
                                        <p className="text-[11px] font-bold text-amber-700">
                                          Bisa langsung dialokasikan sekarang: {allocationAttentionSummary.allocatableNowTotal} qty
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}
                              {canMoveToIndent && (
                                <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-3">
                                  <p className="text-[10px] font-black uppercase tracking-widest text-indigo-700">Indent (stok 0)</p>
                                  <p className="mt-1 text-[11px] text-indigo-700">
                                    Ada <span className="font-black">{indentCandidates.length}</span> produk stok 0 yang belum dialokasikan (
                                    {indentCandidates.slice(0, 3).map((row) => row.sku).join(', ')}
                                    {indentCandidates.length > 3 ? ', …' : ''}
                                    ).
                                  </p>
                                  <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => void handleMoveToIndent(String(order.id))}
                                      disabled={allocationBusy}
                                      className="btn-3d rounded-xl bg-indigo-700 px-4 py-2 text-[11px] font-black uppercase tracking-wider text-white disabled:opacity-50"
                                    >
                                      {allocationBusy ? 'Memproses...' : 'Pindahkan ke Indent'}
                                    </button>
                                    <p className="text-[10px] text-indigo-700">
                                      Sistem akan membuat backorder untuk item yang stoknya 0 sehingga order masuk ke section backorder.
                                    </p>
                                  </div>
                                </div>
                              )}
                              {!allocationDirty && (
                                <div className="space-y-1">
                                  <p className="text-[10px] text-emerald-600">
                                    {isAllocatedOnlyView
                                      ? 'Menampilkan barang yang sudah dialokasikan untuk order ini.'
                                      : shortageSummary.shortageTotal > 0
                                      ? allocationAttentionSummary.hasStockConstraint
                                        ? 'Alokasi belum penuh karena stok belum mencukupi.'
                                        : 'Alokasi belum penuh. Qty pesanan masih belum diisikan ke alokasi.'
                                      : rawOrderStatus === 'waiting_invoice'
                                        ? 'Alokasi tersimpan. Siap terbitkan invoice.'
                                        : rawOrderStatus === 'waiting_admin_verification'
                                          ? 'Alokasi tersimpan. Order sedang menunggu verifikasi admin finance atas bukti pembayaran.'
                                          : orderStatus === 'ready_to_ship'
                                            ? 'Alokasi tersimpan. Invoice sudah terbit. Lanjut proses gudang / tunjuk driver.'
                                            : 'Alokasi tersimpan. Menunggu order masuk ke fase siap invoice.'}
                                  </p>
                                  {!isAllocatedOnlyView && shortageSummary.shortageTotal === 0 && rawOrderStatus === 'waiting_invoice' && (
                                    <p className="text-[10px] text-slate-500">
                                      Order ini sudah masuk fase siap invoice. Invoice akan mengikuti qty yang sudah dijatah admin melalui alokasi yang tersimpan.
                                    </p>
                                  )}
                                  {!isAllocatedOnlyView && shortageSummary.shortageTotal === 0 && rawOrderStatus !== 'waiting_invoice' && rawOrderStatus !== 'waiting_admin_verification' && orderStatus !== 'ready_to_ship' && (
                                    <p className="text-[10px] text-slate-500">
                                      Qty alokasi ditentukan admin. Saat order masuk ke <span className="font-bold">waiting_invoice</span>, invoice akan diterbitkan mengikuti qty yang sudah dialokasikan.
                                    </p>
                                  )}
                                  {!isAllocatedOnlyView && shortageSummary.shortageTotal > 0 && (
                                    <p className="text-[10px] text-slate-500">
                                      Admin bisa menjatah qty sesuai stok yang dipilih. Bila perlu invoice parsial, simpan alokasi sesuai jatah yang ingin diterbitkan.
                                    </p>
                                  )}
                                  {isAllocatedOnlyView && (
                                    <p className="text-[10px] text-slate-500">
                                      Filter ini hanya menampilkan item yang sudah dialokasikan. Sisa backorder dan kekurangan qty dipantau di filter <span className="font-bold">Backorder</span>.
                                    </p>
                                  )}
                                </div>
                              )}
                              {!isAllocationEditable && (
                                <div className="space-y-1">
                                  <p className="text-[10px] text-amber-600">
                                    Alokasi dikunci pada status <span className="font-bold">{order.status}</span>.
                                  </p>
                                  {rawOrderStatus === 'waiting_admin_verification' && (
                                    <p className="text-[10px] text-slate-500">
                                      Order ini sedang menunggu verifikasi admin finance atas bukti pembayaran yang sudah diunggah customer.
                                    </p>
                                  )}
                                </div>
                              )}
                              {groupedItems.length === 0 ? (
                                <p className="text-[11px] text-slate-400">Tidak ada item untuk dialokasikan.</p>
                              ) : (
                                <div className="space-y-2">
                                  {groupedItems
                                    .filter((item) => {
                                      if (!isAllocatedOnlyView) return true;
                                      const persistedQty = Number(persistedAlloc[item.product_id] || 0);
                                      const draftQty = Number(
                                        allocationDraft[item.product_id] !== undefined
                                          ? allocationDraft[item.product_id]
                                          : persistedQty
                                      );
                                      return draftQty > 0;
                                    })
                                    .map((item) => {
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
                                    const isOutOfStock = Number.isFinite(stockQty) && stockQty <= 0;
                                    return (
                                      <div
                                        key={item.product_id}
                                        className={`rounded-xl p-3 ${shortage > 0
                                          ? isOutOfStock || maxAvailable < orderedQty
                                            ? 'border border-rose-200 bg-rose-50/70'
                                            : 'border border-amber-200 bg-amber-50/70'
                                          : 'border border-slate-100 bg-white'
                                          }`}
                                      >
                                        <div className="flex items-start justify-between gap-3">
                                          <div>
                                            <div className="flex flex-wrap items-center gap-2">
                                              <p className="text-xs font-bold text-slate-900">{product.name || 'Produk'}</p>
                                              {!isAllocatedOnlyView && shortage > 0 && (
                                                <span className={`inline-flex items-center rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wide ${isOutOfStock
                                                  ? 'bg-rose-600 text-white'
                                                  : maxAvailable >= orderedQty
                                                    ? draftQty > 0
                                                      ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                                      : 'bg-blue-100 text-blue-800 border border-blue-200'
                                                    : 'bg-amber-100 text-amber-800 border border-amber-200'
                                                  }`}>
                                                  {isOutOfStock
                                                    ? 'Stok Habis'
                                                    : maxAvailable >= orderedQty
                                                      ? draftQty > 0
                                                        ? 'Dialokasikan Sebagian'
                                                        : 'Belum Dialokasikan'
                                                      : 'Stok Kurang'}
                                                </span>
                                              )}
                                            </div>
                                            <p className="text-[10px] text-slate-500">SKU: {product.sku || item.product_id}</p>
                                            <p className="text-[10px] text-slate-500">
                                              Pesan {orderedQty}
                                              {' • '}
                                              Dialokasikan {draftQty}
                                              {!isAllocatedOnlyView && Number.isFinite(stockQty) && ` • Stok ${stockQty}`}
                                              {!isAllocatedOnlyView && Number.isFinite(stockQty) && ` • Tersedia ${maxAvailable}`}
                                            </p>
                                            {isAllocatedOnlyView ? (
                                              <p className="mt-2 text-[10px] font-bold text-emerald-600">
                                                Item ini ikut alokasi dengan qty <span className="font-black">{draftQty}</span> dari permintaan <span className="font-black">{orderedQty}</span>.
                                              </p>
                                            ) : shortage > 0 ? (
                                              <div
                                                className={`mt-2 rounded-lg bg-white/80 px-3 py-2 ${isOutOfStock || maxAvailable < orderedQty
                                                  ? 'border border-rose-200'
                                                  : 'border border-amber-200'
                                                  }`}
                                              >
                                                <p className={`text-[11px] font-black ${isOutOfStock || maxAvailable < orderedQty ? 'text-rose-700' : 'text-amber-700'}`}>
                                                  Diminta {orderedQty} qty • Dialokasikan {draftQty} qty
                                                </p>
                                                {isOutOfStock ? (
                                                  <p className="mt-1 text-[11px] text-rose-700">
                                                    Stok produk saat ini <span className="font-black">0</span>. Item ini belum bisa dialokasikan sama sekali sampai ada stok masuk atau mutasi stok tersedia.
                                                  </p>
                                                ) : maxAvailable >= orderedQty && draftQty > 0 ? (
                                                  <p className="mt-1 text-[11px] text-amber-700">
                                                    Item ini sudah dijatah sebagian oleh admin. Jika memang invoice parsial, sisa qty bisa tetap dibiarkan atau dilanjutkan di backorder.
                                                  </p>
                                                ) : maxAvailable >= orderedQty ? (
                                                  <p className="mt-1 text-[11px] text-amber-700">
                                                    Stok cukup. Isi qty alokasi sesuai jatah admin agar item ini bisa ikut invoice sesuai jumlah yang dipilih.
                                                  </p>
                                                ) : (
                                                  <p className="mt-1 text-[11px] text-rose-700">
                                                    Stok yang tersedia belum cukup untuk memenuhi seluruh qty pesanan. Admin tetap bisa menjatah sebagian qty yang tersedia atau menunggu penambahan stok.
                                                  </p>
                                                )}
                                              </div>
                                            ) : (
                                              <p className="text-[10px] font-bold text-emerald-600">Alokasi penuh</p>
                                            )}
                                          </div>
                                          <div className="text-right">
                                            <p className="text-[10px] text-slate-400">Alokasi</p>
                                            <div className="flex items-center justify-end gap-1">
                                              <button
                                                type="button"
                                                onClick={() => handleAllocationChange(String(order.id), String(item.product_id), maxAlloc, String(draftQty - 1))}
                                                disabled={!canAllocate || !isAllocationEditable || draftQty <= 0}
                                                className="btn-3d inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 disabled:opacity-50"
                                                aria-label="Kurangi alokasi"
                                              >
                                                <Minus size={14} />
                                              </button>
                                              <input
                                                type="number"
                                                min={0}
                                                max={maxAlloc}
                                                value={draftQty}
                                                disabled={!canAllocate || !isAllocationEditable}
                                                onChange={(e) => handleAllocationChange(String(order.id), String(item.product_id), maxAlloc, e.target.value)}
                                                className="w-20 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-right"
                                              />
                                              <button
                                                type="button"
                                                onClick={() => handleAllocationChange(String(order.id), String(item.product_id), maxAlloc, String(draftQty + 1))}
                                                disabled={!canAllocate || !isAllocationEditable || draftQty >= maxAlloc}
                                                className="btn-3d inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 disabled:opacity-50"
                                                aria-label="Tambah alokasi"
                                              >
                                                <Plus size={14} />
                                              </button>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                  {isAllocatedOnlyView && groupedItems.every((item) => {
                                    const persistedQty = Number(persistedAlloc[item.product_id] || 0);
                                    const draftQty = Number(
                                      allocationDraft[item.product_id] !== undefined
                                        ? allocationDraft[item.product_id]
                                        : persistedQty
                                    );
                                    return draftQty <= 0;
                                  }) && (
                                    <p className="text-[11px] text-slate-400">
                                      Belum ada item yang dialokasikan pada order ini. Kekurangan qty dan backorder ditampilkan di filter <span className="font-bold">Backorder</span>.
                                    </p>
                                  )}
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
              Tidak ada order yang cocok dengan filter saat ini.
            </div>
          )}
        </div>
      </div>
      {deliveryHandoverModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">
                  {deliveryHandoverModal.step === 'check' ? 'Checker - Checking' : 'Checker - Handover'}
                </p>
                <p className="text-sm font-black text-slate-900">{deliveryHandoverModal.invoiceTitle}</p>
                <p className="text-[11px] text-slate-500">{deliveryHandoverModal.invoiceId}</p>
              </div>
              <button
                type="button"
                onClick={() => (deliveryHandoverBusy ? null : setDeliveryHandoverModal(null))}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-[10px] font-bold text-slate-600 disabled:opacity-50"
                disabled={deliveryHandoverBusy}
              >
                Tutup
              </button>
            </div>

            {deliveryHandoverModal.step === 'check' && (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex items-center gap-2 text-[11px] font-bold text-slate-700">
                    <input
                      type="radio"
                      name="delivery-check-result"
                      value="pass"
                      checked={deliveryHandoverModal.result === 'pass'}
                      onChange={() => setDeliveryHandoverModal((prev) => (prev ? { ...prev, result: 'pass' } : prev))}
                    />
                    Lolos (pass)
                  </label>
                  <label className="inline-flex items-center gap-2 text-[11px] font-bold text-slate-700">
                    <input
                      type="radio"
                      name="delivery-check-result"
                      value="fail"
                      checked={deliveryHandoverModal.result === 'fail'}
                      onChange={() => setDeliveryHandoverModal((prev) => (prev ? { ...prev, result: 'fail' } : prev))}
                    />
                    Ada selisih (fail → HOLD)
                  </label>
                </div>
                <textarea
                  value={deliveryHandoverModal.note}
                  onChange={(e) => setDeliveryHandoverModal((prev) => (prev ? { ...prev, note: e.target.value } : prev))}
                  placeholder="Catatan checker (wajib kalau fail)"
                  className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none"
                  rows={3}
                />
                <div>
                  <p className="text-[11px] font-bold text-slate-600 mb-1">Foto evidence (opsional)</p>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      setDeliveryHandoverModal((prev) => (prev ? { ...prev, file: f } : prev));
                    }}
                    className="block w-full text-[11px]"
                  />
                </div>
                <p className="text-[10px] text-slate-500">
                  Catatan: item snapshot akan disimpan otomatis dari invoice. (UI per-item akan ditambahkan bila diperlukan.)
                </p>
              </div>
            )}

            {deliveryHandoverModal.step === 'handover' && (
              <div className="mt-3">
                <p className="text-[11px] text-slate-600">
                  Tindakan ini akan mengubah status invoice/order menjadi <span className="font-black">shipped</span> dan posting goods-out.
                </p>
              </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeliveryHandoverModal(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-wider text-slate-700 disabled:opacity-50"
                disabled={deliveryHandoverBusy}
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void submitDeliveryHandoverModal()}
                className="rounded-xl bg-slate-900 px-4 py-2 text-[11px] font-black uppercase tracking-wider text-white disabled:opacity-50"
                disabled={
                  deliveryHandoverBusy ||
                  (deliveryHandoverModal.step === 'check' && deliveryHandoverModal.result === 'fail' && !String(deliveryHandoverModal.note || '').trim())
                }
              >
                {deliveryHandoverBusy ? 'Memproses...' : (deliveryHandoverModal.step === 'check' ? 'Simpan Checking' : 'Konfirmasi Handover')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
