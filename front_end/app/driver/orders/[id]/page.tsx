'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { ArrowLeft, ChevronRight, MapPin, Package, Phone, User, Wallet, X, Minus, Plus } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { notifyFromAlertMessage, notifyOpen, notifySuccess } from '@/lib/notify';
import type { DriverAssignedOrderRow, InvoiceDetailResponse } from '@/lib/apiTypes';

const normalizeId = (raw: unknown) => String(raw || '').trim();
const isDoneOrderStatus = (raw: unknown) => ['delivered', 'completed', 'partially_fulfilled', 'cancelled', 'canceled'].includes(String(raw || '').toLowerCase());
const getOrderInvoicePayload = (order?: DriverAssignedOrderRow | null) => {
  const latestInvoice = order?.Invoice || (Array.isArray(order?.Invoices) ? order.Invoices[0] : null) || null;
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

type ShortageDraftRow = {
  key: string;
  product_id: string | null;
  sku: string;
  name: string;
  invoiceQty: number;
  missingQty: number;
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
  const [orders, setOrders] = useState<DriverAssignedOrderRow[]>([]);
  const [invoiceDetailsById, setInvoiceDetailsById] = useState<Record<string, InvoiceDetailResponse | null | undefined>>({});

  const proofInputRef = useRef<HTMLInputElement | null>(null);
  const pendingInvoiceIdsRef = useRef<string[]>([]);
  const singleProofInputRef = useRef<HTMLInputElement | null>(null);
  const pendingSingleInvoiceIdRef = useRef<string>('');

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

  const startBatchComplete = useCallback(() => {
    const ids = Array.from(new Set(invoiceCards.map((row) => normalizeId(row.invoiceId)).filter(Boolean)));
    if (ids.length === 0) {
      notifyOpen({ variant: 'warning', title: 'Perhatian', message: 'Tidak ada invoice yang bisa diproses.' });
      return;
    }
    if (batchLoading) return;
    if (!proofInputRef.current) return;
    pendingInvoiceIdsRef.current = ids;
    proofInputRef.current.value = '';
    proofInputRef.current.click();
  }, [batchLoading, invoiceCards]);

  const handleProofSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    const ids = pendingInvoiceIdsRef.current;
    pendingInvoiceIdsRef.current = [];
    if (!file || ids.length === 0) return;

    const confirmed = window.confirm(`Selesaikan pengiriman untuk ${ids.length} invoice customer ini?`);
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
    const confirmed = window.confirm(`Catat pembayaran COD untuk ${codInvoiceIds.length} invoice (total ${totalLabel})?`);
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

  const updateInvoicePaymentMethod = useCallback(async (nextMethod: 'cod' | 'transfer_manual') => {
    const invoiceId = normalizeId(activeInvoiceId);
    if (!invoiceId) return;
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
  }, [activeInvoiceId]);

  const recordSingleCodPayment = useCallback(async () => {
    const invoiceId = normalizeId(activeInvoiceId);
    if (!invoiceId) return;
    const confirmed = window.confirm('Catat pembayaran COD untuk invoice ini?');
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

  const startSingleCompleteDelivery = useCallback(() => {
    const invoiceId = normalizeId(activeInvoiceId);
    if (!invoiceId) return;
    if (!singleProofInputRef.current) return;
    pendingSingleInvoiceIdRef.current = invoiceId;
    singleProofInputRef.current.value = '';
    singleProofInputRef.current.click();
  }, [activeInvoiceId]);

  const handleSingleProofSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    const invoiceId = normalizeId(pendingSingleInvoiceIdRef.current);
    pendingSingleInvoiceIdRef.current = '';
    if (!file || !invoiceId) return;

    try {
      setActiveInvoiceLoading(true);
      const form = new FormData();
      form.append('proof', file);
      await api.driver.completeOrder(invoiceId, form);
      notifySuccess('Pengiriman invoice selesai.');
      await load();
      clearSelectedInvoice();
    } catch (error: any) {
      notifyFromAlertMessage(String((error?.response?.data as any)?.message || error?.message || 'Gagal menyelesaikan pengiriman.'));
    } finally {
      setActiveInvoiceLoading(false);
    }
  }, [clearSelectedInvoice, load]);

  const openShortageModal = useCallback(() => {
    const invoiceId = normalizeId(activeInvoiceId);
    if (!invoiceId) return;
    const invoiceDetail = invoiceDetailsById[invoiceId] || null;
    const invoiceItems = getInvoiceItems(invoiceDetail);
    if (!invoiceItems || invoiceItems.length === 0) {
      notifyOpen({ variant: 'warning', title: 'Perhatian', message: 'Item invoice tidak tersedia untuk dipilih.' });
      return;
    }

    const buckets = new Map<string, ShortageDraftRow>();
    invoiceItems.forEach((item: any, idx: number) => {
      const orderItem = item?.OrderItem || {};
      const product = orderItem?.Product || {};
      const productId = normalizeId(orderItem?.product_id) || '';
      const sku = String(product?.sku || '').trim() || '-';
      const name = String(product?.name || 'Produk');
      const qty = Math.max(0, Math.trunc(Number(item?.qty ?? item?.allocated_qty ?? 0)));
      if (!qty) return;
      const key = productId || `${sku}:${name}:${idx}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.invoiceQty += qty;
        buckets.set(key, existing);
        return;
      }
      buckets.set(key, {
        key,
        product_id: productId || null,
        sku,
        name,
        invoiceQty: qty,
        missingQty: 0,
      });
    });

    const rows = Array.from(buckets.values()).sort((a, b) => b.invoiceQty - a.invoiceQty);
    const invoiceNumber = String((invoiceDetail as any)?.invoice_number || '').trim() || null;
    setShortageModal({
      invoiceId,
      invoiceNumber,
      rows,
      saving: false,
      error: '',
    });
  }, [activeInvoiceId, invoiceDetailsById]);

  const submitShortageReport = useCallback(async () => {
    if (!shortageModal) return;
    if (shortageModal.saving) return;
    const invoiceId = normalizeId(shortageModal.invoiceId);
    if (!invoiceId) return;

    const selected = shortageModal.rows
      .map((row) => ({ ...row, missingQty: Math.max(0, Math.min(row.invoiceQty, Math.trunc(Number(row.missingQty || 0)))) }))
      .filter((row) => row.missingQty > 0);

    if (selected.length === 0) {
      setShortageModal((prev) => prev ? { ...prev, error: 'Pilih minimal 1 item yang kurang.' } : prev);
      return;
    }

    const noteLines = selected.map((row) => {
      const skuLabel = row.sku && row.sku !== '-' ? `(${row.sku}) ` : '';
      return `- ${skuLabel}${row.name} x${row.missingQty}`;
    });
    const note = `Barang kurang:\n${noteLines.join('\n')}`;

    const shortageItemsPayload = selected.map((row) => ({
      product_id: row.product_id,
      sku: row.sku,
      name: row.name,
      missing_qty: row.missingQty,
    }));

    const checklistSnapshot = JSON.stringify({
      invoice_id: invoiceId,
      invoice_number: shortageModal.invoiceNumber,
      items: shortageModal.rows.map((row) => ({
        product_id: row.product_id,
        sku: row.sku,
        name: row.name,
        invoice_qty: row.invoiceQty,
        missing_qty: Math.max(0, Math.min(row.invoiceQty, Math.trunc(Number(row.missingQty || 0)))),
      }))
    });

    const confirmed = window.confirm(`Kirim laporan barang kurang untuk ${selected.length} item?`);
    if (!confirmed) return;

    try {
      setShortageModal((prev) => prev ? { ...prev, saving: true, error: '' } : prev);
      setActiveInvoiceLoading(true);
      await api.driver.reportIssue(invoiceId, {
        note,
        checklist_snapshot: checklistSnapshot,
        shortage_items: JSON.stringify(shortageItemsPayload),
      });
      notifySuccess('Laporan barang kurang berhasil dikirim.');
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
      <input ref={singleProofInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleSingleProofSelected} />

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push('/driver')}
          className="h-10 w-10 rounded-2xl bg-white border border-slate-200 inline-flex items-center justify-center text-slate-700"
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

      {invoiceCards.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-[24px] p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Aksi Customer</p>
              <p className="text-xs font-semibold text-slate-600 mt-1">
                Pembayaran COD dicatat <span className="font-black">sekali</span> untuk seluruh invoice COD, lalu pengiriman diselesaikan untuk semua invoice dengan 1 foto bukti.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={paymentLoading || codInvoiceIds.length === 0}
                onClick={recordCodPaymentOnce}
                className="px-3 py-2 rounded-xl bg-amber-600 text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-60"
              >
                {paymentLoading
                  ? 'COD...'
                  : `Catat COD • Rp ${Math.round(codTotalEstimate).toLocaleString('id-ID')}`}
              </button>
              <button
                type="button"
                disabled={batchLoading || invoiceCards.length === 0}
                onClick={startBatchComplete}
                className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-60"
              >
                {batchLoading ? 'Proses...' : `Selesaikan (${invoiceCards.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

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
                    className="w-full py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-[10px] font-black uppercase inline-flex items-center justify-center gap-1"
                  >
                    Detail Invoice <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {activeInvoiceId && (
        <div className="bg-white border border-slate-200 rounded-[24px] p-5 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Aksi Invoice Terpilih</p>
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
              onClick={() => {
                clearSelectedInvoice();
              }}
              className="px-3 py-2 rounded-xl text-[10px] font-black uppercase border border-slate-200 text-slate-700 bg-white hover:bg-slate-50"
            >
              Reset Pilihan
            </button>
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
                <button
                  type="button"
                  disabled={activeInvoiceLoading || !activeInvoiceMeta.canUpdatePaymentMethod}
                  onClick={() => updateInvoicePaymentMethod('cod')}
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-[10px] font-black uppercase text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60"
                >
                  COD
                </button>
                <button
                  type="button"
                  disabled={activeInvoiceLoading || !activeInvoiceMeta.canUpdatePaymentMethod}
                  onClick={() => updateInvoicePaymentMethod('transfer_manual')}
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-[10px] font-black uppercase text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60"
                >
                  Transfer
                </button>
              </div>
              {activeInvoiceMeta.paymentMethodLockReason ? (
                <p className="text-[11px] font-semibold text-slate-500">
                  Metode pembayaran dikunci: <span className="font-black">{activeInvoiceMeta.paymentMethodLockReason}</span>
                </p>
              ) : null}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pembayaran Customer</p>
              <p className="text-[11px] font-semibold text-slate-500">
                Pembayaran COD dicatat sekali untuk seluruh invoice COD customer ini melalui tombol <span className="font-black">Catat COD</span> di bagian Aksi Customer.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Bukti Foto Pengiriman</p>
              <button
                type="button"
                disabled={activeInvoiceLoading || activeInvoiceMeta.isDelivered}
                onClick={startSingleCompleteDelivery}
                className="w-full px-3 py-3 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-60"
              >
                {activeInvoiceMeta.isDelivered ? 'Pengiriman Sudah Selesai' : 'Upload Foto & Selesaikan Pengiriman'}
              </button>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Laporan Barang Kurang</p>
              <button
                type="button"
                disabled={activeInvoiceLoading}
                onClick={openShortageModal}
                className="w-full px-3 py-2 rounded-xl bg-rose-600 text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-60"
              >
                Pilih Barang Kurang
              </button>
              <p className="text-[11px] font-semibold text-slate-500">
                Pilih item yang kurang dari daftar barang invoice agar admin mudah tindak lanjut.
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
                  className="h-10 w-10 rounded-2xl bg-white border border-slate-200 inline-flex items-center justify-center text-slate-700"
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
                  className="h-10 w-10 rounded-2xl bg-white border border-slate-200 inline-flex items-center justify-center text-slate-700 disabled:opacity-60"
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
