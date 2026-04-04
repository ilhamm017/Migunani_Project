'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { ArrowLeft, ChevronRight, MapPin, Package, Phone, User, Wallet, X, Minus, Plus } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { notifyConfirm, notifyFromAlertMessage, notifyOpen, notifySuccess } from '@/lib/notify';
import type { DriverAssignedOrderRow, InvoiceDetailResponse } from '@/lib/apiTypes';
import { collectInvoiceRefs } from '@/lib/invoiceRefs';

const normalizeId = (raw: unknown) => String(raw || '').trim();
const isDoneOrderStatus = (raw: unknown) => ['delivered', 'completed', 'partially_fulfilled', 'cancelled', 'canceled'].includes(String(raw || '').toLowerCase());
const getOrderInvoicePayload = (order?: DriverAssignedOrderRow | null) => {
  const directId = normalizeId((order as any)?.invoice_id);
  const directNumber = normalizeId((order as any)?.invoice_number);
  if (directId || directNumber) {
    return {
      id: directId,
      number: directNumber,
      total: Number((order as any)?.Invoice?.total || 0),
    };
  }

  const refs = collectInvoiceRefs(order);
  const latestInvoice = refs[0] || null;
  return {
    id: normalizeId(order?.invoice_id || latestInvoice?.id),
    number: normalizeId(order?.invoice_number || latestInvoice?.invoice_number),
    total: Number(latestInvoice?.total || 0),
  };
};
const getInvoiceItems = (invoiceData?: InvoiceDetailResponse | null): any[] => {
  if (Array.isArray(invoiceData?.InvoiceItems)) return invoiceData.InvoiceItems as any[];
  if (Array.isArray(invoiceData?.Items)) return invoiceData.Items as any[];
  return [];
};

const CURRENCY_FORMATTER = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const formatCurrency = (value: number) => CURRENCY_FORMATTER.format(Math.round(value));

type ShortageDraftRow = {
  key: string;
  invoiceId: string;
  invoiceNumber: string | null;
  product_id: string | null;
  sku: string;
  name: string;
  invoiceQty: number;
  missingQty: number;
};

type ReturnRow = {
  key: string;
  invoiceId: string;
  orderId: string;
  productId: string;
  sku: string;
  name: string;
  availableQty: number;
  unitPrice: number;
  returnQty: number;
};

type ReturnModalState = {
  rows: ReturnRow[];
  returType: 'delivery_refusal' | 'delivery_damage';
  saving: boolean;
  error: string;
};


