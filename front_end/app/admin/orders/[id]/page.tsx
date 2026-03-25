'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';

type LooseRecord = Record<string, unknown>;

const normalizeStatus = (raw: unknown) => {
  const status = String(raw || '').trim();
  return status === 'waiting_payment' ? 'ready_to_ship' : status;
};

const asRecord = (value: unknown): LooseRecord =>
  value && typeof value === 'object' ? (value as LooseRecord) : {};

const resolveInvoiceScopedOrderStatus = (orderData: unknown, invoiceData: unknown) => {
  const invoiceRow = asRecord(invoiceData);
  const orderRow = asRecord(orderData);
  const orderInvoiceRow = asRecord(orderRow.Invoice);
  const invoiceShipmentStatus = String(
    invoiceRow.shipment_status ||
    orderInvoiceRow.shipment_status ||
    ''
  ).trim();
  if (invoiceShipmentStatus) {
    return normalizeStatus(invoiceShipmentStatus);
  }
  return normalizeStatus(orderRow.status);
};

const statusLabel = (raw: unknown) => {
  const status = normalizeStatus(raw);
  if (status === 'pending') return 'pending';
  if (status === 'allocated') return 'allocated';
  if (status === 'partially_fulfilled') return 'partially_fulfilled';
  if (status === 'ready_to_ship') return 'ready_to_ship';
  if (status === 'waiting_admin_verification') return 'waiting_admin_verification';
  if (status === 'debt_pending') return 'debt_pending';
  if (status === 'shipped') return 'shipped';
  if (status === 'delivered') return 'delivered';
  if (status === 'completed') return 'completed';
  if (status === 'canceled') return 'canceled';
  if (status === 'hold') return 'hold';
  return status || '-';
};

const statusBadgeClass = (raw: unknown) => {
  const status = normalizeStatus(raw);
  if (['completed', 'delivered'].includes(status)) return 'bg-emerald-100 text-emerald-700';
  if (['shipped', 'waiting_admin_verification'].includes(status)) return 'bg-blue-100 text-blue-700';
  if (status === 'allocated') return 'bg-teal-100 text-teal-700';
  if (status === 'partially_fulfilled') return 'bg-amber-100 text-amber-700';
  if (status === 'canceled') return 'bg-rose-100 text-rose-700';
  if (status === 'debt_pending') return 'bg-amber-100 text-amber-700';
  if (status === 'hold') return 'bg-violet-100 text-violet-700';
  return 'bg-slate-100 text-slate-700';
};

const normalizeProofImageUrl = (raw?: string | null) => {
  if (!raw) return null;
  const val = String(raw).trim();
  if (!val) return null;
  if (val.startsWith('http://') || val.startsWith('https://')) return val;
  if (val.startsWith('/uploads/')) return val;
  if (val.startsWith('uploads/')) return `/${val}`;
  const normalizedSlash = val.replace(/\\/g, '/');
  if (normalizedSlash.startsWith('uploads/')) return `/${normalizedSlash}`;
  const uploadsIndex = normalizedSlash.indexOf('/uploads/');
  if (uploadsIndex >= 0) return normalizedSlash.slice(uploadsIndex);
  return val;
};

const collectOrderIdsFromInvoice = (invoiceData: unknown): string[] => {
  const invoiceRow = asRecord(invoiceData);
  const ids = new Set<string>();
  const rows = Array.isArray(invoiceRow.Orders) ? invoiceRow.Orders : [];
  rows.forEach((row: unknown) => {
    const rowData = asRecord(row);
    const orderRef = asRecord(rowData.Order);
    const id = String(rowData.id || rowData.order_id || orderRef.id || '').trim();
    if (id) ids.add(id);
  });
  const items = Array.isArray(invoiceRow.InvoiceItems) ? invoiceRow.InvoiceItems : [];
  items.forEach((item: unknown) => {
    const itemData = asRecord(item);
    const orderItemRef = asRecord(itemData.OrderItem);
    const orderRef = asRecord(itemData.Order);
    const id = String(orderItemRef.order_id || itemData.order_id || orderRef.id || '').trim();
    if (id) ids.add(id);
  });
  return Array.from(ids);
};

const getInvoiceRefFromOrder = (orderData: unknown): string => {
  const orderRow = asRecord(orderData);
  const invoiceRow = asRecord(orderRow.Invoice);
  const invoiceId = String(orderRow.invoice_id || invoiceRow.id || '').trim();
  if (invoiceId) return invoiceId;
  return '';
};

