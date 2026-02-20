'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';

const normalizeStatus = (raw: unknown) => {
  const status = String(raw || '').trim();
  return status === 'waiting_payment' ? 'ready_to_ship' : status;
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

const collectOrderIdsFromInvoice = (invoiceData: any): string[] => {
  const ids = new Set<string>();
  const rows = Array.isArray(invoiceData?.Orders) ? invoiceData.Orders : [];
  rows.forEach((row: any) => {
    const id = String(row?.id || row?.order_id || row?.Order?.id || '').trim();
    if (id) ids.add(id);
  });
  const items = Array.isArray(invoiceData?.InvoiceItems) ? invoiceData.InvoiceItems : [];
  items.forEach((item: any) => {
    const id = String(item?.OrderItem?.order_id || item?.order_id || item?.Order?.id || '').trim();
    if (id) ids.add(id);
  });
  return Array.from(ids);
};

const getInvoiceRefFromOrder = (orderData: any): string => {
  const invoiceId = String(orderData?.invoice_id || orderData?.Invoice?.id || '').trim();
  if (invoiceId) return invoiceId;
  return '';
};

export default function AdminInvoiceDetailPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'admin_finance', 'kasir']);
  const { user } = useAuthStore();
  const params = useParams();
  const router = useRouter();
  const routeRefId = String(params?.id || '').trim();

  const [invoice, setInvoice] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [resolvedInvoiceId, setResolvedInvoiceId] = useState('');
  const [resolvedFromOrderId, setResolvedFromOrderId] = useState('');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const [proofLoadError, setProofLoadError] = useState(false);

  const [couriers, setCouriers] = useState<any[]>([]);
  const [selectedCourierId, setSelectedCourierId] = useState('');

  const canManageWarehouseFlow = useMemo(
    () => ['admin_gudang', 'super_admin'].includes(user?.role || ''),
    [user?.role]
  );

  const loadCouriers = useCallback(async () => {
    try {
      const res = await api.admin.orderManagement.getCouriers();
      setCouriers(res.data?.employees || []);
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

      let invoiceData: any = null;
      let invoiceId = '';
      let fallbackOrderData: any = null;
      let fallbackOrderId = '';

      try {
        const invoiceRes = await api.invoices.getById(routeRefId);
        invoiceData = invoiceRes.data || null;
        invoiceId = String(invoiceData?.id || routeRefId).trim();
      } catch {
        const orderRes = await api.orders.getOrderById(routeRefId);
        fallbackOrderData = orderRes.data || null;
        fallbackOrderId = String(fallbackOrderData?.id || '').trim();
        invoiceId = getInvoiceRefFromOrder(fallbackOrderData);
        if (!invoiceId) throw new Error('Invoice tidak ditemukan dari order ini.');
        const invoiceRes = await api.invoices.getById(invoiceId);
        invoiceData = invoiceRes.data || null;
      }

      const orderIds = new Set<string>(collectOrderIdsFromInvoice(invoiceData));
      if (fallbackOrderId) orderIds.add(fallbackOrderId);

      const orderDetailsResults = await Promise.allSettled(
        Array.from(orderIds).map((id) => api.orders.getOrderById(id))
      );
      const fetchedOrders = orderDetailsResults
        .map((result) => (result.status === 'fulfilled' ? result.value.data : null))
        .filter(Boolean);
      if (fallbackOrderData && !fetchedOrders.some((row: any) => String(row?.id || '') === String(fallbackOrderData?.id || ''))) {
        fetchedOrders.push(fallbackOrderData);
      }
      fetchedOrders.sort((a: any, b: any) => {
        const bTs = Date.parse(String(b?.createdAt || ''));
        const aTs = Date.parse(String(a?.createdAt || ''));
        const bVal = Number.isFinite(bTs) ? bTs : 0;
        const aVal = Number.isFinite(aTs) ? aTs : 0;
        return bVal - aVal;
      });

      setInvoice(invoiceData);
      setOrders(fetchedOrders);
      setResolvedInvoiceId(String(invoiceData?.id || invoiceId || '').trim());
      setResolvedFromOrderId(fallbackOrderId);

      const assignedCourierIds = Array.from(
        new Set(
          fetchedOrders
            .map((row: any) => String(row?.courier_id || '').trim())
            .filter(Boolean)
        )
      );
      setSelectedCourierId(assignedCourierIds.length === 1 ? assignedCourierIds[0] : '');
    } catch (e: any) {
      setInvoice(null);
      setOrders([]);
      setResolvedInvoiceId('');
      setResolvedFromOrderId('');
      setError(e?.response?.data?.message || e?.message || 'Gagal memuat detail invoice');
    } finally {
      setLoading(false);
    }
  }, [routeRefId]);

  useEffect(() => {
    if (!allowed) return;
    void loadInvoiceDetail();
  }, [allowed, loadInvoiceDetail]);

  useEffect(() => {
    if (!allowed || !canManageWarehouseFlow) return;
    void loadCouriers();
  }, [allowed, canManageWarehouseFlow, loadCouriers]);

  const invoiceItemLines = useMemo(() => {
    const rawItems = Array.isArray(invoice?.InvoiceItems)
      ? invoice.InvoiceItems
      : Array.isArray(invoice?.Items)
        ? invoice.Items
        : [];

    return rawItems
      .map((item: any) => {
        const orderItem = item?.OrderItem || {};
        const product = orderItem?.Product || {};
        const orderId = String(orderItem?.order_id || item?.order_id || '').trim();
        const productId = String(orderItem?.product_id || item?.product_id || '').trim();
        const qty = Number(item?.qty || 0);
        return {
          orderId,
          productId,
          qty,
          name: String(product?.name || 'Produk'),
          sku: String(product?.sku || productId || '-'),
        };
      })
      .filter((line: any) => line.orderId && line.productId && line.qty > 0);
  }, [invoice]);

  const invoiceQtyByOrderId = useMemo(() => {
    const map = new Map<string, number>();
    invoiceItemLines.forEach((line: any) => {
      map.set(line.orderId, Number(map.get(line.orderId) || 0) + Number(line.qty || 0));
    });
    return map;
  }, [invoiceItemLines]);

  const invoiceSkuCountByOrderId = useMemo(() => {
    const map = new Map<string, Set<string>>();
    invoiceItemLines.forEach((line: any) => {
      const set = map.get(line.orderId) || new Set<string>();
      set.add(line.productId);
      map.set(line.orderId, set);
    });
    const result = new Map<string, number>();
    map.forEach((set, orderId) => result.set(orderId, set.size));
    return result;
  }, [invoiceItemLines]);

  const orderRows = useMemo(() => {
    const hasInvoiceSnapshot = invoiceItemLines.length > 0;
    return orders.map((order: any) => {
      const orderId = String(order?.id || '');
      const items = Array.isArray(order?.OrderItems) ? order.OrderItems : [];
      const allocations = Array.isArray(order?.Allocations) ? order.Allocations : [];
      const orderedQty = items.reduce((sum: number, item: any) => sum + Number(item?.qty || 0), 0);
      const allocatedQtyRaw = allocations.reduce((sum: number, alloc: any) => sum + Number(alloc?.allocated_qty || 0), 0);
      const allocatedQtyFromInvoice = Number(invoiceQtyByOrderId.get(orderId) || 0);
      const allocatedQtyFromOrder = Math.max(0, Math.min(orderedQty || allocatedQtyRaw, allocatedQtyRaw));
      const allocatedSkuSet = new Set<string>();
      allocations.forEach((alloc: any) => {
        const productId = String(alloc?.product_id || '').trim();
        const qty = Number(alloc?.allocated_qty || 0);
        if (productId && qty > 0) allocatedSkuSet.add(productId);
      });
      const allocatedQty = hasInvoiceSnapshot ? allocatedQtyFromInvoice : allocatedQtyFromOrder;
      const allocatedSkuCount = hasInvoiceSnapshot
        ? Number(invoiceSkuCountByOrderId.get(orderId) || 0)
        : allocatedSkuSet.size;
      return {
        id: orderId,
        status: normalizeStatus(order?.status),
        createdAt: order?.createdAt,
        source: String(order?.source || '-'),
        customerName: String(order?.customer_name || order?.Customer?.name || '-'),
        totalAmount: Number(order?.total_amount || 0),
        allocatedQty,
        allocatedSkuCount,
        courierName: String(order?.courier_display_name || order?.Courier?.name || '-'),
      };
    });
  }, [orders, invoiceItemLines.length, invoiceQtyByOrderId, invoiceSkuCountByOrderId]);

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

      invoiceItemLines.forEach((line: any) => {
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

    orders.forEach((order: any) => {
      const orderId = String(order?.id || '').trim();
      if (!orderId || !activeOrderSet.has(orderId)) return;

      const itemMeta = new Map<string, { name: string; sku: string }>();
      const orderItems = Array.isArray(order?.OrderItems) ? order.OrderItems : [];
      orderItems.forEach((item: any) => {
        const productId = String(item?.product_id || '').trim();
        if (!productId) return;
        const product = item?.Product || {};
        if (!itemMeta.has(productId)) {
          itemMeta.set(productId, {
            name: String(product?.name || 'Produk'),
            sku: String(product?.sku || productId),
          });
        }
      });

      const allocations = Array.isArray(order?.Allocations) ? order.Allocations : [];
      allocations.forEach((allocation: any) => {
        const productId = String(allocation?.product_id || '').trim();
        const qty = Number(allocation?.allocated_qty || 0);
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
        acc.qty += Number(row.allocatedQty || 0);
        acc.sku += Number(row.allocatedSkuCount || 0);
        acc.total += Number(row.totalAmount || 0);
        return acc;
      },
      { qty: 0, sku: 0, total: 0 }
    );
  }, [orderRows]);

  const invoiceNumber = String(invoice?.invoice_number || '-');
  const paymentMethod = String(invoice?.payment_method || '-');
  const paymentStatus = String(invoice?.payment_status || '-');
  const amountPaid = Number(invoice?.amount_paid || 0);
  const invoiceTotal = Number(invoice?.total || allocatedSummary.total || 0);
  const customerName = String(
    invoice?.customer?.name ||
    invoice?.Customer?.name ||
    orderRows[0]?.customerName ||
    '-'
  );
  const proofImageUrl = normalizeProofImageUrl(invoice?.payment_proof_url);

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
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Gagal assign driver invoice');
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
      <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
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
            <p className="text-xs text-slate-500">Total Invoice</p>
            <p className="text-lg font-black text-slate-900">{formatCurrency(invoiceTotal)}</p>
          </div>
        </div>

        {orders.some((o: any) => o.active_issue) && (
          <div className="space-y-3">
            {orders.filter((o: any) => o.active_issue).map((order: any) => (
              <div key={`issue-${order.id}`} className="bg-amber-50 border-2 border-amber-200 rounded-[24px] p-5 shadow-sm space-y-3">
                <div className="flex items-center gap-3 text-amber-700">
                  <div className="bg-amber-200 p-2 rounded-xl">
                    <AlertCircle size={20} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest leading-none">Laporan Masalah Driver</p>
                    <p className="text-sm font-black text-slate-900 mt-1">Order #{String(order.id).slice(-8).toUpperCase()}</p>
                  </div>
                  <div className="ml-auto px-3 py-1 bg-amber-600 text-white rounded-lg text-[10px] font-black uppercase">
                    Status: {order.status}
                  </div>
                </div>
                <div className="bg-white/60 rounded-2xl p-4 border border-amber-100">
                  <p className="text-xs text-slate-500 font-bold uppercase tracking-wide mb-1">Catatan Driver:</p>
                  <p className="text-sm font-semibold text-slate-800 italic whitespace-pre-wrap">
                    "{order.active_issue.note}"
                  </p>
                </div>
                {order.active_issue.evidence_url && (
                  <div className="space-y-1">
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide">Lampiran Bukti:</p>
                    <img
                      src={normalizeProofImageUrl(order.active_issue.evidence_url) || ''}
                      alt="Bukti Masalah"
                      className="max-h-60 rounded-xl border border-amber-200 shadow-sm"
                    />
                  </div>
                )}
                <p className="text-[10px] text-amber-600 font-medium italic">
                  Dilaporkan pada: {formatDateTime(order.updatedAt)} • Batas waktu tindak lanjut: {formatDateTime(order.active_issue.due_at)}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
            <p className="text-xs text-slate-600">Customer: <span className="font-bold text-slate-900">{customerName}</span></p>
            <p className="text-xs text-slate-600">Order dalam invoice: <span className="font-bold text-slate-900">{orderRows.length}</span></p>
            <p className="text-xs text-slate-600">Qty dialokasikan: <span className="font-bold text-slate-900">{allocatedSummary.qty}</span></p>
            <p className="text-xs text-slate-600">SKU dialokasikan: <span className="font-bold text-slate-900">{allocatedSummary.sku}</span></p>
            <p className="text-xs text-slate-600">Ready to ship: <span className="font-bold text-slate-900">{readyToShipOrderIds.length}</span></p>
          </div>

          <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
            <p className="text-xs text-slate-600">Payment Method: <span className="font-bold text-slate-900">{paymentMethod}</span></p>
            <p className="text-xs text-slate-600">Payment Status: <span className="font-bold text-slate-900">{paymentStatus}</span></p>
            <p className="text-xs text-slate-600">Amount Paid: <span className="font-bold text-slate-900">{formatCurrency(amountPaid)}</span></p>
            <p className="text-xs text-slate-600">Dibuat: <span className="font-bold text-slate-900">{invoice?.createdAt ? formatDateTime(invoice.createdAt) : '-'}</span></p>
            {proofImageUrl && !proofLoadError && (
              <div className="pt-1">
                <img
                  src={proofImageUrl}
                  alt="Bukti pembayaran"
                  className="w-full max-h-48 object-contain rounded-lg bg-white border border-slate-200"
                  onError={() => setProofLoadError(true)}
                />
              </div>
            )}
          </div>
        </div>

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
                  <div>
                    <p className="text-sm font-black text-slate-900">#{row.id}</p>
                    <p className="text-[11px] text-slate-500">
                      {row.createdAt ? formatDateTime(row.createdAt) : '-'} • Source {row.source}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-bold">
                      <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">Qty dialokasikan {row.allocatedQty}</span>
                      <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700">SKU dialokasikan {row.allocatedSkuCount}</span>
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className={`inline-flex px-2 py-1 rounded-full text-[10px] font-bold ${statusBadgeClass(row.status)}`}>
                      {statusLabel(row.status)}
                    </p>
                    <p className="text-sm font-black text-slate-900 mt-1">{formatCurrency(row.totalAmount)}</p>
                    <p className="text-[11px] text-slate-500">Driver: {row.courierName}</p>
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
                    <option key={item.id} value={item.id}>
                      {item.display_name || item.name || 'Driver'}
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