export default function DriverCustomerOrdersPage() {
  const allowed = useRequireRoles(['driver', 'super_admin', 'admin_gudang'], '/driver');
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ id: string }>();
  const customerId = normalizeId(params?.id);
  const modalInvoiceParam = normalizeId(searchParams?.get('invoice'));
  const isInvoiceModalOpen = Boolean(modalInvoiceParam);

  const [loading, setLoading] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [activeInvoiceId, setActiveInvoiceId] = useState<string>('');
  const [activeInvoiceLoading, setActiveInvoiceLoading] = useState(false);
  const [shortageModal, setShortageModal] = useState<{
    invoiceId: string;
    invoiceNumber: string | null;
    rows: ShortageDraftRow[];
    saving: boolean;
    error: string;
  } | null>(null);
  const [returnModal, setReturnModal] = useState<ReturnModalState | null>(null);
  const [orders, setOrders] = useState<DriverAssignedOrderRow[]>([]);
  const [invoiceDetailsById, setInvoiceDetailsById] = useState<Record<string, InvoiceDetailResponse | null | undefined>>({});

  const proofInputRef = useRef<HTMLInputElement | null>(null);
  const pendingInvoiceIdsRef = useRef<string[]>([]);

  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      setLoading(true);
      const ordersRes = await api.driver.getOrders({ status: 'shipped' });
      setOrders(Array.isArray(ordersRes.data) ? ordersRes.data : []);
    } catch (error: any) {
      notifyFromAlertMessage(String((error?.response?.data as any)?.message || error?.message || 'Gagal memuat data driver.'));
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    void load();
  }, [load]);

  const customerOrders = useMemo(() => {
    if (!customerId) return [];
    return orders.filter((row) => normalizeId((row as any)?.Customer?.id) === customerId);
  }, [customerId, orders]);

  useEffect(() => {
    if (!allowed) return;
    if (loading) return;
    if (!customerId) return;
    if (customerOrders.length > 0) return;

    const matchRow = orders.find((row) => {
      const invId = getOrderInvoicePayload(row).id;
      const orderId = normalizeId((row as any)?.real_order_id || (row as any)?.id);
      return invId === customerId || orderId === customerId;
    }) as any;
    if (matchRow) {
      const targetCustomerId = normalizeId(matchRow?.Customer?.id);
      const invoiceId = getOrderInvoicePayload(matchRow as any).id;
      const next = targetCustomerId
        ? invoiceId
          ? `/driver/orders/${encodeURIComponent(targetCustomerId)}?invoice=${encodeURIComponent(invoiceId)}`
          : `/driver/orders/${encodeURIComponent(targetCustomerId)}`
        : invoiceId
          ? `/driver/orders/${encodeURIComponent(customerId)}?invoice=${encodeURIComponent(invoiceId)}`
          : `/driver/orders/${encodeURIComponent(customerId)}`;
      router.replace(next);
    }
  }, [allowed, customerId, customerOrders.length, loading, orders, router]);

  const invoiceIds = useMemo(() => {
    const ids = customerOrders.map((row) => getOrderInvoicePayload(row).id).filter(Boolean);
    return Array.from(new Set(ids));
  }, [customerOrders]);

  const openInvoiceModal = useCallback((invoiceIdRaw: string) => {
    const invoiceId = normalizeId(invoiceIdRaw);
    if (!invoiceId) return;
    setActiveInvoiceId(invoiceId);
    if (customerId) {
      router.replace(`/driver/orders/${encodeURIComponent(customerId)}?invoice=${encodeURIComponent(invoiceId)}`);
    }
  }, [customerId, router]);

  const closeInvoiceModal = useCallback(() => {
    if (customerId) {
      router.replace(`/driver/orders/${encodeURIComponent(customerId)}`);
      return;
    }
    router.replace('/driver');
  }, [customerId, router]);

  const clearSelectedInvoice = useCallback(() => {
    setActiveInvoiceId('');
    if (customerId) {
      router.replace(`/driver/orders/${encodeURIComponent(customerId)}`);
      return;
    }
    router.replace('/driver');
  }, [customerId, router]);

  useEffect(() => {
    if (!modalInvoiceParam) return;
    setActiveInvoiceId(modalInvoiceParam);
  }, [modalInvoiceParam]);

  useEffect(() => {
    if (!allowed) return;
    if (invoiceIds.length === 0) {
      queueMicrotask(() => setInvoiceDetailsById({}));
      return;
    }
    let isCancelled = false;
    void (async () => {
      try {
        const responses = await Promise.allSettled(invoiceIds.map((invoiceId) => api.invoices.getById(invoiceId)));
        if (isCancelled) return;
        const next: Record<string, InvoiceDetailResponse | null> = {};
        responses.forEach((result, index) => {
          if (result.status !== 'fulfilled') return;
          const data = result.value?.data || null;
          const id = normalizeId(data?.id || invoiceIds[index]);
          if (!id) return;
          next[id] = data;
        });
        setInvoiceDetailsById(next);
      } catch (error) {
        if (!isCancelled) {
          console.error('Failed to load invoice snapshots:', error);
        }
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [allowed, invoiceIds]);

  const activeInvoiceDetail = useMemo(() => {
    const id = normalizeId(activeInvoiceId);
    if (!id) return null;
    return invoiceDetailsById[id] || null;
  }, [activeInvoiceId, invoiceDetailsById]);

  const activeInvoiceMeta = useMemo(() => {
    const paymentMethod = String((activeInvoiceDetail as any)?.payment_method || '').trim().toLowerCase();
    const paymentStatus = String((activeInvoiceDetail as any)?.payment_status || '').trim().toLowerCase();
    const shipmentStatus = String((activeInvoiceDetail as any)?.shipment_status || '').trim().toLowerCase();
    const paymentMethodLockReason = paymentStatus === 'paid'
      ? 'Invoice sudah lunas.'
      : paymentStatus === 'cod_pending'
        ? 'COD sudah dicatat (pending setor).'
        : '';
    return {
      paymentMethod,
      paymentStatus,
      shipmentStatus,
      canUpdatePaymentMethod: paymentStatus !== 'paid' && paymentStatus !== 'cod_pending',
      paymentMethodLockReason,
      canRecordCod: paymentMethod === 'cod' && ['unpaid', 'draft'].includes(paymentStatus),
      isDelivered: shipmentStatus === 'delivered' || Boolean((activeInvoiceDetail as any)?.delivered_at || (activeInvoiceDetail as any)?.deliveredAt),
    };
  }, [activeInvoiceDetail]);

  useEffect(() => {
    const id = normalizeId(activeInvoiceId);
    if (!allowed) return;
    if (!id) return;
    if (invoiceDetailsById[id]) return;
    let cancelled = false;
    void (async () => {
      try {
        setActiveInvoiceLoading(true);
        const res = await api.invoices.getById(id);
        if (cancelled) return;
        setInvoiceDetailsById((prev) => ({ ...prev, [id]: res.data || null }));
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load invoice detail for modal:', error);
        }
      } finally {
        setActiveInvoiceLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      setActiveInvoiceLoading(false);
    };
  }, [activeInvoiceId, allowed, invoiceDetailsById]);

  const customerMeta = useMemo(() => {
    const primary = customerOrders[0] || null;
    const customer = (primary as any)?.Customer || {};
    const profile = customer.CustomerProfile || {};
    const addresses = Array.isArray(profile.saved_addresses) ? profile.saved_addresses : [];
    const addressObj = addresses.find((a: any) => a?.isPrimary) || addresses[0];
    const address = addressObj ? (addressObj.fullAddress || addressObj.address || 'Alamat tersimpan') : 'Alamat tidak tersedia';
    return {
      name: String((primary as any)?.customer_name || customer?.name || 'Customer Umum'),
      whatsapp: String(customer?.whatsapp_number || '-'),
      address: String(address),
    };
  }, [customerOrders]);

  const invoiceCards = useMemo(() => {
    const buckets = customerOrders.reduce((acc, order) => {
      const invoice = getOrderInvoicePayload(order);
      const invoiceId = invoice.id;
      if (!invoiceId) return acc;
      const bucket = acc.get(invoiceId) || { invoiceId, invoiceNumber: invoice.number, orders: [] as DriverAssignedOrderRow[] };
      bucket.orders.push(order);
      bucket.invoiceNumber = bucket.invoiceNumber || invoice.number;
      acc.set(invoiceId, bucket);
      return acc;
    }, new Map<string, { invoiceId: string; invoiceNumber: string; orders: DriverAssignedOrderRow[] }>());

    return Array.from(buckets.values())
      .map((bucket) => {
        const invoiceDetail = invoiceDetailsById[bucket.invoiceId] || null;
        const number = normalizeId(invoiceDetail?.invoice_number) || normalizeId(bucket.invoiceNumber) || `INV-${bucket.invoiceId.slice(-8).toUpperCase()}`;
        const totalFromSnapshot = Number(invoiceDetail?.total || 0);
        const totalFromOrders = bucket.orders.map((row) => getOrderInvoicePayload(row).total).find((v) => Number.isFinite(v) && v > 0);
        const total = Number.isFinite(totalFromSnapshot) && totalFromSnapshot > 0 ? totalFromSnapshot : Number(totalFromOrders || 0);
        const paymentMethod = String((invoiceDetail as any)?.payment_method || (bucket.orders[0] as any)?.Invoice?.payment_method || (bucket.orders[0] as any)?.payment_method || '').trim().toLowerCase();
        const paymentStatus = String((invoiceDetail as any)?.payment_status || (bucket.orders[0] as any)?.Invoice?.payment_status || (bucket.orders[0] as any)?.payment_status || '').trim().toLowerCase();
        const deliveryReturnSummary = (invoiceDetail as any)?.delivery_return_summary || null;
        const netTotalFromDeliveryReturn = Number(deliveryReturnSummary?.net_total || 0);
        const netTotalEstimate = Number.isFinite(netTotalFromDeliveryReturn) && netTotalFromDeliveryReturn >= 0
          ? netTotalFromDeliveryReturn
          : total;
        const statusValues = Array.from(new Set(bucket.orders.map((o) => String(o?.status || '').trim()).filter(Boolean)));
        const statusLabel = statusValues.length <= 1 ? (statusValues[0] || '-') : `${statusValues.length} status`;
        const activeOrderCount = bucket.orders.filter((o) => !isDoneOrderStatus((o as any)?.status)).length;
        return {
          invoiceId: bucket.invoiceId,
          invoiceNumber: number,
          total,
          netTotalEstimate,
          paymentMethod,
          paymentStatus,
          statusLabel,
          orderCount: bucket.orders.length,
          activeOrderCount,
          orders: bucket.orders,
        };
      })
      .sort((a, b) => b.invoiceId.localeCompare(a.invoiceId));
  }, [customerOrders, invoiceDetailsById]);

  useEffect(() => {
    if (!allowed) return;
    if (activeInvoiceId) return;
    if (invoiceCards.length !== 1) return;
    const onlyInvoiceId = normalizeId((invoiceCards as any)[0]?.invoiceId);
    if (!onlyInvoiceId) return;
    setActiveInvoiceId(onlyInvoiceId);
  }, [activeInvoiceId, allowed, invoiceCards]);

  const overallTotal = useMemo(
    () => invoiceCards.reduce((sum, row) => sum + Number(row.total || 0), 0),
    [invoiceCards]
  );
  const overallNetTotalEstimate = useMemo(
    () => invoiceCards.reduce((sum, row) => sum + Number(row.netTotalEstimate || 0), 0),
    [invoiceCards]
  );

  const allInvoiceIds = useMemo(
    () => Array.from(new Set(invoiceCards.map((row) => normalizeId(row.invoiceId)).filter(Boolean))),
    [invoiceCards]
  );

  const paymentMethodSummary = useMemo(() => {
    const methods = new Set<string>();
    const statuses = new Set<string>();
    let hasUnresolvedMethod = false;
    let hasLockedPaymentMethod = false;
    let lockedPaymentMethodReason = '';
    invoiceCards.forEach((row: any) => {
      const method = String(row.paymentMethod || '').trim().toLowerCase();
      const status = String(row.paymentStatus || '').trim().toLowerCase();
      if (method) methods.add(method);
      if (status) statuses.add(status);
      if (!['cod', 'transfer_manual', 'cash_store'].includes(method) && status !== 'paid') {
        hasUnresolvedMethod = true;
      }
      if (status === 'paid') {
        hasLockedPaymentMethod = true;
        lockedPaymentMethodReason = lockedPaymentMethodReason || 'Metode pembayaran dikunci karena invoice sudah lunas.';
      }
      if (status === 'cod_pending') {
        hasLockedPaymentMethod = true;
        lockedPaymentMethodReason = lockedPaymentMethodReason || 'Metode pembayaran dikunci karena COD sudah dicatat (pending setor).';
      }
    });
    return {
      uniqueMethods: Array.from(methods),
      uniqueStatuses: Array.from(statuses),
      hasUnresolvedMethod,
      hasLockedPaymentMethod,
      lockedPaymentMethodReason,
    };
  }, [invoiceCards]);

  const codInvoiceCards = useMemo(
    () => invoiceCards.filter((row: any) => row.paymentMethod === 'cod' && ['unpaid', 'draft'].includes(String(row.paymentStatus || '').toLowerCase())),
    [invoiceCards]
  );
  const codInvoiceIds = useMemo(
    () => codInvoiceCards.map((row: any) => normalizeId(row.invoiceId)).filter(Boolean),
    [codInvoiceCards]
  );
  const codTotalEstimate = useMemo(
    () => codInvoiceCards.reduce((sum: number, row: any) => sum + Number(row.netTotalEstimate || 0), 0),
    [codInvoiceCards]
  );

  const mergedItems = useMemo(() => {
    const itemMap = new Map<string, { name: string; qty: number }>();
    invoiceCards.forEach((card) => {
      const invoiceDetail = invoiceDetailsById[card.invoiceId] || null;
      const invoiceItems = getInvoiceItems(invoiceDetail);
      if (invoiceItems.length > 0) {
        invoiceItems.forEach((item: any) => {
          const orderItem = item?.OrderItem || {};
          const product = orderItem?.Product || {};
          const key = String(orderItem?.product_id || product?.sku || product?.name || item?.id || '').trim();
          if (!key) return;
          const prev = itemMap.get(key) || { name: product?.name || 'Produk', qty: 0 };
          prev.qty += Number(item?.qty || item?.allocated_qty || 0);
          itemMap.set(key, prev);
        });
        return;
      }

      card.orders.forEach((order) => {
        const items = Array.isArray((order as any)?.OrderItems) ? (order as any).OrderItems : [];
        items.forEach((it: any) => {
          const key = String(it?.product_id || it?.Product?.sku || it?.Product?.name || it?.id || '').trim();
          if (!key) return;
          const prev = itemMap.get(key) || { name: it?.Product?.name || 'Produk', qty: 0 };
          prev.qty += Number(it?.qty || 0);
          itemMap.set(key, prev);
        });
      });
    });

    return Array.from(itemMap.values()).sort((a, b) => b.qty - a.qty);
  }, [invoiceCards, invoiceDetailsById]);
  const returnCandidates = useMemo(() => {
    const map = new Map<string, ReturnRow>();
    customerOrders.forEach((order) => {
      const invoiceId = normalizeId((order as any)?.invoice_id || '');
      const orderId = normalizeId((order as any)?.real_order_id || (order as any)?.id || '');
      if (!invoiceId || !orderId) return;
      const items = Array.isArray((order as any)?.OrderItems) ? (order as any).OrderItems : [];
      items.forEach((item: any) => {
        const productId = normalizeId(item?.product_id || (item?.Product?.id || ''));
        const qty = Math.max(0, Math.trunc(Number(item?.qty || 0)));
        if (!productId || qty <= 0) return;
        const key = `${invoiceId}:${orderId}:${productId}`;
        const existing = map.get(key);
        if (existing) {
          existing.availableQty += qty;
          return;
        }
        map.set(key, {
          key,
          invoiceId,
          orderId,
          productId,
          sku: String(item?.Product?.sku || item?.sku || '-'),
          name: String(item?.Product?.name || item?.name || 'Produk'),
          availableQty: qty,
          unitPrice: Math.max(0, Number(item?.price_at_purchase || item?.unit_price || 0)),
          returnQty: 0,
        });
      });
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name) || a.sku.localeCompare(b.sku));
  }, [customerOrders]);

  const returnCandidatesSummary = useMemo(() => {
    const totalQty = returnCandidates.reduce((sum, row) => sum + row.availableQty, 0);
    const totalValue = returnCandidates.reduce((sum, row) => sum + row.availableQty * row.unitPrice, 0);
    return { totalQty, totalValue };
  }, [returnCandidates]);



  const startBatchComplete = useCallback(() => {
    const ids = allInvoiceIds;
    if (ids.length === 0) {
      notifyOpen({ variant: 'warning', title: 'Perhatian', message: 'Tidak ada invoice yang bisa diproses.' });
      return;
    }
    if (paymentMethodSummary.hasUnresolvedMethod) {
      notifyOpen({
        variant: 'warning',
        title: 'Perhatian',
        message: 'Metode pembayaran masih belum ditentukan untuk sebagian invoice. Pilih COD/Transfer dulu sebelum menyelesaikan pengiriman.',
      });
      return;
    }
    if (codInvoiceIds.length > 0) {
      notifyOpen({
        variant: 'warning',
        title: 'Perhatian',
        message: `Metode COD dipilih. Catat COD dulu sebesar Rp ${Math.round(codTotalEstimate).toLocaleString('id-ID')} sebelum menyelesaikan pengiriman.`,
      });
      return;
    }
    if (batchLoading) return;
    if (!proofInputRef.current) return;
    pendingInvoiceIdsRef.current = ids;
    proofInputRef.current.value = '';
    proofInputRef.current.click();
  }, [allInvoiceIds, batchLoading, codInvoiceIds.length, codTotalEstimate, paymentMethodSummary.hasUnresolvedMethod]);

  const handleProofSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    const ids = pendingInvoiceIdsRef.current;
    pendingInvoiceIdsRef.current = [];
    if (!file || ids.length === 0) return;

    const confirmed = await notifyConfirm({
      title: 'Selesaikan Pengiriman',
      message: `Selesaikan pengiriman untuk ${ids.length} invoice customer ini?`,
      confirmLabel: 'Lanjut',
      cancelLabel: 'Batal',
      variant: 'warning',
    });
    if (!confirmed) return;

    try {
      setBatchLoading(true);
      await api.driver.completeOrdersBatch(ids, { proof: file });
      notifySuccess(`Pengiriman selesai untuk ${ids.length} invoice.`);
      router.push('/driver');
    } catch (error: any) {
      notifyFromAlertMessage(String((error?.response?.data as any)?.message || error?.message || 'Gagal menyelesaikan pengiriman.'));
    } finally {
      setBatchLoading(false);
    }
  }, [router]);

  const recordCodPaymentOnce = useCallback(async () => {
    if (paymentLoading) return;
    if (codInvoiceIds.length === 0) {
      notifyOpen({ variant: 'warning', title: 'Perhatian', message: 'Tidak ada invoice COD yang perlu dicatat.' });
      return;
    }
    const totalLabel = `Rp ${Math.round(codTotalEstimate).toLocaleString('id-ID')}`;
    const confirmed = await notifyConfirm({
      title: 'Catat Pembayaran COD',
      message: `Catat pembayaran COD untuk ${codInvoiceIds.length} invoice (total ${totalLabel})?`,
      confirmLabel: 'Catat COD',
      cancelLabel: 'Batal',
      variant: 'warning',
    });
    if (!confirmed) return;

    try {
      setPaymentLoading(true);
      await api.driver.recordPaymentBatch({ invoice_ids: codInvoiceIds });
      notifySuccess(`Pembayaran COD berhasil dicatat untuk ${codInvoiceIds.length} invoice.`);
      await load();
    } catch (error: any) {
      notifyFromAlertMessage(String((error?.response?.data as any)?.message || error?.message || 'Gagal mencatat pembayaran COD.'));
    } finally {
      setPaymentLoading(false);
    }
  }, [codInvoiceIds, codTotalEstimate, load, paymentLoading]);
  const returnModalSummary = useMemo(() => {
    if (!returnModal) return { totalQty: 0, totalValue: 0 };
    return {
      totalQty: returnModal.rows.reduce((sum, row) => sum + row.returnQty, 0),
      totalValue: returnModal.rows.reduce((sum, row) => sum + row.returnQty * row.unitPrice, 0),
    };
  }, [returnModal]);

  const openReturnModal = useCallback(() => {
    if (returnCandidates.length === 0) {
      notifyOpen({ variant: 'warning', title: 'Perhatian', message: 'Tidak ada barang tertugaskan untuk customer ini.' });
      return;
    }
    setReturnModal({
      rows: returnCandidates.map((row) => ({ ...row, returnQty: 0 })),
      returType: 'delivery_refusal',
      saving: false,
      error: '',
    });
  }, [returnCandidates]);

  const closeReturnModal = useCallback(() => {
    if (returnModal?.saving) return;
    setReturnModal(null);
  }, [returnModal]);

  const updateReturnQty = useCallback((key: string, qty: number) => {
    setReturnModal((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rows: prev.rows.map((row) => (row.key === key ? { ...row, returnQty: Math.max(0, Math.min(qty, row.availableQty)) } : row)),
      };
    });
  }, []);

  const handleReturnSubmit = useCallback(async () => {
    if (!returnModal || returnModal.saving) return;
    const selected = returnModal.rows.filter((row) => row.returnQty > 0);
    if (selected.length === 0) {
      setReturnModal((prev) => prev ? { ...prev, error: 'Pilih minimal 1 barang untuk diretur.' } : prev);
      return;
    }
    const totalQty = selected.reduce((sum, row) => sum + row.returnQty, 0);
    const totalValue = selected.reduce((sum, row) => sum + row.returnQty * row.unitPrice, 0);
    const confirmed = await notifyConfirm({
      title: 'Kirim Retur Barang',
      message: `Kirim retur untuk ${totalQty} item (potongan Rp ${Math.round(totalValue).toLocaleString('id-ID')})?`,
      confirmLabel: 'Kirim Retur',
      cancelLabel: 'Batal',
      variant: 'warning',
    });
    if (!confirmed) return;

    setReturnModal((prev) => prev ? { ...prev, saving: true, error: '' } : prev);
    try {
      const groups = new Map<string, ReturnRow[]>();
      selected.forEach((row) => {
        const invoiceId = normalizeId(row.invoiceId);
        if (!invoiceId) return;
        const bucket = groups.get(invoiceId) || [];
        bucket.push(row);
        groups.set(invoiceId, bucket);
      });
      for (const [invoiceId, rows] of groups.entries()) {
        if (!invoiceId) continue;
        const payload = {
          retur_type: returnModal.returType,
          items: rows.map((row) => ({
            product_id: row.productId,
            order_id: row.orderId,
            qty: row.returnQty,
            reason: returnModal.returType === 'delivery_damage'
              ? 'Retur saat pengiriman (barang rusak)'
              : 'Retur saat pengiriman (tidak jadi beli)',
          })),
        };
        await api.driver.createDeliveryReturTicket(invoiceId, payload);
        const res = await api.invoices.getById(invoiceId);
        setInvoiceDetailsById((prev) => ({ ...prev, [invoiceId]: res.data || null }));
      }
      notifySuccess('Retur tercatat. Driver tercatat membawa barang retur sampai admin verifikasi serah gudang.');
      await load();
      clearSelectedInvoice();
      setReturnModal(null);
    } catch (error: any) {
      const message = String((error?.response?.data as any)?.message || error?.message || 'Gagal mencatat retur.');
      setReturnModal((prev) => prev ? { ...prev, saving: false, error: message } : prev);
      notifyFromAlertMessage(message);
    }
  }, [clearSelectedInvoice, load, returnModal, setInvoiceDetailsById]);



  const updateInvoicePaymentMethod = useCallback(async (nextMethod: 'cod' | 'transfer_manual') => {
    const invoiceId = normalizeId(activeInvoiceId);
    if (!invoiceId) return;
    if (!activeInvoiceMeta.canUpdatePaymentMethod) {
      notifyOpen({
        variant: 'warning',
        title: 'Perhatian',
        message: activeInvoiceMeta.paymentMethodLockReason || 'Metode pembayaran sudah dikunci.',
      });
      return;
    }
    try {
      setActiveInvoiceLoading(true);
      await api.driver.updatePaymentMethod(invoiceId, nextMethod);
      const res = await api.invoices.getById(invoiceId);
      setInvoiceDetailsById((prev) => ({ ...prev, [invoiceId]: res.data || null }));
      notifySuccess('Metode pembayaran diperbarui.');
    } catch (error: any) {
      notifyFromAlertMessage(String((error?.response?.data as any)?.message || error?.message || 'Gagal memperbarui metode pembayaran.'));
    } finally {
      setActiveInvoiceLoading(false);
    }
  }, [activeInvoiceId, activeInvoiceMeta.canUpdatePaymentMethod, activeInvoiceMeta.paymentMethodLockReason]);

  const updateAllInvoicesPaymentMethod = useCallback(async (nextMethod: 'cod' | 'transfer_manual') => {
    if (activeInvoiceLoading) return;
    if (allInvoiceIds.length === 0) {
      notifyOpen({ variant: 'warning', title: 'Perhatian', message: 'Tidak ada invoice.' });
      return;
    }
    if (paymentMethodSummary.hasLockedPaymentMethod) {
      notifyOpen({
        variant: 'warning',
        title: 'Perhatian',
        message: paymentMethodSummary.lockedPaymentMethodReason || 'Metode pembayaran sudah dikunci.',
      });
      return;
    }
    const label = nextMethod === 'cod' ? 'COD' : 'Transfer';
    const confirmed = await notifyConfirm({
      title: 'Ubah Metode Pembayaran',
      message: `Terapkan metode pembayaran ${label} untuk ${allInvoiceIds.length} invoice customer ini?`,
      confirmLabel: 'Terapkan',
      cancelLabel: 'Batal',
      variant: 'warning',
    });
    if (!confirmed) return;

    const succeeded: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];
    try {
      setActiveInvoiceLoading(true);
      for (const invoiceId of allInvoiceIds) {
        try {
          await api.driver.updatePaymentMethod(invoiceId, nextMethod);
          succeeded.push(invoiceId);
          const res = await api.invoices.getById(invoiceId);
          setInvoiceDetailsById((prev) => ({ ...prev, [invoiceId]: res.data || null }));
        } catch (error: any) {
          failed.push({
            id: invoiceId,
            reason: String((error?.response?.data as any)?.message || error?.message || 'gagal'),
          });
        }
      }
      if (failed.length === 0) {
        notifySuccess(`Metode pembayaran ${label} diterapkan untuk ${succeeded.length} invoice.`);
      } else {
        notifyOpen({
          variant: 'warning',
          title: 'Sebagian gagal',
          message: `${succeeded.length} berhasil, ${failed.length} gagal. Contoh: ${failed[0]?.reason || 'gagal'}`,
        });
      }
    } finally {
      setActiveInvoiceLoading(false);
    }
  }, [activeInvoiceLoading, allInvoiceIds, paymentMethodSummary.hasLockedPaymentMethod, paymentMethodSummary.lockedPaymentMethodReason]);

  const recordSingleCodPayment = useCallback(async () => {
    const invoiceId = normalizeId(activeInvoiceId);
    if (!invoiceId) return;
    const confirmed = await notifyConfirm({
      title: 'Catat Pembayaran COD',
      message: 'Catat pembayaran COD untuk invoice ini?',
      confirmLabel: 'Catat COD',
      cancelLabel: 'Batal',
      variant: 'warning',
    });
    if (!confirmed) return;
    try {
      setActiveInvoiceLoading(true);
      await api.driver.recordPaymentBatch({ invoice_ids: [invoiceId] });
      const res = await api.invoices.getById(invoiceId);
      setInvoiceDetailsById((prev) => ({ ...prev, [invoiceId]: res.data || null }));
      notifySuccess('Pembayaran COD berhasil dicatat.');
    } catch (error: any) {
      notifyFromAlertMessage(String((error?.response?.data as any)?.message || error?.message || 'Gagal mencatat pembayaran COD.'));
    } finally {
      setActiveInvoiceLoading(false);
    }
  }, [activeInvoiceId]);

  const openShortageModal = useCallback(() => {
    if (allInvoiceIds.length === 0) return;

    const buckets = new Map<string, ShortageDraftRow>();
    let hasAnyItem = false;

    allInvoiceIds.forEach((invoiceId) => {
      const invoiceDetail = invoiceDetailsById[invoiceId] || null;
      const invoiceItems = getInvoiceItems(invoiceDetail);
      const invoiceNumber = String((invoiceDetail as any)?.invoice_number || '').trim() || null;
      if (!invoiceItems || invoiceItems.length === 0) return;

      invoiceItems.forEach((item: any, idx: number) => {
        const orderItem = item?.OrderItem || {};
        const product = orderItem?.Product || {};
        const productId = normalizeId(orderItem?.product_id) || '';
        const sku = String(product?.sku || '').trim() || '-';
        const name = String(product?.name || 'Produk');
        const qty = Math.max(0, Math.trunc(Number(item?.qty ?? item?.allocated_qty ?? 0)));
        if (!qty) return;
        hasAnyItem = true;

        const key = `${invoiceId}:${productId || `${sku}:${name}:${idx}`}`;
        const existing = buckets.get(key);
        if (existing) {
          existing.invoiceQty += qty;
          buckets.set(key, existing);
          return;
        }
        buckets.set(key, {
          key,
          invoiceId,
          invoiceNumber,
          product_id: productId || null,
          sku,
          name,
          invoiceQty: qty,
          missingQty: 0,
        });
      });
    });

    if (!hasAnyItem) {
      notifyOpen({ variant: 'warning', title: 'Perhatian', message: 'Item invoice tidak tersedia untuk dipilih.' });
      return;
    }

    const rows = Array.from(buckets.values()).sort((a, b) => {
      const invA = String(a.invoiceNumber || a.invoiceId);
      const invB = String(b.invoiceNumber || b.invoiceId);
      const cmp = invA.localeCompare(invB);
      if (cmp !== 0) return cmp;
      return b.invoiceQty - a.invoiceQty;
    });
    setShortageModal({
      invoiceId: '',
      invoiceNumber: null,
      rows,
      saving: false,
      error: '',
    });
  }, [allInvoiceIds, invoiceDetailsById]);

  const submitShortageReport = useCallback(async () => {
    if (!shortageModal) return;
    if (shortageModal.saving) return;

    const selected = shortageModal.rows
      .map((row) => ({ ...row, missingQty: Math.max(0, Math.min(row.invoiceQty, Math.trunc(Number(row.missingQty || 0)))) }))
      .filter((row) => row.missingQty > 0);

    if (selected.length === 0) {
      setShortageModal((prev) => prev ? { ...prev, error: 'Pilih minimal 1 item yang kurang.' } : prev);
      return;
    }

    const groups = new Map<string, ShortageDraftRow[]>();
    selected.forEach((row) => {
      const invoiceId = normalizeId(row.invoiceId);
      if (!invoiceId) return;
      const bucket = groups.get(invoiceId) || [];
      bucket.push(row);
      groups.set(invoiceId, bucket);
    });
    const invoiceIds = Array.from(groups.keys()).filter(Boolean);
    if (invoiceIds.length === 0) {
      setShortageModal((prev) => prev ? { ...prev, error: 'Invoice tidak valid.' } : prev);
      return;
    }

    const confirmed = await notifyConfirm({
      title: 'Kirim Laporan Barang Kurang',
      message: `Kirim laporan barang kurang untuk ${selected.length} item pada ${invoiceIds.length} invoice?`,
      confirmLabel: 'Kirim',
      cancelLabel: 'Batal',
      variant: 'warning',
    });
    if (!confirmed) return;

    try {
      setShortageModal((prev) => prev ? { ...prev, saving: true, error: '' } : prev);
      setActiveInvoiceLoading(true);
      const succeeded: string[] = [];
      const failed: Array<{ invoiceId: string; reason: string }> = [];

      for (const invoiceId of invoiceIds) {
        const rows = groups.get(invoiceId) || [];
        if (rows.length === 0) continue;
        const invoiceNumber = rows[0]?.invoiceNumber || null;

        const noteLines = rows.map((row) => {
          const skuLabel = row.sku && row.sku !== '-' ? `(${row.sku}) ` : '';
          return `- ${skuLabel}${row.name} x${row.missingQty}`;
        });
        const note = `Barang kurang:\n${noteLines.join('\n')}`;

        const shortageItemsPayload = rows.map((row) => ({
          product_id: row.product_id,
          sku: row.sku,
          name: row.name,
          missing_qty: row.missingQty,
        }));

        const checklistSnapshot = JSON.stringify({
          invoice_id: invoiceId,
          invoice_number: invoiceNumber,
          items: rows.map((row) => ({
            product_id: row.product_id,
            sku: row.sku,
            name: row.name,
            invoice_qty: row.invoiceQty,
            missing_qty: row.missingQty,
          }))
        });

        try {
          await api.driver.reportIssue(invoiceId, {
            note,
            checklist_snapshot: checklistSnapshot,
            shortage_items: JSON.stringify(shortageItemsPayload),
          });
          succeeded.push(invoiceId);
        } catch (error: any) {
          failed.push({
            invoiceId,
            reason: String((error?.response?.data as any)?.message || error?.message || 'Gagal mengirim laporan barang kurang.'),
          });
        }
      }

      if (failed.length === 0) {
        notifySuccess(`Laporan barang kurang berhasil dikirim untuk ${succeeded.length} invoice.`);
      } else {
        notifyOpen({
          variant: 'warning',
          title: 'Sebagian gagal',
          message: `${succeeded.length} berhasil, ${failed.length} gagal. Contoh: ${failed[0]?.reason || 'Gagal.'}`,
        });
      }
      setShortageModal(null);
      await load();
      clearSelectedInvoice();
    } catch (error: any) {
      const message = String((error?.response?.data as any)?.message || error?.message || 'Gagal mengirim laporan barang kurang.');
      setShortageModal((prev) => prev ? { ...prev, saving: false, error: message } : prev);
      notifyFromAlertMessage(message);
    } finally {
      setActiveInvoiceLoading(false);
    }
  }, [clearSelectedInvoice, load, shortageModal]);

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-6 pb-24">
      <input ref={proofInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleProofSelected} />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push('/driver')}
          className="btn-3d h-10 w-10 rounded-2xl bg-white border border-slate-200 inline-flex items-center justify-center text-slate-700"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pengiriman Customer</p>
          <h1 className="text-lg font-black text-slate-900 truncate">{customerMeta.name}</h1>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-[24px] p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-2 text-slate-600">
          <User size={14} className="opacity-40" />
          <span className="text-xs font-bold">{customerMeta.name}</span>
        </div>
        <div className="flex items-start gap-2 text-slate-600">
          <MapPin size={14} className="min-w-[14px] mt-0.5 opacity-40" />
          <span className="text-xs font-medium leading-relaxed">{customerMeta.address}</span>
        </div>
        <div className="flex items-center gap-2 text-slate-600">
          <Phone size={14} className="opacity-40" />
          <span className="text-xs font-medium">{customerMeta.whatsapp}</span>
        </div>

        <div className="pt-3 border-t border-slate-100 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-slate-700">
              <Wallet size={14} className="opacity-40" />
              <span className="text-xs font-black">Total: Rp {overallTotal.toLocaleString('id-ID')}</span>
            </div>
            {codInvoiceIds.length > 0 && (
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">
                COD {codInvoiceIds.length} invoice • Rp {Math.round(codTotalEstimate).toLocaleString('id-ID')}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">Daftar Invoice</h2>
          {loading && <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Memuat...</span>}
        </div>

        <div className="grid grid-cols-1 gap-3">
          {invoiceCards.length === 0 ? (
            <div className="bg-white border border-slate-100 rounded-3xl p-10 text-center shadow-sm">
              <Package size={40} className="mx-auto text-slate-200 mb-3" />
              <p className="text-sm font-bold text-slate-400 italic">
                {customerId ? 'Tidak ada invoice shipped untuk customer ini.' : 'Customer ID tidak valid.'}
              </p>
            </div>
          ) : (
	            invoiceCards.map((card) => (
	              <div key={card.invoiceId} className="bg-white border border-slate-100 rounded-[24px] p-4 shadow-sm">
	                <div className="flex items-start justify-between gap-3">
	                  <div className="min-w-0">
	                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Invoice</p>
	                    <p className="text-base font-black text-slate-900 leading-none truncate">{card.invoiceNumber}</p>
	                    <p className="text-[10px] text-slate-500 mt-1">
	                      {card.orderCount} order • {card.statusLabel}
	                    </p>
	                    <p className="text-[10px] text-slate-500 mt-1">
	                      Tagihan:{' '}
	                      <span className="font-black text-slate-700">
	                        Rp {Math.round(Number(card.netTotalEstimate || 0)).toLocaleString('id-ID')}
	                      </span>
	                      {card.paymentMethod ? ` • ${String(card.paymentMethod).toUpperCase()}` : ''}
	                      {card.paymentStatus ? ` • ${String(card.paymentStatus).toUpperCase()}` : ''}
	                    </p>
	                  </div>
	                  <div className="text-right">
	                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Total</p>
	                    <p className="text-sm font-black text-slate-900">Rp {Number(card.total || 0).toLocaleString('id-ID')}</p>
	                  </div>
	                </div>

                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => openInvoiceModal(card.invoiceId)}
                    className="btn-3d w-full py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-[10px] font-black uppercase inline-flex items-center justify-center gap-1"
                  >
                    Detail Invoice <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {invoiceCards.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-[24px] p-5 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Aksi Pengiriman (Gabungan)</p>
              <p className="text-lg font-black text-slate-900 truncate">{customerMeta.name}</p>
              <p className="text-[11px] font-bold text-slate-500 mt-1">
                {invoiceCards.length} invoice • Total Rp {Math.round(overallNetTotalEstimate).toLocaleString('id-ID')}
              </p>
              {paymentMethodSummary.uniqueMethods.length > 0 ? (
                <p className="text-[11px] font-bold text-slate-500 mt-1">
                  Metode: {paymentMethodSummary.uniqueMethods.join(', ')} • Status bayar: {paymentMethodSummary.uniqueStatuses.join(', ') || '-'}
                </p>
              ) : null}
            </div>
            {activeInvoiceId ? (
              <button
                type="button"
                onClick={() => {
                  clearSelectedInvoice();
                }}
                className="btn-3d px-3 py-2 rounded-xl text-[10px] font-black uppercase border border-slate-200 text-slate-700 bg-white hover:bg-slate-50"
              >
                Reset Pilihan
              </button>
            ) : null}
          </div>

          {activeInvoiceLoading && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-600">
              Memuat / memproses...
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Opsi Pembayaran</p>
              <div className="flex items-center gap-2">
                {(() => {
                  const methods = paymentMethodSummary.uniqueMethods;
                  const codSelected = !paymentMethodSummary.hasUnresolvedMethod && methods.length === 1 && methods[0] === 'cod';
                  const transferSelected = !paymentMethodSummary.hasUnresolvedMethod && methods.length === 1 && methods[0] === 'transfer_manual';
                  return (
                    <>
                <button
                  type="button"
                  disabled={activeInvoiceLoading || allInvoiceIds.length === 0 || paymentMethodSummary.hasLockedPaymentMethod}
                  onClick={() => updateAllInvoicesPaymentMethod('cod')}
                  className={`btn-3d flex-1 px-3 py-2 rounded-xl border text-[10px] font-black uppercase disabled:opacity-60 ${codSelected ? 'border-amber-200 bg-amber-600 text-white hover:bg-amber-700' : 'border border-slate-200 text-slate-700 bg-white hover:bg-slate-50'}`}
                >
                  COD
                </button>
                <button
                  type="button"
                  disabled={activeInvoiceLoading || allInvoiceIds.length === 0 || paymentMethodSummary.hasLockedPaymentMethod}
                  onClick={() => updateAllInvoicesPaymentMethod('transfer_manual')}
                  className={`btn-3d flex-1 px-3 py-2 rounded-xl border text-[10px] font-black uppercase disabled:opacity-60 ${transferSelected ? 'border-sky-200 bg-sky-600 text-white hover:bg-sky-700' : 'border border-slate-200 text-slate-700 bg-white hover:bg-slate-50'}`}
                >
                  Transfer
                </button>
                    </>
                  );
                })()}
              </div>
              {paymentMethodSummary.hasLockedPaymentMethod ? (
                <p className="text-[11px] font-semibold text-amber-700">
                  {paymentMethodSummary.lockedPaymentMethodReason || 'Metode pembayaran sudah dikunci.'}
                </p>
              ) : null}
              {paymentMethodSummary.hasUnresolvedMethod ? (
                <p className="text-[11px] font-semibold text-slate-500">
                  Metode pembayaran belum ditentukan untuk sebagian invoice. Pilih COD/Transfer dulu.
                </p>
              ) : null}
            </div>

            {codInvoiceIds.length > 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pembayaran COD</p>
                <p className="text-[11px] font-semibold text-slate-600">
                  Catat penerimaan uang COD untuk invoice COD yang belum dibayar: <span className="font-black">Rp {Math.round(codTotalEstimate).toLocaleString('id-ID')}</span>
                </p>
                <button
                  type="button"
                  disabled={paymentLoading || codInvoiceIds.length === 0}
                  onClick={recordCodPaymentOnce}
                  className="btn-3d w-full px-3 py-2 rounded-xl bg-amber-600 text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-60"
                >
                  {paymentLoading ? 'COD...' : `Catat COD • Rp ${Math.round(codTotalEstimate).toLocaleString('id-ID')}`}
                </button>
                {codInvoiceIds.length === 0 ? (
                  <p className="text-[11px] font-semibold text-slate-500">Tidak ada invoice COD yang perlu dicatat.</p>
                ) : null}
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pembayaran Customer</p>
                <p className="text-[11px] font-semibold text-slate-500">
                  Jika pembayaran bukan COD, lanjutkan proses pengiriman.
                </p>
              </div>
            )}
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pengembalian Barang</p>
                <p className="text-sm font-black text-slate-900 truncate">Laporkan retur kepada gudang</p>
              </div>
              <button
                type="button"
                onClick={openReturnModal}
                disabled={returnCandidatesSummary.totalQty === 0 || Boolean(returnModal?.saving)}
                className="btn-3d px-3 py-2 rounded-xl text-[10px] font-black uppercase border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60"
              >
                Laporkan Retur
              </button>
            </div>
            <p className="text-[10px] text-slate-500">Setelah retur disimpan, driver tercatat membawa barang retur (status picked_up) hingga admin verifikasi serah gudang.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Bukti Foto Pengiriman</p>
              <button
                type="button"
                disabled={activeInvoiceLoading || batchLoading || invoiceCards.length === 0 || codInvoiceIds.length > 0 || paymentMethodSummary.hasUnresolvedMethod}
                onClick={startBatchComplete}
                className="btn-3d w-full px-3 py-3 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-60"
              >
                {batchLoading ? 'Proses...' : 'Upload Foto & Selesaikan Pengiriman'}
              </button>
              {paymentMethodSummary.hasUnresolvedMethod ? (
                <p className="text-[11px] font-semibold text-amber-700">
                  Metode pembayaran belum dipilih. Pilih <span className="font-black">COD</span> atau <span className="font-black">Transfer</span> dulu.
                </p>
              ) : null}
              {codInvoiceIds.length > 0 ? (
                <p className="text-[11px] font-semibold text-amber-700">
                  COD belum dicatat. Terima uang dan klik <span className="font-black">Catat COD</span> dulu.
                </p>
              ) : null}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Laporan Barang Kurang</p>
              <button
                type="button"
                disabled={activeInvoiceLoading || invoiceCards.length === 0}
                onClick={openShortageModal}
                className="btn-3d w-full px-3 py-2 rounded-xl bg-rose-600 text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-60"
              >
                Pilih Barang Kurang
              </button>
              <p className="text-[11px] font-semibold text-slate-500">
                Pilih item yang kurang dari gabungan barang semua invoice agar admin mudah tindak lanjut.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">Rincian Barang (Gabungan)</h2>
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{mergedItems.length} item</span>
        </div>

        <div className="bg-white border border-slate-100 rounded-[24px] p-4 shadow-sm">
          {mergedItems.length === 0 ? (
            <p className="text-sm font-bold text-slate-400 italic text-center py-8">Tidak ada rincian barang.</p>
          ) : (
            <div className="space-y-2">
              {mergedItems.map((item, idx) => (
                <div key={`${item.name}-${idx}`} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 border border-slate-100 px-3 py-2">
                  <p className="text-xs font-black text-slate-900 line-clamp-1">{item.name}</p>
                  <span className="px-3 py-1 rounded-full bg-white border border-slate-200 text-[10px] font-black text-slate-700">
                    Qty {Number(item.qty || 0)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {isInvoiceModalOpen && activeInvoiceId && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/60"
            aria-label="Tutup popup"
            onClick={closeInvoiceModal}
          />
          <div className="absolute inset-x-0 top-6 mx-auto w-[min(720px,calc(100%-2rem))]">
            <div className="bg-white rounded-[28px] shadow-2xl border border-slate-200 overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Detail Invoice</p>
                  <p className="text-lg font-black text-slate-900 truncate">
                    {String((activeInvoiceDetail as any)?.invoice_number || '').trim()
                      || `INV-${String(activeInvoiceId).slice(-8).toUpperCase()}`}
                  </p>
                  <p className="text-[11px] font-bold text-slate-500 mt-1">
                    Status bayar: {String((activeInvoiceDetail as any)?.payment_status || '-')} • Metode: {String((activeInvoiceDetail as any)?.payment_method || '-')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeInvoiceModal}
                  className="btn-3d h-10 w-10 rounded-2xl bg-white border border-slate-200 inline-flex items-center justify-center text-slate-700"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-5 space-y-4 max-h-[75vh] overflow-auto">
                {activeInvoiceLoading && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-600">
                    Memuat / memproses...
                  </div>
                )}

                <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Rincian Barang</p>
                  {(() => {
                    const items = getInvoiceItems(activeInvoiceDetail);
                    if (!items || items.length === 0) {
                      return <p className="text-sm font-bold text-slate-400 italic text-center py-6">Item invoice tidak tersedia.</p>;
                    }
                    return (
                      <div className="space-y-2">
                        {items.slice(0, 80).map((item: any, idx: number) => {
                          const orderItem = item?.OrderItem || {};
                          const product = orderItem?.Product || {};
                          const name = String(product?.name || 'Produk');
                          const qty = Number(item?.qty || item?.allocated_qty || 0);
                          return (
                            <div key={`${String(item?.id || idx)}-${idx}`} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 border border-slate-100 px-3 py-2">
                              <p className="text-xs font-black text-slate-900 line-clamp-1">{name}</p>
                              <span className="px-3 py-1 rounded-full bg-white border border-slate-200 text-[10px] font-black text-slate-700">
                                Qty {Number.isFinite(qty) ? qty : 0}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {returnModal && (
        <div className="fixed inset-0 z-[60]">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/60"
            aria-label="Tutup popup"
            onClick={closeReturnModal}
          />
          <div className="absolute inset-x-0 top-6 mx-auto w-[min(720px,calc(100%-2rem))]">
            <div className="bg-white rounded-[28px] shadow-2xl border border-slate-200 overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Retur Barang</p>
                  <p className="text-lg font-black text-slate-900 truncate">{returnModal.rows.length} item tersedia</p>
                  <p className="text-[11px] font-bold text-slate-500 mt-1">Total pilihan: {returnModalSummary.totalQty} item • {formatCurrency(returnModalSummary.totalValue)}</p>
                </div>
                <button
                  type="button"
                  onClick={closeReturnModal}
                  className="btn-3d h-10 w-10 rounded-2xl bg-white border border-slate-200 inline-flex items-center justify-center text-slate-700"
                  disabled={returnModal.saving}
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-5 space-y-4 max-h-[70vh] overflow-auto">
                {returnModal.error ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">
                    {returnModal.error}
                  </div>
                ) : null}

                <div className="space-y-3">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Jenis Retur</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setReturnModal((prev) => prev ? { ...prev, returType: 'delivery_refusal' } : prev)}
                      className={`btn-3d px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest ${returnModal.returType === 'delivery_refusal' ? 'border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700' : 'border border-slate-200 text-slate-700 bg-white hover:bg-slate-50'}`}
                    >
                      Tidak jadi beli
                    </button>
                    <button
                      type="button"
                      onClick={() => setReturnModal((prev) => prev ? { ...prev, returType: 'delivery_damage' } : prev)}
                      className={`btn-3d px-3 py-2 rounded-xl border text-[10px] font-black uppercase tracking-widest ${returnModal.returType === 'delivery_damage' ? 'border-amber-200 bg-amber-600 text-white hover:bg-amber-700' : 'border border-slate-200 text-slate-700 bg-white hover:bg-slate-50'}`}
                    >
                      Barang rusak
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {returnModal.rows.map((row) => {
                    const currentQty = Math.max(0, Math.min(row.availableQty, Math.trunc(Number(row.returnQty || 0))));
                    return (
                      <div key={row.key} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-black text-slate-900 truncate">{row.name}</p>
                            <p className="text-[10px] text-slate-500">Invoice {row.invoiceId} • Order {row.orderId}</p>
                            <p className="text-[10px] text-slate-500">SKU {row.sku} • Max {row.availableQty} • Harga {formatCurrency(row.unitPrice)}</p>
                          </div>
                          <div className="min-w-[180px] text-right space-y-1">
                            <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">Qty retur</p>
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => updateReturnQty(row.key, Math.max(0, currentQty - 1))}
                                disabled={returnModal.saving || currentQty <= 0}
                                className="btn-3d inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-white text-rose-700 disabled:opacity-50"
                              >
                                <Minus size={14} />
                              </button>
                              <input
                                type="number"
                                min={0}
                                max={row.availableQty}
                                value={currentQty}
                                disabled={returnModal.saving}
                                onChange={(e) => updateReturnQty(row.key, Math.max(0, Math.min(row.availableQty, Math.trunc(Number(e.target.value || 0)))))}
                                className="w-16 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black text-slate-900 text-right outline-none focus:bg-white focus:border-rose-300"
                              />
                              <button
                                type="button"
                                onClick={() => updateReturnQty(row.key, Math.min(row.availableQty, currentQty + 1))}
                                disabled={returnModal.saving || currentQty >= row.availableQty}
                                className="btn-3d inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-white text-rose-700 disabled:opacity-50"
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

              <div className="border-t border-slate-100 bg-white px-5 py-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Potongan total</p>
                    <p className="text-lg font-black text-emerald-700">{formatCurrency(returnModalSummary.totalValue)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleReturnSubmit}
                    disabled={returnModal.saving || returnModalSummary.totalQty === 0}
                    className="btn-3d rounded-xl bg-rose-600 px-4 py-2 text-[11px] font-black uppercase tracking-wider text-white disabled:opacity-50"
                  >
                    {returnModal.saving ? 'Mengirim...' : 'Kirim Retur'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {shortageModal && (
        <div className="fixed inset-0 z-[60]">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/60"
            aria-label="Tutup popup"
            onClick={() => shortageModal.saving ? undefined : setShortageModal(null)}
          />
          <div className="absolute inset-x-0 top-6 mx-auto w-[min(720px,calc(100%-2rem))]">
            <div className="bg-white rounded-[28px] shadow-2xl border border-slate-200 overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Laporan Barang Kurang</p>
                  <p className="text-lg font-black text-slate-900 truncate">
                    {shortageModal.invoiceNumber ? `Invoice ${shortageModal.invoiceNumber}` : `Invoice ${shortageModal.invoiceId}`}
                  </p>
                  <p className="text-[11px] font-bold text-slate-500 mt-1">
                    Pilih item yang kurang, lalu kirim.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => shortageModal.saving ? undefined : setShortageModal(null)}
                  disabled={shortageModal.saving}
                  className="btn-3d h-10 w-10 rounded-2xl bg-white border border-slate-200 inline-flex items-center justify-center text-slate-700 disabled:opacity-60"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-5 space-y-3 max-h-[70vh] overflow-auto">
                {shortageModal.error ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">
                    {shortageModal.error}
                  </div>
                ) : null}

                <div className="space-y-2">
                  {shortageModal.rows.map((row) => {
                    const missing = Math.max(0, Math.min(row.invoiceQty, Math.trunc(Number(row.missingQty || 0))));
                    return (
                      <div key={row.key} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-black text-slate-900 truncate">{row.name}</p>
                            <p className="text-[10px] text-slate-500">SKU {row.sku}</p>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">
                              Invoice {row.invoiceNumber || row.invoiceId}
                            </p>
                            <p className="text-[11px] text-slate-600 mt-1">
                              Qty invoice <span className="font-black">{row.invoiceQty}</span>
                            </p>
                          </div>
                          <div className="min-w-[180px] text-right space-y-1">
                            <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">Qty kurang</p>
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => setShortageModal((prev) => prev ? {
                                  ...prev,
                                  rows: prev.rows.map((r) => r.key === row.key ? { ...r, missingQty: Math.max(0, missing - 1) } : r),
                                } : prev)}
                                disabled={shortageModal.saving || missing <= 0}
                                className="btn-3d inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-white text-rose-700 disabled:opacity-50"
                                aria-label="Kurangi qty kurang"
                              >
                                <Minus size={14} />
                              </button>
                              <input
                                type="number"
                                min={0}
                                max={row.invoiceQty}
                                value={missing}
                                disabled={shortageModal.saving}
                                onChange={(e) => {
                                  const next = Math.max(0, Math.min(row.invoiceQty, Math.trunc(Number(e.target.value || 0))));
                                  setShortageModal((prev) => prev ? {
                                    ...prev,
                                    rows: prev.rows.map((r) => r.key === row.key ? { ...r, missingQty: next } : r),
                                    error: '',
                                  } : prev);
                                }}
                                className="w-16 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black text-slate-900 text-right outline-none focus:bg-white focus:border-rose-300"
                              />
                              <button
                                type="button"
                                onClick={() => setShortageModal((prev) => prev ? {
                                  ...prev,
                                  rows: prev.rows.map((r) => r.key === row.key ? { ...r, missingQty: Math.min(row.invoiceQty, missing + 1) } : r),
                                } : prev)}
                                disabled={shortageModal.saving || missing >= row.invoiceQty}
                                className="btn-3d inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-white text-rose-700 disabled:opacity-50"
                                aria-label="Tambah qty kurang"
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

              <div className="border-t border-slate-100 bg-white px-5 py-4">
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => shortageModal.saving ? undefined : setShortageModal(null)}
                    disabled={shortageModal.saving}
                    className="btn-3d rounded-xl border border-slate-200 px-4 py-2 text-[11px] font-bold text-slate-600 disabled:opacity-50"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitShortageReport()}
                    disabled={shortageModal.saving}
                    className="btn-3d rounded-xl bg-rose-600 px-4 py-2 text-[11px] font-black uppercase tracking-wider text-white disabled:opacity-50"
                  >
                    {shortageModal.saving ? 'Mengirim...' : 'Kirim Laporan'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