const getOrderItemSuppliedQty = (orderData: unknown, invoiceData: unknown, itemId: string) => {
  const orderRow = asRecord(orderData);
  const invoiceRow = asRecord(invoiceData);
  const summaries = Array.isArray(orderRow.item_summaries) ? orderRow.item_summaries : [];
  const summaryRow = summaries.find((row: unknown) => String(asRecord(row).order_item_id || '') === itemId);
  if (summaryRow) return Number(asRecord(summaryRow).invoiced_qty_total || 0);

  const invoiceItems = Array.isArray(invoiceRow.InvoiceItems) ? invoiceRow.InvoiceItems : [];
  return invoiceItems.reduce((sum: number, invoiceItem: unknown) => {
    const invoiceItemRow = asRecord(invoiceItem);
    const orderItemRef = asRecord(invoiceItemRow.OrderItem);
    const targetItemId = String(invoiceItemRow.order_item_id || orderItemRef.id || '').trim();
    if (targetItemId !== itemId) return sum;
    return sum + Number(invoiceItemRow.qty || 0);
  }, 0);
};

export default function AdminInvoiceDetailPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'checker_gudang', 'admin_finance', 'kasir']);
  const { user } = useAuthStore();
  const params = useParams();
  const router = useRouter();
  const routeRefId = String(params?.id || '').trim();

  const [invoice, setInvoice] = useState<LooseRecord | null>(null);
  const [orders, setOrders] = useState<LooseRecord[]>([]);
  const [resolvedInvoiceId, setResolvedInvoiceId] = useState('');
  const [resolvedFromOrderId, setResolvedFromOrderId] = useState('');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const [proofLoadError, setProofLoadError] = useState(false);

  const [couriers, setCouriers] = useState<LooseRecord[]>([]);
  const [selectedCourierId, setSelectedCourierId] = useState('');

  const canManageWarehouseFlow = useMemo(
    () => ['admin_gudang', 'super_admin'].includes(user?.role || ''),
    [user?.role]
  );

  const loadCouriers = useCallback(async () => {
    try {
      const res = await api.admin.orderManagement.getCouriers();
      setCouriers(Array.isArray(res.data?.employees) ? res.data.employees : []);
    } catch (e) {
      console.error('Failed to load couriers:', e);
    }
  }, []);

  const loadInvoiceDetail = useCallback(async () => {
    if (!routeRefId) {
      setInvoice(null);
      setOrders([]);
      setResolvedInvoiceId('');
      setResolvedFromOrderId('');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError('');
      setProofLoadError(false);

      let invoiceData: LooseRecord | null = null;
      let invoiceId = '';
      let fallbackOrderData: LooseRecord | null = null;
      let fallbackOrderId = '';

      try {
        const invoiceRes = await api.invoices.getById(routeRefId);
        invoiceData = invoiceRes.data && typeof invoiceRes.data === 'object' ? (invoiceRes.data as LooseRecord) : null;
        invoiceId = String(asRecord(invoiceData).id || routeRefId).trim();
      } catch {
        const orderRes = await api.orders.getOrderById(routeRefId);
        fallbackOrderData = orderRes.data && typeof orderRes.data === 'object' ? (orderRes.data as LooseRecord) : null;
        fallbackOrderId = String(asRecord(fallbackOrderData).id || '').trim();
        invoiceId = getInvoiceRefFromOrder(fallbackOrderData);
        if (!invoiceId) throw new Error('Invoice tidak ditemukan dari order ini.');
        const invoiceRes = await api.invoices.getById(invoiceId);
        invoiceData = invoiceRes.data && typeof invoiceRes.data === 'object' ? (invoiceRes.data as LooseRecord) : null;
      }

      const orderIds = new Set<string>(collectOrderIdsFromInvoice(invoiceData));
      if (fallbackOrderId) orderIds.add(fallbackOrderId);

      const orderDetailsResults = await Promise.allSettled(
        Array.from(orderIds).map((id) => api.orders.getOrderById(id))
      );
      const fetchedOrders: LooseRecord[] = orderDetailsResults
        .map((result) => (result.status === 'fulfilled' ? (result.value.data as LooseRecord) : null))
        .filter((row): row is LooseRecord => Boolean(row && typeof row === 'object'));
      if (fallbackOrderData && !fetchedOrders.some((row) => String(row.id || '') === String(asRecord(fallbackOrderData).id || ''))) {
        fetchedOrders.push(fallbackOrderData);
      }
      fetchedOrders.sort((a, b) => {
        const bTs = Date.parse(String(b.createdAt || ''));
        const aTs = Date.parse(String(a.createdAt || ''));
        const bVal = Number.isFinite(bTs) ? bTs : 0;
        const aVal = Number.isFinite(aTs) ? aTs : 0;
        return bVal - aVal;
      });

      setInvoice(invoiceData);
      setOrders(fetchedOrders);
      setResolvedInvoiceId(String(asRecord(invoiceData).id || invoiceId || '').trim());
      setResolvedFromOrderId(fallbackOrderId);

      const assignedCourierIds = Array.from(
        new Set(
          fetchedOrders
            .map((row) => String(row.courier_id || '').trim())
            .filter(Boolean)
        )
      );
      setSelectedCourierId(assignedCourierIds.length === 1 ? assignedCourierIds[0] : '');
    } catch (e: unknown) {
      setInvoice(null);
      setOrders([]);
      setResolvedInvoiceId('');
      setResolvedFromOrderId('');
      setError(
        typeof e === 'object' && e !== null
          ? String((e as { response?: { data?: { message?: unknown } }; message?: unknown }).response?.data?.message || (e as { message?: unknown }).message || 'Gagal memuat detail invoice')
          : 'Gagal memuat detail invoice'
      );
    } finally {
      setLoading(false);
    }
  }, [routeRefId]);

  const invoiceRow = asRecord(invoice);

  useEffect(() => {
    if (!allowed) return;
    void loadInvoiceDetail();
  }, [allowed, loadInvoiceDetail]);

  useEffect(() => {
    if (!allowed || !canManageWarehouseFlow) return;
    void loadCouriers();
  }, [allowed, canManageWarehouseFlow, loadCouriers]);

  const invoiceItemLines = useMemo(() => {
    const rawItems = Array.isArray(invoiceRow.InvoiceItems)
      ? invoiceRow.InvoiceItems
      : Array.isArray(invoiceRow.Items)
        ? invoiceRow.Items
        : [];

    return rawItems
      .map((item: LooseRecord) => {
        const itemRow = asRecord(item);
        const orderItem = asRecord(itemRow.OrderItem);
        const product = asRecord(orderItem.Product);
        const orderId = String(orderItem.order_id || itemRow.order_id || '').trim();
        const productId = String(orderItem.product_id || itemRow.product_id || '').trim();
        const qty = Number(itemRow.qty || 0);
        return {
          orderId,
          productId,
          qty,
          name: String(product.name || 'Produk'),
          sku: String(product.sku || productId || '-'),
        };
      })
      .filter((line) => line.orderId && line.productId && line.qty > 0);
  }, [invoiceRow]);

  const invoiceQtyByOrderId = useMemo(() => {
    const map = new Map<string, number>();
    invoiceItemLines.forEach((line) => {
      map.set(line.orderId, Number(map.get(line.orderId) || 0) + Number(line.qty || 0));
    });
    return map;
  }, [invoiceItemLines]);

  const invoiceSkuCountByOrderId = useMemo(() => {
    const map = new Map<string, Set<string>>();
    invoiceItemLines.forEach((line) => {
      const set = map.get(line.orderId) || new Set<string>();
      set.add(line.productId);
      map.set(line.orderId, set);
    });
    const result = new Map<string, number>();
    map.forEach((set, orderId) => result.set(orderId, set.size));
    return result;
  }, [invoiceItemLines]);

  const hasActualInvoice = Boolean(invoiceRow.invoice_number);

  const orderRows = useMemo(() => {
    const hasInvoiceSnapshot = invoiceItemLines.length > 0;
    return orders.map((order) => {
      const orderRow = asRecord(order);
      const orderId = String(orderRow.id || '');
      const items = Array.isArray(orderRow.OrderItems) ? orderRow.OrderItems : [];
      const itemSummaries = Array.isArray(orderRow.item_summaries) ? orderRow.item_summaries : [];
      const allocations = Array.isArray(orderRow.Allocations) ? orderRow.Allocations : [];
      const orderedQty = items.reduce((sum: number, item: LooseRecord) => sum + Number(asRecord(item).qty || 0), 0);
      const allocatedQtyRaw = allocations.reduce((sum: number, alloc: LooseRecord) => sum + Number(asRecord(alloc).allocated_qty || 0), 0);
      const allocatedQtyFromInvoice = Number(invoiceQtyByOrderId.get(orderId) || 0);
      const allocatedQtyFromOrder = Math.max(0, Math.min(orderedQty || allocatedQtyRaw, allocatedQtyRaw));
      const suppliedQtyFromSummaries = itemSummaries.reduce(
        (sum: number, row: LooseRecord) => sum + Number(asRecord(row).invoiced_qty_total || 0),
        0
      );
      const backorderQtyFromSummaries = itemSummaries.reduce(
        (sum: number, row: LooseRecord) => sum + Number(asRecord(row).backorder_open_qty || 0),
        0
      );
      const allocatedSkuSet = new Set<string>();
      allocations.forEach((alloc: LooseRecord) => {
        const allocationRow = asRecord(alloc);
        const productId = String(allocationRow.product_id || '').trim();
        const qty = Number(allocationRow.allocated_qty || 0);
        if (productId && qty > 0) allocatedSkuSet.add(productId);
      });
      const allocatedQty = hasInvoiceSnapshot ? allocatedQtyFromInvoice : allocatedQtyFromOrder;
      const suppliedQty = hasInvoiceSnapshot ? allocatedQtyFromInvoice : suppliedQtyFromSummaries;
      const backorderQty = itemSummaries.length > 0
        ? backorderQtyFromSummaries
        : Math.max(0, orderedQty - suppliedQty);
      const allocatedSkuCount = hasInvoiceSnapshot
        ? Number(invoiceSkuCountByOrderId.get(orderId) || 0)
        : allocatedSkuSet.size;
      return {
        id: orderId,
        status: hasActualInvoice
          ? resolveInvoiceScopedOrderStatus(order, invoice)
          : normalizeStatus(orderRow.status),
        createdAt: orderRow.createdAt,
        source: String(orderRow.source || '-'),
        customerName: String(orderRow.customer_name || asRecord(orderRow.Customer).name || '-'),
        totalAmount: Number(orderRow.total_amount || 0),
        orderedQty,
        allocatedQty,
        suppliedQty,
        backorderQty,
        allocatedSkuCount,
        courierName: String(orderRow.courier_display_name || asRecord(orderRow.Courier).name || '-'),
      };
    });
  }, [hasActualInvoice, invoice, orders, invoiceItemLines.length, invoiceQtyByOrderId, invoiceSkuCountByOrderId]);

  const activeDispatchOrderIds = useMemo(() => {
    return orderRows
      .filter((row) => ['ready_to_ship', 'shipped', 'delivered'].includes(row.status) && row.id)
      .map((row) => row.id);
  }, [orderRows]);

  const readyToShipOrderIds = useMemo(() => {
    return orderRows
      .filter((row) => row.status === 'ready_to_ship' && row.id)
      .map((row) => row.id);
  }, [orderRows]);

  const pickingItems = useMemo(() => {
    const activeOrderSet = new Set(activeDispatchOrderIds);
    type PickingRow = {
      productId: string;
      name: string;
      sku: string;
      allocatedQty: number;
      orderRefs: Array<{ orderId: string; qty: number }>;
    };
    if (invoiceItemLines.length > 0) {
      const map = new Map<string, PickingRow>();

      invoiceItemLines.forEach((line) => {
        const orderId = String(line.orderId || '').trim();
        if (!orderId || !activeOrderSet.has(orderId)) return;
        const productId = String(line.productId || '').trim();
        const qty = Number(line.qty || 0);
        if (!productId || qty <= 0) return;

        const row: PickingRow = map.get(productId) || {
          productId,
          name: line.name || 'Produk',
          sku: line.sku || productId,
          allocatedQty: 0,
          orderRefs: [],
        };
        row.allocatedQty += qty;
        const existingOrderRef = row.orderRefs.find((ref) => ref.orderId === orderId);
        if (existingOrderRef) {
          existingOrderRef.qty += qty;
        } else {
          row.orderRefs.push({ orderId, qty });
        }
        map.set(productId, row);
      });

      return Array.from(map.values())
        .map((row) => ({
          ...row,
          orderRefs: [...row.orderRefs].sort((a, b) => b.qty - a.qty),
        }))
        .sort((a, b) => {
          const qtyDiff = b.allocatedQty - a.allocatedQty;
          if (qtyDiff !== 0) return qtyDiff;
          return a.name.localeCompare(b.name);
        });
    }

    const map = new Map<string, PickingRow>();

    orders.forEach((order) => {
      const orderRow = asRecord(order);
      const orderId = String(orderRow.id || '').trim();
      if (!orderId || !activeOrderSet.has(orderId)) return;

      const itemMeta = new Map<string, { name: string; sku: string }>();
      const orderItems = Array.isArray(orderRow.OrderItems) ? orderRow.OrderItems : [];
      orderItems.forEach((item: LooseRecord) => {
        const itemRow = asRecord(item);
        const productId = String(itemRow.product_id || '').trim();
        if (!productId) return;
        const product = asRecord(itemRow.Product);
        if (!itemMeta.has(productId)) {
          itemMeta.set(productId, {
            name: String(product.name || 'Produk'),
            sku: String(product.sku || productId),
          });
        }
      });

      const allocations = Array.isArray(orderRow.Allocations) ? orderRow.Allocations : [];
      allocations.forEach((allocation: LooseRecord) => {
        const allocationRow = asRecord(allocation);
        const productId = String(allocationRow.product_id || '').trim();
        const qty = Number(allocationRow.allocated_qty || 0);
        if (!productId || qty <= 0) return;

        const meta = itemMeta.get(productId) || { name: 'Produk', sku: productId };
        const row: PickingRow = map.get(productId) || {
          productId,
          name: meta.name,
          sku: meta.sku,
          allocatedQty: 0,
          orderRefs: [],
        };
        row.allocatedQty += qty;
        const existingOrderRef = row.orderRefs.find((ref) => ref.orderId === orderId);
        if (existingOrderRef) {
          existingOrderRef.qty += qty;
        } else {
          row.orderRefs.push({ orderId, qty });
        }
        map.set(productId, row);
      });
    });

    return Array.from(map.values())
      .map((row) => ({
        ...row,
        orderRefs: [...row.orderRefs].sort((a, b) => b.qty - a.qty),
      }))
      .sort((a, b) => {
        const qtyDiff = b.allocatedQty - a.allocatedQty;
        if (qtyDiff !== 0) return qtyDiff;
        return a.name.localeCompare(b.name);
      });
  }, [orders, activeDispatchOrderIds, invoiceItemLines]);

  const allocatedSummary = useMemo(() => {
    return orderRows.reduce(
      (acc, row) => {
        acc.ordered += Number(row.orderedQty || 0);
        acc.qty += Number(row.allocatedQty || 0);
        acc.supplied += Number(row.suppliedQty || 0);
        acc.backorder += Number(row.backorderQty || 0);
        acc.sku += Number(row.allocatedSkuCount || 0);
        acc.total += Number(row.totalAmount || 0);
        return acc;
      },
      { ordered: 0, qty: 0, supplied: 0, backorder: 0, sku: 0, total: 0 }
    );
  }, [orderRows]);

  const invoiceNumber = String(invoiceRow.invoice_number || '-');
  const paymentMethod = String(invoiceRow.payment_method || '-');
  const paymentStatus = String(invoiceRow.payment_status || '-');
  const amountPaid = Number(invoiceRow.amount_paid || 0);
  const invoiceCreatedAt = (typeof invoiceRow.createdAt === 'string' || invoiceRow.createdAt instanceof Date)
    ? invoiceRow.createdAt
    : null;

  const deliveryReturnSummary = asRecord(invoiceRow.delivery_return_summary);
  const deliveryNetTotal = Number(deliveryReturnSummary.net_total);
  const deliveryReturnTotal = Number(deliveryReturnSummary.return_total || 0);
  const hasDeliveryReturnSummary = Object.keys(deliveryReturnSummary).length > 0 && Number.isFinite(deliveryNetTotal) && deliveryNetTotal >= 0;
  const deliveryRetursRaw = Array.isArray(invoiceRow.delivery_returs) ? invoiceRow.delivery_returs : [];

  // If we have an actual invoice, prioritize its total field.
  // Fallback to allocatedSummary.total only if it's purely an order view without an invoice yet.
  const invoiceTotal = hasActualInvoice
    ? Number(invoiceRow.total || 0)
    : Number(allocatedSummary.total || 0);
  const invoicePayableTotal = hasActualInvoice && hasDeliveryReturnSummary ? deliveryNetTotal : invoiceTotal;

  const customerName = String(
    asRecord(invoiceRow.customer).name ||
    asRecord(invoiceRow.Customer).name ||
    orderRows[0]?.customerName ||
    '-'
  );
  const customerId = String(
    asRecord(invoiceRow.customer).id ||
    asRecord(invoiceRow.Customer).id ||
    asRecord(orders[0]).customer_id ||
    ''
  ).trim();
  const customerWorkspaceKey = customerId || (customerName && customerName !== '-' ? `guest:${customerName}` : '');
  const customerWorkspaceHref = customerWorkspaceKey
    ? `/admin/orders/customer/${encodeURIComponent(customerWorkspaceKey)}?customerName=${encodeURIComponent(customerName)}`
    : '';
  const proofImageUrl = normalizeProofImageUrl(
    typeof invoiceRow.payment_proof_url === 'string' ? invoiceRow.payment_proof_url : null
  );

  const handleAssignDriver = async () => {
    if (!selectedCourierId) {
      setError('Pilih driver terlebih dahulu.');
      return;
    }
    const targetIds = orderRows
      .filter((row) => row.status === 'ready_to_ship' && row.id)
      .map((row) => row.id);
    if (targetIds.length === 0) {
      setError('Tidak ada order ready_to_ship pada invoice ini.');
      return;
    }
    const proceed = confirm(
      `Assign driver untuk ${targetIds.length} order di invoice ${invoiceNumber}? Semua order ready_to_ship akan dikirim dengan driver yang sama.`
    );
    if (!proceed) return;

    try {
      setUpdating(true);
      setError('');
      const results = await Promise.allSettled(
        targetIds.map((id) => api.admin.orderManagement.updateStatus(id, { status: 'shipped', courier_id: selectedCourierId }))
      );
      const failedIds = results
        .map((result, idx) => (result.status === 'rejected' ? String(targetIds[idx]) : ''))
        .filter(Boolean);
      if (failedIds.length > 0) {
        setError(`Sebagian order gagal assign driver (${failedIds.length}/${targetIds.length}): ${failedIds.join(', ')}`);
      }
      await loadInvoiceDetail();
    } catch (e: unknown) {
      setError(
        typeof e === 'object' && e !== null
          ? String((e as { response?: { data?: { message?: unknown } } }).response?.data?.message || 'Gagal assign driver invoice')
          : 'Gagal assign driver invoice'
      );
    } finally {
      setUpdating(false);
    }
  };

  if (!allowed) return null;

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-sm text-slate-500">Memuat detail invoice...</p>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-rose-600">{error || 'Invoice tidak ditemukan.'}</p>
        <Link href="/admin/orders" className="text-sm font-bold text-emerald-700">
          Kembali ke daftar order
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <button data-no-3d="true" onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
        <ArrowLeft size={16} /> Kembali
      </button>

      <div className="bg-white border border-slate-200 rounded-[28px] p-6 shadow-sm space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Detail Invoice Gudang</p>
            <p className="text-lg font-black text-slate-900">{invoiceNumber}</p>
            <p className="text-xs text-slate-500">Invoice ID: {resolvedInvoiceId || '-'}</p>
            {resolvedFromOrderId && (
              <p className="text-[11px] text-amber-700">Dibuka dari order #{resolvedFromOrderId.slice(-8).toUpperCase()}, otomatis dialihkan ke invoice ini.</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">{hasDeliveryReturnSummary ? 'Total Tagihan (Setelah Retur)' : 'Total Invoice'}</p>
            <p className="text-lg font-black text-slate-900">{formatCurrency(invoicePayableTotal)}</p>
            {hasDeliveryReturnSummary && deliveryReturnTotal > 0 && (
              <p className="text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-lg inline-block mt-1">
                Potongan retur: -{formatCurrency(deliveryReturnTotal)} · Gross: {formatCurrency(invoiceTotal)}
              </p>
            )}
            {hasActualInvoice && Math.abs(invoiceTotal - allocatedSummary.total) > 1 && (
              <p className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-lg inline-block mt-1">
                Original Order(s): {formatCurrency(allocatedSummary.total)}
              </p>
            )}
          </div>
        </div>

        {orders.some((o) => asRecord(o).active_issue) && (
          <div className="space-y-3">
            {orders.filter((o) => asRecord(o).active_issue).map((order) => {
              const orderRow = asRecord(order);
              const activeIssue = asRecord(orderRow.active_issue);
              const issueStatus = typeof orderRow.status === 'string' ? orderRow.status : String(orderRow.status || '');
              const issueNote = typeof activeIssue.note === 'string' ? activeIssue.note : String(activeIssue.note || '');
              const evidenceUrl = typeof activeIssue.evidence_url === 'string' ? activeIssue.evidence_url : null;
              const updatedAt = (typeof orderRow.updatedAt === 'string' || orderRow.updatedAt instanceof Date) ? orderRow.updatedAt : null;
              const dueAt = (typeof activeIssue.due_at === 'string' || activeIssue.due_at instanceof Date) ? activeIssue.due_at : null;
              return (
              <div key={`issue-${String(orderRow.id || '')}`} className="bg-amber-50 border-2 border-amber-200 rounded-[24px] p-5 shadow-sm space-y-3">
                <div className="flex items-center gap-3 text-amber-700">
                  <div className="bg-amber-200 p-2 rounded-xl">
                    <AlertCircle size={20} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest leading-none">Laporan Masalah Driver</p>
                    <p className="text-sm font-black text-slate-900 mt-1">Order #{String(orderRow.id).slice(-8).toUpperCase()}</p>
                  </div>
                  <div className="ml-auto px-3 py-1 bg-amber-600 text-white rounded-lg text-[10px] font-black uppercase">
                    Status: {issueStatus}
                  </div>
                </div>
                <div className="bg-white/60 rounded-2xl p-4 border border-amber-100">
                  <p className="text-xs text-slate-500 font-bold uppercase tracking-wide mb-1">Catatan Driver:</p>
                  <p className="text-sm font-semibold text-slate-800 italic whitespace-pre-wrap">
                    {issueNote}
                  </p>
                </div>
                {evidenceUrl && (
                  <div className="space-y-1">
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide">Lampiran Bukti:</p>
                    <Image
                      src={normalizeProofImageUrl(evidenceUrl) || ''}
                      alt="Bukti Masalah"
                      width={640}
                      height={360}
                      className="max-h-60 rounded-xl border border-amber-200 shadow-sm"
                    />
                  </div>
                )}
                <p className="text-[10px] text-amber-600 font-medium italic">
                  Dilaporkan pada: {updatedAt ? formatDateTime(updatedAt) : '-'} • Batas waktu tindak lanjut: {dueAt ? formatDateTime(dueAt) : '-'}
                </p>
              </div>
            );})}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
            <p className="text-xs text-slate-600">Customer: <span className="font-bold text-slate-900">{customerName}</span></p>
            <p className="text-xs text-slate-600">Order dalam invoice: <span className="font-bold text-slate-900">{orderRows.length}</span></p>
            <p className="text-xs text-slate-600">Qty diminta: <span className="font-bold text-slate-900">{allocatedSummary.ordered}</span></p>
            <p className="text-xs text-slate-600">Sudah tersuplai: <span className="font-bold text-emerald-700">{allocatedSummary.supplied}</span></p>
            <p className="text-xs text-slate-600">Backorder aktif: <span className="font-bold text-amber-700">{allocatedSummary.backorder}</span></p>
            <p className="text-xs text-slate-600">Ready to ship: <span className="font-bold text-slate-900">{readyToShipOrderIds.length}</span></p>
            {allocatedSummary.backorder > 0 && customerWorkspaceHref && (
              <Link
                href={`${customerWorkspaceHref}&section=backorder`}
                className="inline-flex items-center rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700 hover:bg-amber-100"
              >
                Edit Backorder Customer
              </Link>
            )}
          </div>

          <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
            <p className="text-xs text-slate-600">Payment Method: <span className="font-bold text-slate-900">{paymentMethod}</span></p>
            <p className="text-xs text-slate-600">Payment Status: <span className="font-bold text-slate-900">{paymentStatus}</span></p>
            <p className="text-xs text-slate-600">Amount Paid: <span className="font-bold text-slate-900">{formatCurrency(amountPaid)}</span></p>
            <p className="text-xs text-slate-600">Dibuat: <span className="font-bold text-slate-900">{invoiceCreatedAt ? formatDateTime(invoiceCreatedAt) : '-'}</span></p>
            {proofImageUrl && !proofLoadError && (
              <div className="pt-1">
                <Image
                  src={proofImageUrl}
                  alt="Bukti pembayaran"
                  width={960}
                  height={540}
                  className="w-full max-h-48 object-contain rounded-lg bg-white border border-slate-200"
                  onError={() => setProofLoadError(true)}
                />
              </div>
            )}
          </div>
        </div>

        {hasDeliveryReturnSummary && deliveryRetursRaw.length > 0 && (
          <div className="rounded-[24px] border border-rose-200 bg-rose-50/60 p-5 space-y-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-700">Retur Saat Pengiriman</p>
              <p className="text-xs font-bold text-slate-700 mt-1">
                Ada retur item pada invoice ini (nilai tagihan sudah menyesuaikan).
              </p>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(deliveryRetursRaw as unknown[]).map((raw) => {
                const r = asRecord(raw);
                const product = asRecord(r.Product);
                const returType = String(r.retur_type || '');
                const returTypeLabel = returType === 'delivery_damage' ? 'Barang rusak' : 'Tidak jadi beli';
                return (
                  <div key={String(r.id || Math.random())} className="rounded-2xl border border-rose-200/60 bg-white px-4 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-black text-slate-900 truncate">{String(product.name || 'Produk')}</p>
                      <p className="text-[10px] text-slate-500 truncate">
                        {returTypeLabel} · Status {String(r.status || '-')} · {String(r.reason || '').trim() ? String(r.reason) : '-'}
                      </p>
                    </div>
                    <span className="text-xs font-black text-rose-700">Qty {Number(r.qty || 0)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm font-black text-slate-900">List Pesanan dalam Invoice</p>
          {orderRows.length === 0 ? (
            <div className="bg-slate-50 rounded-2xl p-4 text-sm text-slate-500">
              Tidak ada order yang terhubung ke invoice ini.
            </div>
          ) : (
            <div className="space-y-2">
              {orderRows.map((row) => (
                <div key={row.id} className="bg-slate-50 border border-slate-200 rounded-2xl p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex-1">
                    <p className="text-sm font-black text-slate-900">#{row.id}</p>
                    <p className="text-[11px] text-slate-500">
                      {(() => {
                        const createdAt = row.createdAt as unknown;
                        return (typeof createdAt === 'string' || createdAt instanceof Date)
                          ? formatDateTime(createdAt)
                          : '-';
                      })()} • Source {row.source}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-bold">
                      <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-700">Diminta {row.orderedQty}</span>
                      <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700">Tersuplai {row.suppliedQty}</span>
                      <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700">Backorder {row.backorderQty}</span>
                      <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">Qty dialokasikan {row.allocatedQty}</span>
                      <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700">SKU dialokasikan {row.allocatedSkuCount}</span>
                    </div>
                    {(() => {
                      const targetOrder = orders.find((order) => String(asRecord(order).id || '') === row.id);
                      const orderItems = Array.isArray(asRecord(targetOrder).OrderItems)
                        ? (asRecord(targetOrder).OrderItems as LooseRecord[])
                        : [];
                      if (orderItems.length === 0) return null;
                      return (
                        <div className="mt-3 space-y-2">
                          {orderItems.map((item: LooseRecord) => {
                          const itemRow = asRecord(item);
                          const itemId = String(itemRow.id || '');
                          const product = asRecord(itemRow.Product);
                          const productName = String(product.name || 'Produk');
                          const sku = String(product.sku || '-');
                          const orderedQty = Number(itemRow.qty || 0);
                          const suppliedQty = getOrderItemSuppliedQty(
                            targetOrder,
                            invoice,
                            itemId
                          );
                          const targetOrderRow = asRecord(targetOrder);
                          const summaryRow = Array.isArray(targetOrderRow.item_summaries)
                            ? (targetOrderRow.item_summaries as LooseRecord[]).find((summary: LooseRecord) => String(asRecord(summary).order_item_id || '') === itemId)
                            : null;
                          const backorderQty = summaryRow
                            ? Number(asRecord(summaryRow).backorder_open_qty || 0)
                            : Math.max(0, orderedQty - suppliedQty);
                          return (
                            <div key={itemId} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-xs font-bold text-slate-900">{productName}</p>
                                  <p className="text-[10px] text-slate-500">SKU {sku}</p>
                                </div>
                                <div className="text-right text-[10px] font-bold">
                                  <p className="text-slate-700">Diminta {orderedQty}</p>
                                  <p className="text-emerald-700">Tersuplai {suppliedQty}</p>
                                  <p className="text-amber-700">Backorder {backorderQty}</p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        </div>
                      );
                    })()}
                  </div>
                  <div className="text-left sm:text-right">
                    <p className={`inline-flex px-2 py-1 rounded-full text-[10px] font-bold ${statusBadgeClass(row.status)}`}>
                      {statusLabel(row.status)}
                    </p>
                    <p className="text-sm font-black text-slate-900 mt-1">{formatCurrency(row.totalAmount)}</p>
                    <p className="text-[11px] text-slate-500">Driver: {row.courierName}</p>
                    {row.backorderQty > 0 && customerWorkspaceHref && (
                      <Link
                        href={`${customerWorkspaceHref}&section=backorder&orderId=${encodeURIComponent(row.id)}`}
                        className="mt-2 inline-flex items-center rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-amber-700 hover:bg-amber-100"
                      >
                        Edit Backorder
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-black text-slate-900">
            {orderRows.some(r => ['shipped', 'delivered'].includes(r.status)) ? 'Rincian Barang Dikirim' : 'Rincian Barang Siap Disiapkan Gudang'}
          </p>
          <p className="text-xs text-slate-500">
            Daftar ini menghitung barang dari order berstatus <span className="font-bold">ready_to_ship, shipped, atau delivered</span>.
          </p>
          {pickingItems.length === 0 ? (
            <div className="bg-slate-50 rounded-2xl p-4 text-sm text-slate-500">
              Belum ada barang siap kirim untuk disiapkan.
            </div>
          ) : (
            <div className="space-y-2">
              {pickingItems.map((item) => (
                <div key={item.productId} className="bg-slate-50 border border-slate-200 rounded-2xl p-3 flex flex-col gap-2">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-slate-900">{item.name}</p>
                      <p className="text-[11px] text-slate-500">SKU: {item.sku}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-slate-500">Qty siap kirim</p>
                      <p className="text-base font-black text-emerald-700">{item.allocatedQty}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold">
                    {item.orderRefs.map((ref) => (
                      <span key={`${item.productId}-${ref.orderId}`} className="px-2 py-1 rounded-full bg-white border border-slate-200 text-slate-700">
                        #{ref.orderId.slice(-8).toUpperCase()} • Qty {ref.qty}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {canManageWarehouseFlow && (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
            <p className="text-sm font-black text-slate-900">Aksi Gudang / Logistik</p>
            {readyToShipOrderIds.length > 0 ? (
              <>
                <p className="text-xs text-slate-600">
                  Pilih driver untuk kirim <span className="font-bold">{readyToShipOrderIds.length} order ready_to_ship</span> dalam invoice ini sekaligus.
                </p>
                <select
                  value={selectedCourierId}
                  onChange={(e) => setSelectedCourierId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-amber-400 outline-none"
                  disabled={updating}
                >
                  <option value="">Pilih driver/kurir</option>
                  {couriers.map((item) => (
                    <option key={String(asRecord(item).id || '')} value={String(asRecord(item).id || '')}>
                      {String(asRecord(item).display_name || asRecord(item).name || 'Driver')}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => void handleAssignDriver()}
                  disabled={updating || !selectedCourierId}
                  className="w-full px-4 py-2.5 rounded-xl bg-amber-600 text-white text-sm font-bold disabled:opacity-50 hover:bg-amber-700 transition-colors shadow-sm shadow-amber-200"
                >
                  {updating ? 'Memproses...' : `Kirim ${readyToShipOrderIds.length} Order (1 Invoice)`}
                </button>
              </>
            ) : orderRows.some(r => ['shipped', 'delivered'].includes(r.status)) ? (
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest leading-none mb-1">Driver Ditugaskan</p>
                  <p className="text-sm font-black text-slate-900">
                    {orderRows.find(r => r.courierName && r.courierName !== '-')?.courierName || 'Driver sedang bertugas'}
                  </p>
                </div>
                <div className="px-3 py-1 bg-emerald-600 text-white rounded-lg text-[10px] font-black uppercase">
                  {orderRows.find(r => r.status === 'shipped') ? 'Sedang Dikirim' : 'Sudah Terkirim'}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Belum ada order berstatus <span className="font-bold">ready_to_ship</span> pada invoice ini.
              </p>
            )}
          </div>
        )}

        <button
          onClick={() => void loadInvoiceDetail()}
          disabled={loading || updating}
          className="w-full px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold inline-flex items-center justify-center gap-2"
        >
          <RefreshCw size={14} />
          Refresh
        </button>

        {error && <p className="text-xs text-rose-600">{error}</p>}
      </div>
    </div>
  );
}
