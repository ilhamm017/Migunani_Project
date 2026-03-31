'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Camera, MessageCircle, Send, Upload, Coins, CreditCard, Undo2 } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import axios from 'axios';
import type { DriverAssignedOrderRow, InvoiceDetailResponse } from '@/lib/apiTypes';
import { notifyAlert } from '@/lib/notify';

type PaymentMethodConfirmState = {
  step: 1 | 2;
  nextMethod: 'cod' | 'transfer_manual';
  title: string;
  description: string;
};

type CodPaymentConfirmState = {
  step: 1 | 2;
};

type DeliveryReturLineRow = {
  key: string;
  orderId: string;
  orderIndex: number;
  productId: string;
  name: string;
  sku: string;
  invoiceQty: number;
  unitPrice: number;
};

const normalizeInvoiceRef = (raw: unknown) => String(raw || '').trim();
const formatCurrency = (value: unknown) =>
  `Rp ${Number(value || 0).toLocaleString('id-ID')}`;
const isOrderDoneStatus = (raw: unknown) =>
  ['delivered', 'completed', 'cancelled', 'canceled'].includes(String(raw || '').toLowerCase());
const getOrderInvoicePayload = (order?: DriverAssignedOrderRow | null) => {
  const latestInvoice = order?.Invoice || (Array.isArray(order?.Invoices) ? order.Invoices[0] : null) || null;
  return {
    id: normalizeInvoiceRef(order?.invoice_id || latestInvoice?.id),
    number: normalizeInvoiceRef(order?.invoice_number || latestInvoice?.invoice_number),
    total: Number(latestInvoice?.total || 0),
    paymentMethod: String(latestInvoice?.payment_method || order?.payment_method || '').toLowerCase(),
    paymentStatus: String(latestInvoice?.payment_status || '').toLowerCase(),
  };
};
const getInvoiceItems = (invoiceData?: InvoiceDetailResponse | null): any[] => {
  if (Array.isArray(invoiceData?.InvoiceItems)) return invoiceData.InvoiceItems as any[];
  if (Array.isArray(invoiceData?.Items)) return invoiceData.Items as any[];
  return [];
};

const getDriverInvoiceStatusLabel = (orders: DriverAssignedOrderRow[]) => {
  const statuses = orders
    .map((row) => String(row?.status || '').trim().toLowerCase())
    .filter(Boolean);

  if (statuses.length === 0) return '-';
  if (statuses.every((status) => ['completed', 'delivered', 'cancelled', 'canceled'].includes(status))) {
    return 'Selesai';
  }
  if (statuses.every((status) => status === 'partially_fulfilled')) {
    return 'Sebagian Selesai';
  }
  if (statuses.every((status) => status === 'shipped')) {
    return 'Dalam Pengiriman';
  }
  if (
    statuses.some((status) => status === 'shipped')
    && statuses.some((status) => ['delivered', 'completed', 'partially_fulfilled'].includes(status))
  ) {
    return 'Sebagian Selesai';
  }
  if (statuses.some((status) => status === 'partially_fulfilled')) {
    return 'Sebagian Selesai';
  }
  if (statuses.length === 1) return statuses[0] || '-';
  return `${statuses.length} status`;
};

export default function DriverOrderDetailPage() {
  const allowed = useRequireRoles(['driver', 'super_admin', 'admin_gudang']);
  const params = useParams();
  const router = useRouter();
  const orderId = String(params?.id || '');

  const [order, setOrder] = useState<DriverAssignedOrderRow | null>(null);
  const [groupedOrders, setGroupedOrders] = useState<DriverAssignedOrderRow[]>([]);
  const [resolvedInvoiceId, setResolvedInvoiceId] = useState('');
  const [resolvedFromOrderId, setResolvedFromOrderId] = useState('');
  const [invoiceDetail, setInvoiceDetail] = useState<InvoiceDetailResponse | null>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [deliveryProofCameraOpen, setDeliveryProofCameraOpen] = useState(false);
  const [deliveryProofCameraFacingMode, setDeliveryProofCameraFacingMode] = useState<'environment' | 'user'>('environment');
  const [deliveryProofCameraError, setDeliveryProofCameraError] = useState('');
  const [deliveryProofCameraReady, setDeliveryProofCameraReady] = useState(false);
  const deliveryProofVideoRef = useRef<HTMLVideoElement | null>(null);
  const deliveryProofStreamRef = useRef<MediaStream | null>(null);
  const [loading, setLoading] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isIssueOpen, setIsIssueOpen] = useState(false);
  const [issueNote, setIssueNote] = useState('');
  const [issuePhoto, setIssuePhoto] = useState<File | null>(null);
  const [issueSubmitted, setIssueSubmitted] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentProof, setPaymentProof] = useState<File | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'transfer_manual' | ''>('');
  const [paymentMethodLoading, setPaymentMethodLoading] = useState(false);
  const [paymentMethodMessage, setPaymentMethodMessage] = useState('');
  const [paymentMethodConfirm, setPaymentMethodConfirm] = useState<PaymentMethodConfirmState | null>(null);
  const [codPaymentConfirm, setCodPaymentConfirm] = useState<CodPaymentConfirmState | null>(null);
  const [completeMessage, setCompleteMessage] = useState('');
  const [isDeliveryReturOpen, setIsDeliveryReturOpen] = useState(false);
  const [deliveryReturDraft, setDeliveryReturDraft] = useState<Record<string, { checked: boolean; qty: string }>>({});
  const defaultRefusalReason = 'Retur saat pengiriman (tidak jadi beli)';
  const defaultDamageReason = 'Retur saat pengiriman (barang rusak)';
  const [deliveryReturType, setDeliveryReturType] = useState<'delivery_refusal' | 'delivery_damage'>('delivery_refusal');
  const [deliveryReturReason, setDeliveryReturReason] = useState(defaultRefusalReason);
  const [deliveryReturLoading, setDeliveryReturLoading] = useState(false);
  const [deliveryReturMessage, setDeliveryReturMessage] = useState('');
  const [deliveryReturStep, setDeliveryReturStep] = useState<1 | 2>(1);
  const [deliveryReturAck, setDeliveryReturAck] = useState(false);

  const loadOrder = useCallback(async () => {
    try {
      const res = await api.driver.getOrders({ status: 'shipped,delivered,completed,partially_fulfilled' });
      const rows = Array.isArray(res.data) ? res.data : [];
      const selectedByOrderId = rows.find((x) => String(x?.id || '') === orderId) || null;
      let invoiceScopedRows: DriverAssignedOrderRow[] = [];
      let resolvedInvoice = '';
      let resolvedOrder = '';

      if (selectedByOrderId) {
        resolvedOrder = String(selectedByOrderId?.id || '').trim();
        const invoiceIdFromOrder = normalizeInvoiceRef(selectedByOrderId?.invoice_id || selectedByOrderId?.Invoice?.id);
        if (invoiceIdFromOrder) {
          resolvedInvoice = invoiceIdFromOrder;
          invoiceScopedRows = rows.filter((row) =>
            normalizeInvoiceRef(row?.invoice_id || row?.Invoice?.id) === invoiceIdFromOrder
          );
        } else {
          invoiceScopedRows = [selectedByOrderId];
        }
      } else {
        const matchedByInvoice = rows.filter((row) =>
          normalizeInvoiceRef(row?.invoice_id || row?.Invoice?.id) === orderId
        );
        if (matchedByInvoice.length > 0) {
          invoiceScopedRows = matchedByInvoice;
          resolvedInvoice = orderId;
        }
      }

      const sortedScopedRows = [...invoiceScopedRows].sort((a, b) => {
        const bTs = Date.parse(String(b?.updatedAt || b?.createdAt || ''));
        const aTs = Date.parse(String(a?.updatedAt || a?.createdAt || ''));
        const bVal = Number.isFinite(bTs) ? bTs : 0;
        const aVal = Number.isFinite(aTs) ? aTs : 0;
        return bVal - aVal;
      });
      const selected =
        sortedScopedRows.find((x) => !isOrderDoneStatus(x?.status)) ||
        sortedScopedRows[0] ||
        null;
      const invoiceTotalFromRows = sortedScopedRows
        .map((row) => getOrderInvoicePayload(row).total)
        .find((value: number) => Number.isFinite(value) && value > 0);
      const fallbackInvoiceTotal = sortedScopedRows.reduce(
        (sum: number, row) => sum + Number(row?.total_amount || 0),
        0
      );
      const resolvedInvoiceTotal = Number.isFinite(invoiceTotalFromRows)
        ? Number(invoiceTotalFromRows)
        : fallbackInvoiceTotal;
      const resolvedPaymentMethod = sortedScopedRows
        .map((row) => getOrderInvoicePayload(row).paymentMethod)
        .find((method: string) => method === 'cod' || method === 'transfer_manual') || '';
      const deliverySummary = (invoiceDetail as any)?.delivery_return_summary;
      const net = Number(deliverySummary?.net_total);
      const payableTotal = deliverySummary && Number.isFinite(net) && net >= 0 ? net : resolvedInvoiceTotal;
      setOrder(selected);
      setGroupedOrders(sortedScopedRows);
      setResolvedInvoiceId(resolvedInvoice);
      setResolvedFromOrderId(resolvedOrder);
      setPaymentAmount(Number.isFinite(payableTotal) && payableTotal >= 0 ? String(payableTotal) : '');
      setPaymentMethod(resolvedPaymentMethod as 'cod' | 'transfer_manual' | '');
    } catch (error) {
      console.error('Load driver order failed:', error);
      setInvoiceDetail(null);
    }
  }, [invoiceDetail, orderId]);

  useEffect(() => {
    if (allowed && orderId) {
      void loadOrder();
    }
  }, [allowed, orderId, loadOrder]);

  useEffect(() => {
    if (!allowed || !resolvedInvoiceId) {
      setInvoiceDetail(null);
      return;
    }
    let isCancelled = false;
    void (async () => {
      try {
        const res = await api.invoices.getById(resolvedInvoiceId);
        if (isCancelled) return;
        setInvoiceDetail(res.data || null);
      } catch (error) {
        if (!isCancelled) {
          console.error('Failed to load invoice detail for driver page:', error);
          setInvoiceDetail(null);
        }
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [allowed, resolvedInvoiceId]);

  useEffect(() => {
    const net = Number((invoiceDetail as any)?.delivery_return_summary?.net_total || 0);
    const gross = Number(invoiceDetail?.total || 0);
    const newSubtotal = Number((invoiceDetail as any)?.delivery_return_summary?.new_items_subtotal ?? Number.NaN);
    const oldSubtotal = Number((invoiceDetail as any)?.delivery_return_summary?.old_items_subtotal ?? Number.NaN);
    const hasFullReturnItems = Number.isFinite(oldSubtotal) && oldSubtotal > 0.01 && Number.isFinite(newSubtotal) && newSubtotal <= 0.01;
    const returs = Array.isArray((invoiceDetail as any)?.delivery_returs) ? ((invoiceDetail as any).delivery_returs as any[]) : [];
    if (returs.length > 0 && hasFullReturnItems) {
      setPaymentAmount('0');
      return;
    }
    const next = Number.isFinite(net) && net > 0 ? net : gross;
    if (Number.isFinite(next) && next > 0) {
      setPaymentAmount(String(next));
    }
  }, [
    invoiceDetail?.id,
    invoiceDetail?.total,
    (invoiceDetail as any)?.delivery_return_summary?.net_total,
    (invoiceDetail as any)?.delivery_return_summary?.new_items_subtotal,
    (invoiceDetail as any)?.delivery_return_summary?.old_items_subtotal,
    (invoiceDetail as any)?.delivery_returs,
  ]);

  const groupedOrderIds = useMemo(
    () => groupedOrders.map((row) => String(row?.id || '').trim()).filter(Boolean),
    [groupedOrders]
  );
  const actionableOrderIds = useMemo(() => {
    const ids = groupedOrders
      .filter((row) => !isOrderDoneStatus(row?.status))
      .map((row) => String(row?.id || '').trim())
      .filter(Boolean);
    return ids.length > 0 ? ids : groupedOrderIds;
  }, [groupedOrderIds, groupedOrders]);
  const invoiceContext = useMemo(() => {
    const invoiceRows = groupedOrders.map((row) => getOrderInvoicePayload(row));
    const invoiceId = normalizeInvoiceRef(invoiceDetail?.id) || resolvedInvoiceId
      || invoiceRows.find((row) => row.id)?.id
      || normalizeInvoiceRef(order?.invoice_id || order?.Invoice?.id);
    const invoiceNumber = normalizeInvoiceRef(invoiceDetail?.invoice_number) || invoiceRows.find((row) => row.number)?.number
      || normalizeInvoiceRef(order?.invoice_number || order?.Invoice?.invoice_number);
    const invoiceTotalFromDetail = Number(invoiceDetail?.total || 0);
    const invoiceTotalFromRows = invoiceRows.find((row) => Number.isFinite(row.total) && row.total > 0)?.total;
    const invoiceTotalFallback = groupedOrders.reduce(
      (sum: number, row) => sum + Number(row?.total_amount || 0),
      0
    );
    const invoiceTotal = Number.isFinite(invoiceTotalFromDetail) && invoiceTotalFromDetail > 0
      ? invoiceTotalFromDetail
      : Number.isFinite(invoiceTotalFromRows) ? Number(invoiceTotalFromRows) : invoiceTotalFallback;
    const invoicePaymentMethod = invoiceRows.find((row) => row.paymentMethod === 'cod' || row.paymentMethod === 'transfer_manual')?.paymentMethod
      || String(invoiceDetail?.payment_method || '').toLowerCase()
      || '';
    const invoicePaymentStatus = invoiceRows.find((row) => !!row.paymentStatus)?.paymentStatus
      || String(invoiceDetail?.payment_status || '').toLowerCase()
      || '';
    const statusLabel = getDriverInvoiceStatusLabel(groupedOrders);
    return {
      invoiceId,
      invoiceNumber,
      invoiceTotal,
      invoicePaymentMethod,
      invoicePaymentStatus,
      statusLabel,
      orderCount: groupedOrderIds.length,
    };
  }, [groupedOrderIds.length, groupedOrders, invoiceDetail?.id, invoiceDetail?.invoice_number, invoiceDetail?.payment_method, invoiceDetail?.payment_status, invoiceDetail?.total, order?.Invoice?.id, order?.Invoice?.invoice_number, order?.invoice_id, order?.invoice_number, resolvedInvoiceId]);

  const stopDeliveryProofCamera = useCallback(() => {
    setDeliveryProofCameraReady(false);
    const stream = deliveryProofStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => {
        try { track.stop(); } catch { /* ignore */ }
      });
    }
    deliveryProofStreamRef.current = null;
    if (deliveryProofVideoRef.current) {
      try { (deliveryProofVideoRef.current as any).srcObject = null; } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => () => {
    stopDeliveryProofCamera();
  }, [stopDeliveryProofCamera]);

  useEffect(() => {
    if (!deliveryProofCameraOpen) {
      stopDeliveryProofCamera();
      setDeliveryProofCameraError('');
      return;
    }
    if (typeof window === 'undefined') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setDeliveryProofCameraError('Browser tidak mendukung akses kamera.');
      return;
    }

    let cancelled = false;
    setDeliveryProofCameraError('');
    setDeliveryProofCameraReady(false);

    void (async () => {
      try {
        stopDeliveryProofCamera();
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: deliveryProofCameraFacingMode },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        deliveryProofStreamRef.current = stream;
        const video = deliveryProofVideoRef.current;
        if (!video) return;
        (video as any).srcObject = stream;
        await video.play();
        if (!cancelled) setDeliveryProofCameraReady(true);
      } catch (error: any) {
        console.error('Delivery proof camera access failed:', error);
        setDeliveryProofCameraError(String(error?.message || 'Gagal mengakses kamera. Cek izin kamera di browser.'));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [deliveryProofCameraFacingMode, deliveryProofCameraOpen, stopDeliveryProofCamera]);

  const captureDeliveryProofPhoto = useCallback(async () => {
    const video = deliveryProofVideoRef.current;
    if (!video) return;
    const width = Number(video.videoWidth || 0);
    const height = Number(video.videoHeight || 0);
    if (!width || !height) {
      notifyAlert('Kamera belum siap. Tunggu sebentar lalu coba lagi.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);

    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9));
    if (!blob) {
      notifyAlert('Gagal mengambil foto.');
      return;
    }

    const timestamp = Date.now();
    const proofRef = String(invoiceContext.invoiceId || orderId || '').slice(-8).toUpperCase() || 'INV';
    const file = new File([blob], `delivery-proof-${proofRef}-${timestamp}.jpg`, { type: 'image/jpeg' });
    setProof(file);
    setDeliveryProofCameraOpen(false);
  }, [invoiceContext.invoiceId, orderId]);
  const invoiceItemRows = useMemo(() => {
    const itemMap = new Map<string, { key: string; name: string; qty: number; orderIds: Set<string> }>();
    const invoiceItems = getInvoiceItems(invoiceDetail);
    if (invoiceItems.length > 0) {
      invoiceItems.forEach((item: any) => {
        const orderItem = item?.OrderItem || {};
        const product = orderItem?.Product || {};
        const key = String(orderItem?.product_id || product?.sku || product?.name || item?.id || '').trim();
        if (!key) return;
        const entry = itemMap.get(key) || {
          key,
          name: product?.name || 'Produk',
          qty: 0,
          orderIds: new Set<string>(),
        };
        entry.qty += Number(item?.qty || item?.allocated_qty || 0);
        const currentOrderId = String(orderItem?.order_id || item?.order_id || '').trim();
        if (currentOrderId) entry.orderIds.add(currentOrderId);
        itemMap.set(key, entry);
      });
    } else {
      groupedOrders.forEach((row) => {
        const currentOrderId = String((row as any)?.real_order_id || row?.id || '').trim();
        const items = Array.isArray(row?.OrderItems) ? row.OrderItems : [];
        items.forEach((item: any) => {
          const key = String(item?.product_id || item?.Product?.sku || item?.Product?.name || item?.id || '').trim();
          if (!key) return;
          const entry = itemMap.get(key) || {
            key,
            name: item?.Product?.name || 'Produk',
            qty: 0,
            orderIds: new Set<string>(),
          };
          entry.qty += Number(item?.qty || 0);
          if (currentOrderId) entry.orderIds.add(currentOrderId);
          itemMap.set(key, entry);
        });
      });
    }
    return Array.from(itemMap.values())
      .map((entry) => ({
        ...entry,
        orderIds: Array.from(entry.orderIds),
      }))
      .sort((a, b) => b.qty - a.qty);
  }, [groupedOrders, invoiceDetail]);

  const deliveryReturLineRows = useMemo<DeliveryReturLineRow[]>(() => {
    const orderIndexById = new Map<string, number>();
    groupedOrders.forEach((row, idx) => {
      const oid = String((row as any)?.real_order_id || row?.id || '').trim();
      if (oid) orderIndexById.set(oid, idx);
    });

    const byKey = new Map<string, DeliveryReturLineRow>();
    const upsert = (row: Omit<DeliveryReturLineRow, 'invoiceQty'> & { invoiceQty: number }) => {
      const qty = Math.max(0, Math.trunc(Number(row.invoiceQty || 0)));
      if (!row.key || !row.orderId || !row.productId || qty <= 0) return;
      const prev = byKey.get(row.key);
      if (!prev) {
        byKey.set(row.key, {
          ...row,
          invoiceQty: qty,
        });
        return;
      }
      prev.invoiceQty += qty;
      byKey.set(row.key, prev);
    };

    const invoiceItems = getInvoiceItems(invoiceDetail);
    if (invoiceItems.length > 0) {
      invoiceItems.forEach((item: any) => {
        const orderItem = item?.OrderItem || {};
        const product = orderItem?.Product || item?.Product || {};
        const orderId = String(orderItem?.order_id || item?.order_id || '').trim();
        const productId = String(orderItem?.product_id || product?.id || '').trim();
        const name = String(product?.name || 'Produk');
        const sku = String(product?.sku || '').trim();
        const qty = Number(item?.qty ?? item?.allocated_qty ?? item?.invoice_qty ?? 0);
        const unitPriceRaw = item?.unit_price ?? orderItem?.price_at_purchase ?? 0;
        const unitPrice = Number.isFinite(Number(unitPriceRaw)) ? Number(unitPriceRaw) : 0;
        const orderIndex = Number(orderIndexById.get(orderId) ?? 9999);
        const key = `${orderId}:${productId}:${unitPrice}`;
        upsert({ key, orderId, orderIndex, productId, name, sku, unitPrice, invoiceQty: qty });
      });
    } else {
      groupedOrders.forEach((row, idx) => {
        const orderId = String((row as any)?.real_order_id || row?.id || '').trim();
        const items = Array.isArray(row?.OrderItems) ? row.OrderItems : [];
        items.forEach((item: any) => {
          const product = item?.Product || {};
          const productId = String(item?.product_id || product?.id || '').trim();
          const name = String(product?.name || 'Produk');
          const sku = String(product?.sku || '').trim();
          const qty = Number(item?.qty || 0);
          const unitPriceRaw = item?.price_at_purchase ?? 0;
          const unitPrice = Number.isFinite(Number(unitPriceRaw)) ? Number(unitPriceRaw) : 0;
          const orderIndex = idx;
          const key = `${orderId}:${productId}:${unitPrice}`;
          upsert({ key, orderId, orderIndex, productId, name, sku, unitPrice, invoiceQty: qty });
        });
      });
    }

    return Array.from(byKey.values()).sort((a, b) => {
      if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
      if (a.orderId !== b.orderId) return a.orderId.localeCompare(b.orderId);
      if (a.name !== b.name) return a.name.localeCompare(b.name);
      return a.unitPrice - b.unitPrice;
    });
  }, [groupedOrders, invoiceDetail]);

  const deliveryReturPriceVariantsByProductId = useMemo(() => {
    const map = new Map<string, number[]>();
    deliveryReturLineRows.forEach((row) => {
      const productId = String(row.productId || '').trim();
      if (!productId) return;
      const unitPrice = Number(row.unitPrice || 0);
      const existing = map.get(productId) || [];
      if (!existing.includes(unitPrice)) {
        existing.push(unitPrice);
        existing.sort((a, b) => a - b);
        map.set(productId, existing);
      }
    });
    return map;
  }, [deliveryReturLineRows]);

  const deliveryReturHasPriceVariants = useMemo(
    () => Array.from(deliveryReturPriceVariantsByProductId.values()).some((variants) => variants.length > 1),
    [deliveryReturPriceVariantsByProductId]
  );

  const deliveryReturOrderGroups = useMemo(() => {
    const map = new Map<string, { orderId: string; orderIndex: number; lines: DeliveryReturLineRow[] }>();
    deliveryReturLineRows.forEach((row) => {
      const orderId = String(row.orderId || '').trim();
      if (!orderId) return;
      const prev = map.get(orderId) || { orderId, orderIndex: row.orderIndex, lines: [] as DeliveryReturLineRow[] };
      prev.orderIndex = Math.min(prev.orderIndex ?? row.orderIndex, row.orderIndex);
      prev.lines.push(row);
      map.set(orderId, prev);
    });
    return Array.from(map.values())
      .sort((a, b) => (a.orderIndex !== b.orderIndex ? a.orderIndex - b.orderIndex : a.orderId.localeCompare(b.orderId)))
      .map((g) => ({
        ...g,
        lines: [...g.lines].sort((a, b) => {
          if (a.name !== b.name) return a.name.localeCompare(b.name);
          if (a.sku !== b.sku) return a.sku.localeCompare(b.sku);
          return a.unitPrice - b.unitPrice;
        }),
      }));
  }, [deliveryReturLineRows]);
  const deliveryReturnSummary = (invoiceDetail as any)?.delivery_return_summary || null;
  const deliveryNetTotal = Number(deliveryReturnSummary?.net_total || 0);
  const deliveryReturnTotal = Number(deliveryReturnSummary?.return_total || 0);
  const deliveryOldItemsSubtotal = Number(deliveryReturnSummary?.old_items_subtotal ?? Number.NaN);
  const deliveryNewItemsSubtotal = Number(deliveryReturnSummary?.new_items_subtotal ?? Number.NaN);
  const existingDeliveryReturs = Array.isArray((invoiceDetail as any)?.delivery_returs) ? ((invoiceDetail as any).delivery_returs as any[]) : [];
  const hasExistingDeliveryRetur = existingDeliveryReturs.length > 0;
  const handoverReadyReturs = existingDeliveryReturs.filter((r: any) => String(r?.status || '') === 'picked_up');
  const payableInvoiceTotal = useMemo(() => {
    const hasDeliveryNet = Boolean(deliveryReturnSummary && (deliveryReturnTotal > 0 || hasExistingDeliveryRetur));
    if (hasDeliveryNet && Number.isFinite(deliveryNetTotal) && deliveryNetTotal >= 0) return deliveryNetTotal;
    const gross = Number(invoiceContext.invoiceTotal || 0);
    return Number.isFinite(gross) && gross >= 0 ? gross : 0;
  }, [deliveryNetTotal, deliveryReturnSummary, deliveryReturnTotal, hasExistingDeliveryRetur, invoiceContext.invoiceTotal]);
  const invoiceDisplayLabel = useMemo(() => {
    if (invoiceContext.invoiceNumber) return invoiceContext.invoiceNumber;
    if (invoiceContext.invoiceId) return `INV-${invoiceContext.invoiceId.slice(-8).toUpperCase()}`;
    if (resolvedFromOrderId) return `ORD-${resolvedFromOrderId.slice(-8).toUpperCase()}`;
    return `ORD-${orderId.slice(-8).toUpperCase()}`;
  }, [invoiceContext.invoiceId, invoiceContext.invoiceNumber, orderId, resolvedFromOrderId]);

  if (!allowed) return null;

  const activePaymentMethod = paymentMethod || invoiceContext.invoicePaymentMethod;
  const isCod = activePaymentMethod === 'cod';
  const paymentRecorded = isCod && ['cod_pending', 'paid'].includes(String(invoiceContext.invoicePaymentStatus || ''));
  const isAllItemsReturned = hasExistingDeliveryRetur
    && Number.isFinite(deliveryOldItemsSubtotal)
    && deliveryOldItemsSubtotal > 0.01
    && Number.isFinite(deliveryNewItemsSubtotal)
    && deliveryNewItemsSubtotal <= 0.01;
  const isFullReturnNoCash = isAllItemsReturned
    && hasExistingDeliveryRetur
    && (
      (Number.isFinite(deliveryNewItemsSubtotal) && deliveryNewItemsSubtotal <= 0.01)
      || payableInvoiceTotal <= 0.01
    );
  const returLocked = ['paid', 'cod_pending'].includes(String(invoiceContext.invoicePaymentStatus || ''));
  const paymentAmountValue = paymentAmount.trim() ? Number(paymentAmount) : undefined;
  const paymentAmountValid = paymentAmountValue === undefined || Number.isFinite(paymentAmountValue);
  const paymentMethodLocked = ['paid', 'cod_pending'].includes(String(invoiceContext.invoicePaymentStatus || ''));
  const missingProof = !proof;
  const missingCodPaymentRecord = isCod && !paymentRecorded && !isFullReturnNoCash;
  const hasReturToHandover = hasExistingDeliveryRetur && handoverReadyReturs.length > 0;
  const codStatusTitle = isFullReturnNoCash
    ? 'Retur penuh: tidak ada transaksi uang.'
    : paymentRecorded
      ? 'Status COD sudah tercatat untuk invoice ini.'
      : 'Konfirmasi COD jika invoice masih belum tercatat.';
  const codStatusHint = isFullReturnNoCash
    ? 'Customer mengembalikan semua barang, jadi tidak ada transaksi uang. Langkah selanjutnya: serahkan barang retur ke Admin/Kasir.'
    : paymentRecorded
      ? 'Invoice COD normal bisa sudah berstatus pending sejak invoice diterbitkan. Driver bisa lanjut upload bukti kirim.'
      : 'Jika invoice COD ini masih belum tercatat, driver dapat konfirmasi penerimaan uang customer di sini.';
  const codProofHint = isFullReturnNoCash
    ? 'Bukti COD dinonaktifkan karena tidak ada transaksi uang.'
    : paymentRecorded
      ? 'Upload bukti COD bersifat opsional untuk dokumentasi tambahan.'
      : 'Jika masih diperlukan, upload bukti COD akan mencoba mencatat pembayaran otomatis.';
  const codActionLabel = isFullReturnNoCash
    ? 'Tidak Perlu Konfirmasi Uang'
    : paymentRecorded
      ? 'COD Sudah Tercatat'
      : 'Konfirmasi Penerimaan COD';
  const codCompletionHint = isFullReturnNoCash
    ? 'Retur penuh: tidak ada transaksi uang. Pastikan retur sudah diajukan lalu serahkan barang ke Admin/Kasir.'
    : paymentRecorded
      ? 'Status COD invoice ini sudah tercatat. Lanjutkan konfirmasi selesai setelah bukti foto pengiriman lengkap.'
      : 'Invoice COD ini masih belum tercatat. Konfirmasi penerimaan COD terlebih dahulu sebelum selesai.';
  const codBlockingHint = (paymentRecorded || isFullReturnNoCash)
    ? ''
    : 'Pembayaran COD belum tercatat. Upload bukti COD atau klik Konfirmasi Penerimaan COD.';
  const codBadgeLabel = isFullReturnNoCash ? 'Tidak Perlu' : paymentRecorded ? 'Sudah Dicatat' : 'Belum Dicatat';
  const codBadgeClass = isFullReturnNoCash
    ? 'bg-slate-100 text-slate-700 border border-slate-200'
    : paymentRecorded
      ? 'bg-emerald-100 text-emerald-700'
      : 'bg-white text-amber-700 border border-amber-200';
  const fallbackActionOrderId = String(resolvedFromOrderId || groupedOrderIds[0] || order?.id || orderId).trim();
  const getActionTargetIds = () => {
    if (actionableOrderIds.length > 0) return actionableOrderIds;
    return fallbackActionOrderId ? [fallbackActionOrderId] : [];
  };

  const complete = async () => {
    try {
      setLoading(true);
      setCompleteMessage('');
      const targetIds = getActionTargetIds();
      if (targetIds.length === 0) {
        setCompleteMessage('Order invoice belum ditemukan.');
        return;
      }
      const results = await Promise.allSettled(
        targetIds.map((id) => {
          const form = new FormData();
          if (proof) form.append('proof', proof);
          return api.driver.completeOrder(id, form);
        })
      );
      const failedIds = results
        .map((result, idx) => (result.status === 'rejected' ? String(targetIds[idx]) : ''))
        .filter(Boolean);
      if (failedIds.length > 0) {
        setCompleteMessage(`Sebagian order gagal diselesaikan (${failedIds.length}/${targetIds.length}).`);
      } else {
        setCompleteMessage(`Pengiriman selesai untuk ${targetIds.length} order.`);
      }
      setIsConfirmOpen(false);
      router.push('/driver');
    } catch (error) {
      console.error('Complete delivery failed:', error);
      setCompleteMessage('Gagal konfirmasi pengiriman.');
    } finally {
      setLoading(false);
    }
  };

  const recordPayment = async (options?: { skipConfirm?: boolean; proofOverride?: File | null }) => {
    if (!isCod) return;
    if (isFullReturnNoCash) {
      setPaymentMessage('Customer retur semua barang, tidak ada transaksi uang. Langkah selanjutnya: serahkan barang retur ke Admin/Kasir.');
      setCodPaymentConfirm(null);
      return;
    }
    if (paymentRecorded) {
      setPaymentMessage('Status COD untuk invoice ini sudah tercatat. Lanjutkan proses selesai pengiriman.');
      setCodPaymentConfirm(null);
      return;
    }
    if (!paymentAmountValid) {
      setPaymentMessage('Nominal pembayaran tidak valid.');
      return;
    }
    if (!options?.skipConfirm) {
      setCodPaymentConfirm({ step: 1 });
      return;
    }
    try {
      setPaymentLoading(true);
      setPaymentMessage('');
      const proofFile = options?.proofOverride ?? paymentProof;
      const targetIds = getActionTargetIds();
      if (targetIds.length === 0) {
        setPaymentMessage('Order invoice belum ditemukan.');
        return;
      }
      const results = await Promise.allSettled(
        targetIds.map((id) => api.driver.recordPayment(id, {
          amount_received: paymentAmountValue,
          proof: proofFile
        }))
      );
      const failedIds = results
        .map((result, idx) => (result.status === 'rejected' ? String(targetIds[idx]) : ''))
        .filter(Boolean);
      if (failedIds.length > 0) {
        setPaymentMessage(`Sebagian pembayaran gagal dicatat (${failedIds.length}/${targetIds.length}).`);
      } else {
        setPaymentMessage(`Pembayaran berhasil dicatat untuk ${targetIds.length} order.`);
      }
      const invoiceIdToRefresh = String(resolvedInvoiceId || invoiceContext.invoiceId || '').trim();
      if (invoiceIdToRefresh) {
        try {
          const invoiceRes = await api.invoices.getById(invoiceIdToRefresh);
          setInvoiceDetail(invoiceRes.data || null);
        } catch (refreshError) {
          console.error('Refresh invoice detail after COD record failed:', refreshError);
        }
      }
      setPaymentProof(null);
      setCodPaymentConfirm(null);
      await loadOrder();
    } catch (error) {
      console.error('Record payment failed:', error);
      setPaymentMessage('Gagal mencatat pembayaran.');
    } finally {
      setPaymentLoading(false);
    }
  };

  const validateDeliveryReturDraft = () => {
    const selected = deliveryReturLineRows
      .map((row) => {
        const draft = deliveryReturDraft[row.key];
        const checked = Boolean(draft?.checked);
        const qty = Math.max(0, Math.trunc(Number(draft?.qty || 0)));
        return { row, checked, qty };
      })
      .filter((x) => x.checked);

    if (selected.length === 0) return 'Checklist minimal 1 SKU yang diretur.';

    for (const { row, qty } of selected) {
      if (!Number.isFinite(qty) || qty <= 0) {
        return `Isi qty retur untuk ${row.name}.`;
      }
      if (qty > Number(row.invoiceQty || 0)) {
        return `Qty retur melebihi qty invoice untuk ${row.name}.`;
      }
    }

    return null;
  };

  const submitDeliveryRetur = async () => {
    if (returLocked) {
      setDeliveryReturMessage('Invoice sudah tercatat (paid/cod_pending). Retur delivery dikunci.');
      return;
    }
    if (hasExistingDeliveryRetur) {
      setDeliveryReturMessage('Retur delivery untuk invoice ini sudah diajukan dan tidak bisa diubah.');
      return;
    }
    const validationError = validateDeliveryReturDraft();
    if (validationError) {
      setDeliveryReturMessage(validationError);
      return;
    }
    const payloadItems = deliveryReturLineRows
      .map((row) => {
        const draft = deliveryReturDraft[row.key];
        if (!draft?.checked) return null;
        const qty = Math.max(0, Math.trunc(Number(draft?.qty || 0)));
        if (!Number.isFinite(qty) || qty <= 0) return null;
        return {
          product_id: row.productId,
          order_id: row.orderId,
          qty,
          ...(deliveryReturReason.trim() ? { reason: deliveryReturReason.trim() } : {})
        };
      })
      .filter(Boolean) as Array<{ product_id: string; qty: number; order_id: string; reason?: string }>;

    if (payloadItems.length === 0) {
      setDeliveryReturMessage('Checklist minimal 1 SKU yang diretur dan isi qty-nya.');
      return;
    }

    try {
      setDeliveryReturLoading(true);
      setDeliveryReturMessage('');
      await api.driver.createDeliveryReturTicket(orderId, { retur_type: deliveryReturType, items: payloadItems });

      const invoiceIdToRefresh = String(resolvedInvoiceId || invoiceContext.invoiceId || '').trim();
      if (invoiceIdToRefresh) {
        try {
          const invoiceRes = await api.invoices.getById(invoiceIdToRefresh);
          setInvoiceDetail(invoiceRes.data || null);
        } catch (refreshError) {
          console.error('Refresh invoice detail after retur delivery failed:', refreshError);
        }
      }

      await loadOrder();
      setIsDeliveryReturOpen(false);
      setDeliveryReturDraft({});
      setDeliveryReturType('delivery_refusal');
      setDeliveryReturReason(defaultRefusalReason);
      setDeliveryReturStep(1);
      setDeliveryReturAck(false);
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? String(error.response?.data?.message || error.message || 'Gagal mengajukan retur')
        : 'Gagal mengajukan retur';
      setDeliveryReturMessage(message);
    } finally {
      setDeliveryReturLoading(false);
    }
  };

  const handleConfirmCodPayment = async () => {
    if (!codPaymentConfirm) return;
    if (codPaymentConfirm.step === 1) {
      setCodPaymentConfirm({ step: 2 });
      return;
    }
    await recordPayment({ skipConfirm: true });
  };

  const handlePaymentProofChange = (file: File | null) => {
    setPaymentProof(file);
    if (!file) return;
    if (!isCod) return;
    if (isFullReturnNoCash) {
      setPaymentMessage('Customer retur semua barang, tidak ada transaksi uang. Bukti COD tidak diperlukan. Serahkan barang retur ke Admin/Kasir.');
      setPaymentProof(null);
      return;
    }
    if (paymentRecorded) {
      setPaymentMessage('Bukti COD tersimpan sebagai dokumentasi. Status COD invoice ini sudah tercatat.');
      return;
    }
    setPaymentMessage('Bukti COD diterima. Lanjutkan Konfirmasi Penerimaan COD untuk mencatat pembayaran.');
  };

  const handlePaymentMethodChange = async (nextMethod: 'cod' | 'transfer_manual') => {
    if (isFullReturnNoCash) {
      setPaymentMethodMessage('Retur semua barang: transaksi dengan customer selesai (ongkir hangus). Tidak perlu memilih metode pembayaran. Serahkan barang retur ke Admin/Kasir.');
      return;
    }
    if (paymentMethodLocked || paymentMethodLoading || nextMethod === activePaymentMethod) return;
    setPaymentMethodConfirm({
      step: 1,
      nextMethod,
      title: nextMethod === 'cod' ? 'Konfirmasi metode COD' : 'Konfirmasi metode transfer',
      description: nextMethod === 'cod'
        ? 'Driver akan membawa uang dari customer untuk kemudian disetorkan ke admin finance.'
        : 'Pembayaran akan dialihkan ke transfer manual dan diverifikasi admin finance.',
    });
  };

  const handleConfirmPaymentMethod = async () => {
    if (!paymentMethodConfirm) return;
    if (paymentMethodConfirm.step === 1) {
      setPaymentMethodConfirm((prev) => (prev ? { ...prev, step: 2 } : prev));
      return;
    }
    const nextMethod = paymentMethodConfirm.nextMethod;
    try {
      setPaymentMethodLoading(true);
      setPaymentMethodMessage('');
      const targetIds = getActionTargetIds();
      const targetId = targetIds[0] || '';
      if (!targetId) {
        setPaymentMethodMessage('Order invoice belum ditemukan.');
        return;
      }
      await api.driver.updatePaymentMethod(targetId, nextMethod);
      setPaymentMethod(nextMethod);
      setPaymentMethodMessage(`Metode pembayaran invoice diperbarui untuk ${targetIds.length} order.`);
      await loadOrder();
      setPaymentMethodConfirm(null);
    } catch (error: unknown) {
      console.error('Update payment method failed:', error);
      const message = axios.isAxiosError(error)
        ? String((error.response?.data as any)?.message || error.message || 'Gagal memperbarui metode pembayaran.')
        : 'Gagal memperbarui metode pembayaran.';
      setPaymentMethodMessage(message);
    } finally {
      setPaymentMethodLoading(false);
    }
  };

  const submitIssue = async () => {
    const note = issueNote.trim();
    if (note.length < 5) {
      notifyAlert('Catatan laporan minimal 5 karakter.');
      return;
    }

    try {
      setLoading(true);
      const targetIds = getActionTargetIds();
      if (targetIds.length === 0) {
        notifyAlert('Order invoice belum ditemukan.');
        return;
      }
      const results = await Promise.allSettled(
        targetIds.map((id) => api.driver.reportIssue(id, {
          note,
          evidence: issuePhoto,
        }))
      );
      const failedIds = results
        .map((result, idx) => (result.status === 'rejected' ? String(targetIds[idx]) : ''))
        .filter(Boolean);
      const successCount = targetIds.length - failedIds.length;

      if (successCount === 0) {
        notifyAlert('Semua laporan gagal dikirim. Periksa koneksi lalu coba lagi.');
        return;
      }

      if (failedIds.length > 0) {
        setIsIssueOpen(false);
        notifyAlert(`Sebagian laporan berhasil (${successCount}/${targetIds.length}). ${failedIds.length} order gagal diproses.`);
        return;
      }

      setIsIssueOpen(false);
      setIssueSubmitted(true);
      setTimeout(() => router.push('/driver'), 1300);
    } catch (error) {
      console.error('Report issue failed:', error);
      notifyAlert('Gagal melaporkan masalah.');
    } finally {
      setLoading(false);
    }
  };

  const canComplete = !!proof
    && !loading
    && (!isCod || paymentRecorded || isFullReturnNoCash);
  const customer = order?.Customer || {};

  return (
    <div className="p-6 space-y-5">
      {isDeliveryReturOpen && (
        <div className="fixed inset-0 z-[99999] flex items-start justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white w-full max-w-lg rounded-[28px] p-5 shadow-2xl space-y-4 max-h-[calc(100svh-2rem)] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-600">
                  Retur Saat Pengiriman
                </p>
                <h3 className="mt-2 text-lg font-black text-slate-900">Ajukan retur saat pengiriman</h3>
                <p className="mt-2 text-sm text-slate-600">
                  Isi qty barang yang diretur. Setelah disimpan, nominal COD akan mengikuti total setelah retur.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (deliveryReturLoading) return;
                  setIsDeliveryReturOpen(false);
                }}
                className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black uppercase text-slate-700"
              >
                Tutup
              </button>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[11px] text-slate-700">
              Step <span className="font-black">{deliveryReturStep}</span> / 2
              {deliveryReturStep === 2 && (
                <span className="ml-2 text-rose-700 font-black">FINAL</span>
              )}
            </div>

            {deliveryReturStep === 1 ? (
              <>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Jenis Retur</label>
                  <select
                    value={deliveryReturType}
                    onChange={(e) => {
                      const next = e.target.value === 'delivery_damage' ? 'delivery_damage' : 'delivery_refusal';
                      setDeliveryReturType(next);
                      setDeliveryReturReason((prev) => {
                        const prevTrim = String(prev || '').trim();
                        const isDefault = prevTrim === defaultRefusalReason || prevTrim === defaultDamageReason;
                        if (!isDefault) return prev;
                        return next === 'delivery_damage' ? defaultDamageReason : defaultRefusalReason;
                      });
                    }}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-800 bg-white"
                  >
                    <option value="delivery_refusal">Customer tidak jadi beli</option>
                    <option value="delivery_damage">Barang rusak (keluhan customer)</option>
                  </select>
                  {deliveryReturType === 'delivery_damage' && (
                    <p className="text-[10px] text-amber-700 font-bold">
                      Retur barang rusak akan membuat kewajiban driver (debt) untuk mengganti nilai potongan retur.
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Alasan</label>
                  <input
                    value={deliveryReturReason}
                    onChange={(e) => setDeliveryReturReason(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-800"
                    placeholder="Contoh: Customer tidak jadi beli"
                  />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Pilih SKU yang diretur</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDeliveryReturDraft((prev) => {
                          const next: Record<string, { checked: boolean; qty: string }> = { ...prev };
                          deliveryReturLineRows.forEach((row) => {
                            const current = next[row.key] || { checked: false, qty: '0' };
                            const currentQty = Math.max(0, Math.trunc(Number(current.qty || 0)));
                            const maxQty = Math.max(1, Math.trunc(Number(row.invoiceQty || 0)));
                            next[row.key] = {
                              checked: true,
                              qty: String(Math.min(maxQty, currentQty > 0 ? currentQty : 1)),
                            };
                          });
                          return next;
                        });
                      }}
                      disabled={deliveryReturLoading || deliveryReturLineRows.length === 0}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-700 disabled:opacity-60"
                    >
                      Checklist all
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeliveryReturDraft((prev) => {
                          const next: Record<string, { checked: boolean; qty: string }> = { ...prev };
                          deliveryReturLineRows.forEach((row) => {
                            next[row.key] = { checked: false, qty: '0' };
                          });
                          return next;
                        });
                      }}
                      disabled={deliveryReturLoading || deliveryReturLineRows.length === 0}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase text-slate-700 disabled:opacity-60"
                    >
                      Uncheck all
                    </button>
                  </div>
                </div>

                {deliveryReturHasPriceVariants && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] text-amber-800">
                    Ada SKU dengan <span className="font-black">harga berbeda</span> di order lain. Gunakan badge <span className="font-black">Harga A/B</span> agar tidak salah pilih saat retur.
                  </div>
                )}

                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 space-y-3">
                  {deliveryReturOrderGroups.map((group) => (
                    <div key={group.orderId} className="rounded-2xl border border-slate-200 bg-white p-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Order ID</p>
                          <p className="text-xs font-black text-slate-900 break-all">{group.orderId}</p>
                        </div>
                        <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-black text-slate-700">
                          {group.lines.length} SKU
                        </span>
                      </div>

                      <div className="space-y-2">
                        {group.lines.map((line) => {
                          const draft = deliveryReturDraft[line.key] || { checked: false, qty: '0' };
                          const variants = deliveryReturPriceVariantsByProductId.get(line.productId) || [];
                          const hasVariant = variants.length > 1;
                          const variantIdx = variants.findIndex((v) => v === line.unitPrice);
                          const variantLabel = variantIdx >= 0 ? String.fromCharCode(65 + variantIdx) : '?';
                          const maxQty = Math.max(1, Math.trunc(Number(line.invoiceQty || 0)));

                          return (
                            <div
                              key={line.key}
                              className={`rounded-xl border px-3 py-2 flex items-start justify-between gap-3 ${draft.checked ? 'border-rose-200 bg-rose-50/40' : 'border-slate-200 bg-slate-50'}`}
                            >
                              <label className="flex items-start gap-3 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={draft.checked}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setDeliveryReturDraft((prev) => {
                                      const current = prev[line.key] || { checked: false, qty: '0' };
                                      const currentQty = Math.max(0, Math.trunc(Number(current.qty || 0)));
                                      const nextQty = checked
                                        ? String(Math.min(maxQty, currentQty > 0 ? currentQty : 1))
                                        : '0';
                                      return {
                                        ...prev,
                                        [line.key]: { checked, qty: nextQty },
                                      };
                                    });
                                  }}
                                  className="mt-1"
                                />
                                <div className="min-w-0">
                                  <p className="text-xs font-black text-slate-900 truncate">{line.name}</p>
                                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-bold text-slate-600">
                                    {line.sku && (
                                      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-slate-700">
                                        {line.sku}
                                      </span>
                                    )}
                                    {hasVariant && (
                                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-black text-amber-800">
                                        Harga {variantLabel}
                                      </span>
                                    )}
                                    <span className="text-slate-700">@ {formatCurrency(line.unitPrice)}</span>
                                    <span>
                                      Qty invoice: <span className="font-black text-slate-800">{line.invoiceQty}</span>
                                    </span>
                                  </div>
                                </div>
                              </label>

                              <div className="text-right shrink-0">
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Qty Retur</label>
                                <input
                                  type="number"
                                  min="1"
                                  max={maxQty}
                                  value={draft.qty}
                                  disabled={!draft.checked}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    const parsed = Math.trunc(Number(raw));
                                    const nextQty = raw === ''
                                      ? ''
                                      : String(Math.min(maxQty, Math.max(1, Number.isFinite(parsed) ? parsed : 1)));
                                    setDeliveryReturDraft((prev) => ({
                                      ...prev,
                                      [line.key]: { checked: true, qty: nextQty }
                                    }));
                                  }}
                                  className="mt-1 w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm font-black text-slate-800 disabled:opacity-50"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {deliveryReturOrderGroups.length === 0 && (
                    <p className="text-xs font-semibold text-slate-500">Tidak ada item pada invoice ini.</p>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[11px] text-rose-800 space-y-1">
                  <p className="font-black uppercase tracking-widest text-[10px] text-rose-700">Verifikasi Retur (Final)</p>
                  <p>Retur delivery hanya bisa diinput <span className="font-black">1 kali</span> dan <span className="font-black">tidak bisa diubah</span>.</p>
                  <p>
                    Jenis: <span className="font-black">{deliveryReturType === 'delivery_damage' ? 'Barang rusak (driver mengganti)' : 'Customer tidak jadi beli'}</span>
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 space-y-2">
                  {deliveryReturLineRows
                    .map((row) => {
                      const draft = deliveryReturDraft[row.key];
                      if (!draft?.checked) return null;
                      const qty = Math.max(0, Math.trunc(Number(draft?.qty || 0)));
                      if (!Number.isFinite(qty) || qty <= 0) return null;
                      const variants = deliveryReturPriceVariantsByProductId.get(row.productId) || [];
                      const hasVariant = variants.length > 1;
                      const variantIdx = variants.findIndex((v) => v === row.unitPrice);
                      const variantLabel = variantIdx >= 0 ? String.fromCharCode(65 + variantIdx) : '?';
                      return (
                        <div key={row.key} className="rounded-xl border border-slate-200 bg-white px-3 py-2 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-black text-slate-900 truncate">{row.name}</p>
                            <p className="text-[10px] text-slate-500 break-all">Order: {row.orderId}</p>
                            <p className="text-[10px] text-slate-500">
                              {row.sku ? `SKU: ${row.sku} · ` : ''}
                              @ {formatCurrency(row.unitPrice)}
                              {hasVariant ? ` · Harga ${variantLabel}` : ''}
                            </p>
                          </div>
                          <span className="text-xs font-black text-rose-700">Qty {qty}</span>
                        </div>
                      );
                    })
                    .filter(Boolean)}
                  {deliveryReturLineRows.every((row) => !deliveryReturDraft[row.key]?.checked) && (
                    <p className="text-xs font-semibold text-slate-500">Belum ada SKU retur yang dipilih.</p>
                  )}
                </div>

                <label className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-700">
                  <input
                    type="checkbox"
                    checked={deliveryReturAck}
                    onChange={(e) => setDeliveryReturAck(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>Saya sudah cek ulang item dan qty retur di atas dan yakin data ini benar.</span>
                </label>
              </>
            )}

            {deliveryReturMessage && (
              <p className="text-xs font-bold text-rose-700">{deliveryReturMessage}</p>
            )}

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  if (deliveryReturLoading) return;
                  if (deliveryReturStep === 2) {
                    setDeliveryReturStep(1);
                    setDeliveryReturAck(false);
                    setDeliveryReturMessage('');
                    return;
                  }
                  setIsDeliveryReturOpen(false);
                }}
                disabled={deliveryReturLoading}
                className="py-3 rounded-xl border border-slate-300 text-xs font-black uppercase text-slate-700"
              >
                {deliveryReturStep === 2 ? 'Kembali' : 'Batal'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (deliveryReturStep === 1) {
                    const err = validateDeliveryReturDraft();
                    if (err) {
                      setDeliveryReturMessage(err);
                      return;
                    }
                    setDeliveryReturStep(2);
                    setDeliveryReturAck(false);
                    setDeliveryReturMessage('');
                    return;
                  }
                  if (!deliveryReturAck) {
                    setDeliveryReturMessage('Centang konfirmasi cek ulang sebelum ajukan retur.');
                    return;
                  }
                  void submitDeliveryRetur();
                }}
                disabled={deliveryReturLoading || invoiceItemRows.length === 0 || deliveryReturLineRows.length === 0 || hasExistingDeliveryRetur}
                className="py-3 rounded-xl bg-rose-600 text-white text-xs font-black uppercase disabled:opacity-60"
              >
                {deliveryReturLoading
                  ? 'Memproses...'
                  : deliveryReturStep === 1
                    ? 'Lanjut Verifikasi'
                    : 'Ya, Ajukan Retur'}
              </button>
            </div>
          </div>
        </div>
      )}
      {paymentMethodConfirm && (
        <div className="fixed inset-0 z-[99999] flex items-start justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white w-full max-w-md rounded-[28px] p-5 shadow-2xl space-y-4 max-h-[calc(100svh-2rem)] overflow-y-auto">
            <div>
              <p className={`text-[10px] font-black uppercase tracking-[0.2em] ${paymentMethodConfirm.nextMethod === 'cod' ? 'text-emerald-600' : 'text-blue-600'}`}>
                Verifikasi Metode Pembayaran
              </p>
              <h3 className="mt-2 text-lg font-black text-slate-900">
                {paymentMethodConfirm.step === 1 ? paymentMethodConfirm.title : 'Konfirmasi akhir perubahan metode bayar'}
              </h3>
              <p className="mt-2 text-sm text-slate-600">{paymentMethodConfirm.description}</p>
            </div>

            <div className={`rounded-2xl border px-4 py-3 text-[11px] ${paymentMethodConfirm.nextMethod === 'cod' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-blue-200 bg-blue-50 text-blue-800'}`}>
              {paymentMethodConfirm.nextMethod === 'cod'
                ? 'Jika COD dipilih, driver akan menerima uang dari customer dan dana itu masuk ke alur setoran ke admin finance.'
                : 'Jika transfer dipilih, customer akan membayar lewat transfer manual dan bukti transfer diverifikasi admin finance.'}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  if (paymentMethodLoading) return;
                  setPaymentMethodConfirm(null);
                }}
                disabled={paymentMethodLoading}
                className="py-3 rounded-xl border border-slate-300 text-xs font-black uppercase text-slate-700"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmPaymentMethod()}
                disabled={paymentMethodLoading}
                className={`py-3 rounded-xl text-white text-xs font-black uppercase disabled:opacity-60 ${paymentMethodConfirm.nextMethod === 'cod' ? 'bg-emerald-600' : 'bg-blue-600'}`}
              >
                {paymentMethodLoading
                  ? 'Memproses...'
                  : paymentMethodConfirm.step === 1
                    ? 'Lanjut Verifikasi'
                    : paymentMethodConfirm.nextMethod === 'cod'
                      ? 'Ya, Gunakan COD'
                      : 'Ya, Gunakan Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}
      {codPaymentConfirm && (
        <div className="fixed inset-0 z-[99999] flex items-start justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white w-full max-w-md rounded-[28px] p-5 shadow-2xl space-y-4 max-h-[calc(100svh-2rem)] overflow-y-auto">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-600">
                Verifikasi Penerimaan COD
              </p>
              <h3 className="mt-2 text-lg font-black text-slate-900">
                {codPaymentConfirm.step === 1 ? 'Periksa penerimaan uang customer' : 'Konfirmasi catat penerimaan COD'}
              </h3>
              <p className="mt-2 text-sm text-slate-600">
                Pastikan uang dari customer sudah diterima sesuai total invoice sebelum dicatat ke sistem.
              </p>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] text-amber-800 space-y-1">
              <p>
                Total ditagih: <span className="font-black">{formatCurrency(payableInvoiceTotal)}</span>
              </p>
              <p>
                Nominal dicatat: <span className="font-black">{formatCurrency(paymentAmountValue)}</span>
              </p>
              <p>
                Order terkait: <span className="font-black">{getActionTargetIds().length}</span>
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  if (paymentLoading) return;
                  setCodPaymentConfirm(null);
                }}
                disabled={paymentLoading}
                className="py-3 rounded-xl border border-slate-300 text-xs font-black uppercase text-slate-700"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmCodPayment()}
                disabled={paymentLoading}
                className="py-3 rounded-xl bg-amber-600 text-white text-xs font-black uppercase disabled:opacity-60"
              >
                {paymentLoading
                  ? 'Memproses...'
                  : codPaymentConfirm.step === 1
                    ? 'Lanjut Verifikasi'
                    : 'Ya, Catat COD'}
              </button>
            </div>
          </div>
        </div>
      )}
      <button data-no-3d="true" onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
        <ArrowLeft size={16} /> Kembali
      </button>

      <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm space-y-6">
        <div>
          <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1">Tugas Pengiriman Invoice</p>
          <h1 className="text-2xl font-black text-slate-900 leading-none">Invoice {invoiceDisplayLabel}</h1>
          <p className="text-xs text-slate-500 mt-2">
            {invoiceContext.orderCount} order digabung untuk 1 pengiriman
            {groupedOrderIds.length > 0 ? ` (${groupedOrderIds.map((id) => `#${id.slice(-6)}`).join(', ')})` : ''}.
          </p>
        </div>

        {issueSubmitted && (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
            <p className="text-sm font-black text-blue-700">Laporan terkirim ke gudang.</p>
            <p className="text-xs text-blue-700 mt-1">Menunggu follow-up gudang. Anda akan diarahkan kembali ke daftar tugas.</p>
          </div>
        )}

        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500 font-bold uppercase">Status</span>
            <span className="text-xs font-black text-slate-900 uppercase bg-white px-2 py-1 rounded-lg border border-slate-200">
              {invoiceContext.statusLabel}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500 font-bold uppercase">Customer</span>
            <span className="text-xs font-black text-slate-900 uppercase">
              {String((order as any)?.customer_name || customer?.name || '-')}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500 font-bold uppercase">Invoice ID</span>
            <span className="text-xs font-black text-slate-900 uppercase">
              {invoiceContext.invoiceId || '-'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500 font-bold uppercase">Metode</span>
            <span className="text-xs font-black text-slate-900 uppercase">
              {activePaymentMethod || '-'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500 font-bold uppercase">Total Invoice</span>
            <span className="text-xs font-black text-slate-900">
              Rp {Number(payableInvoiceTotal || 0).toLocaleString('id-ID')}
            </span>
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Rincian Barang Invoice</p>
              <p className="text-sm font-black text-slate-900">Siapkan barang gabungan sebelum berangkat.</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setDeliveryReturMessage('');
                  setDeliveryReturStep(1);
                  setDeliveryReturAck(false);
                  setDeliveryReturType('delivery_refusal');
                  setDeliveryReturReason(defaultRefusalReason);
                  const nextDraft: Record<string, { checked: boolean; qty: string }> = {};
                  deliveryReturLineRows.forEach((row) => {
                    nextDraft[row.key] = { checked: false, qty: '0' };
                  });
                  setDeliveryReturDraft(nextDraft);
                  setIsDeliveryReturOpen(true);
                }}
                disabled={returLocked || hasExistingDeliveryRetur || invoiceItemRows.length === 0 || deliveryReturLineRows.length === 0}
                className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-[10px] font-black uppercase text-rose-700 disabled:opacity-60"
              >
                <Undo2 size={14} />
                Ajukan Retur
              </button>
              <div className="text-right">
                <p className="text-[10px] font-black uppercase text-slate-400">SKU</p>
                <p className="text-sm font-black text-slate-900">{invoiceItemRows.length}</p>
              </div>
            </div>
          </div>
          {deliveryReturnTotal > 0 && Number.isFinite(deliveryNetTotal) && deliveryNetTotal >= 0 && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50/60 p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">Ringkasan Retur Delivery</p>
              <p className="text-xs font-bold text-slate-700 mt-1">
                Potongan retur: {formatCurrency(deliveryReturnTotal)} · Total setelah retur: {formatCurrency(deliveryNetTotal)}
              </p>
            </div>
          )}
          {hasExistingDeliveryRetur && (
            <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-3 space-y-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-violet-700">Serah-Terima Gudang</p>
              <p className="text-xs font-bold text-slate-700">
                Retur untuk diserahkan: <span className="font-black">{handoverReadyReturs.length}</span>
              </p>
              <p className="text-[10px] font-bold text-violet-800">
                Driver cukup serahkan barang retur ke gudang. Admin akan verifikasi di sistem.
              </p>
            </div>
          )}
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 max-h-64 overflow-y-auto space-y-2">
            {invoiceItemRows.map((item) => (
              <div key={item.key} className="rounded-xl border border-slate-200 bg-white px-3 py-2 flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black text-slate-900">{item.name}</p>
                  <p className="text-[10px] text-slate-500">
                    Dari order: {item.orderIds.map((id) => `#${id.slice(-6)}`).join(', ')}
                  </p>
                </div>
                <span className="text-xs font-black text-emerald-700">Qty {item.qty}</span>
              </div>
            ))}
            {invoiceItemRows.length === 0 && (
              <p className="text-xs font-semibold text-slate-500">Tidak ada item pada invoice ini.</p>
            )}
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Opsi Pembayaran</p>
              <p className="text-sm font-black text-slate-900">Pilih metode pembayaran customer.</p>
            </div>
            {(paymentMethodLocked || isFullReturnNoCash) && (
              <span className="text-[10px] font-black uppercase px-2 py-1 rounded-full bg-slate-100 text-slate-600">
                Terkunci
              </span>
            )}
          </div>

          {isFullReturnNoCash && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-bold text-slate-700">
              Retur semua barang: transaksi dengan customer selesai (ongkir hangus). Driver cukup bawa barang retur untuk diserahkan ke Admin/Kasir.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handlePaymentMethodChange('cod')}
              disabled={paymentMethodLocked || paymentMethodLoading || isFullReturnNoCash}
              className={`rounded-2xl border px-4 py-3 text-left space-y-1 transition-all ${activePaymentMethod === 'cod'
                ? 'border-emerald-300 bg-emerald-50'
                : 'border-slate-200 bg-white hover:border-emerald-200'}`}
            >
              <div className="flex items-center gap-2 text-emerald-700">
                <Coins size={16} />
                <span className="text-xs font-black uppercase">COD</span>
              </div>
              <p className="text-[11px] text-slate-600">Driver membawa uang untuk disetor ke finance.</p>
            </button>
            <button
              type="button"
              onClick={() => handlePaymentMethodChange('transfer_manual')}
              disabled={paymentMethodLocked || paymentMethodLoading || isFullReturnNoCash}
              className={`rounded-2xl border px-4 py-3 text-left space-y-1 transition-all ${activePaymentMethod === 'transfer_manual'
                ? 'border-blue-300 bg-blue-50'
                : 'border-slate-200 bg-white hover:border-blue-200'}`}
            >
              <div className="flex items-center gap-2 text-blue-700">
                <CreditCard size={16} />
                <span className="text-xs font-black uppercase">Transfer</span>
              </div>
              <p className="text-[11px] text-slate-600">Pembayaran ditangani finance.</p>
            </button>
          </div>

          {paymentMethodMessage && (
            <p className="text-xs font-bold text-slate-600">{paymentMethodMessage}</p>
          )}
        </div>

        {isCod && (
          <div className="rounded-[28px] border border-amber-200 bg-amber-50/60 p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Pembayaran Customer</p>
                <p className="text-sm font-black text-slate-900">{codStatusTitle}</p>
                <p className="text-[11px] text-slate-600 mt-1">{codStatusHint}</p>
              </div>
              <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-full ${codBadgeClass}`}>
                {codBadgeLabel}
              </span>
            </div>

            {isFullReturnNoCash && (
              <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-[11px] font-bold text-slate-700">
                Tidak perlu konfirmasi penerimaan uang. Silakan fokus ajukan retur lalu serahkan barang ke Admin/Kasir.
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Nominal Diterima</label>
                <input
                  type="number"
                  min="0"
                  value={paymentAmount}
                  readOnly
                  className="w-full rounded-2xl border border-amber-200 px-4 py-3 text-sm font-bold bg-white/80 text-slate-700"
                  placeholder="Total invoice"
                />
                <p className="text-[10px] text-slate-500">Nominal otomatis mengikuti total invoice.</p>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Bukti (Opsional)</label>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  disabled={isFullReturnNoCash}
                  onChange={(e) => handlePaymentProofChange(e.target.files?.[0] || null)}
                  className={`block w-full text-xs text-slate-600 file:mr-3 file:rounded-xl file:border-0 file:bg-amber-200 file:px-3 file:py-2 file:text-[10px] file:font-black file:uppercase file:text-amber-900 ${isFullReturnNoCash ? 'opacity-60' : ''}`}
                />
                <p className="text-[10px] text-slate-500">{codProofHint}</p>
              </div>
            </div>

            {paymentMessage && (
              <p className="text-xs font-bold text-amber-700">{paymentMessage}</p>
            )}

            <button
              type="button"
              onClick={() => void recordPayment()}
              disabled={paymentRecorded || paymentLoading || !paymentAmountValid || isFullReturnNoCash}
              className="w-full py-3 rounded-2xl bg-amber-600 text-white text-xs font-black uppercase disabled:opacity-60"
            >
              {paymentLoading ? 'Memproses...' : codActionLabel}
            </button>
          </div>
        )}

        <div className="space-y-3">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">
            Bukti Foto (Wajib jika Selesai)
          </label>
          <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50 p-6 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-black text-slate-900">Bukti Pengiriman</p>
                <p className="text-[11px] text-slate-600 mt-1">
                  {proof ? `Tersimpan: ${proof.name}` : 'Belum ada foto. Ambil foto dengan kamera.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeliveryProofCameraOpen(true)}
                className="shrink-0 rounded-2xl bg-emerald-600 text-white px-4 py-3 text-[11px] font-black uppercase inline-flex items-center gap-2"
              >
                <Camera size={16} />
                Ambil Foto
              </button>
            </div>
            {proof && (
              <button
                type="button"
                onClick={() => setProof(null)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[11px] font-black uppercase text-slate-700"
              >
                Hapus Foto
              </button>
            )}
          </div>
        </div>

        {deliveryProofCameraOpen && (
          <div className="fixed inset-0 z-[99999] flex items-start justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
            <div className="bg-white w-full max-w-lg rounded-[28px] p-5 shadow-2xl space-y-4 max-h-[calc(100svh-2rem)] overflow-y-auto">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">Kamera</p>
                  <h3 className="mt-2 text-lg font-black text-slate-900">Ambil bukti pengiriman</h3>
                  <p className="mt-2 text-sm text-slate-600">
                    Foto ini wajib untuk menyelesaikan pengiriman.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDeliveryProofCameraOpen(false)}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black uppercase text-slate-700"
                >
                  Tutup
                </button>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden">
                <video ref={deliveryProofVideoRef} muted playsInline className="w-full aspect-video object-cover" />
              </div>

              {deliveryProofCameraError && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[11px] font-bold text-rose-700">
                  {deliveryProofCameraError}
                </div>
              )}

              {!deliveryProofCameraReady && deliveryProofCameraError && (
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 space-y-2">
                  <p className="text-[11px] font-bold text-slate-700">Alternatif: upload file (jika kamera tidak tersedia)</p>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      if (file) setProof(file);
                      setDeliveryProofCameraOpen(false);
                    }}
                    className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-xl file:border-0 file:bg-slate-200 file:px-3 file:py-2 file:text-[10px] file:font-black file:uppercase file:text-slate-800"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setDeliveryProofCameraFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[11px] font-black uppercase text-slate-700 disabled:opacity-60"
                >
                  Ganti Kamera
                </button>
                <button
                  type="button"
                  onClick={() => void captureDeliveryProofPhoto()}
                  disabled={!deliveryProofCameraReady}
                  className="w-full rounded-2xl bg-emerald-600 text-white px-4 py-3 text-[11px] font-black uppercase disabled:opacity-60 inline-flex items-center justify-center gap-2"
                >
                  <Camera size={16} />
                  Ambil Foto
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 pt-2">
          {customer.id ? (
            <Link
              href={`/driver/chat?userId=${encodeURIComponent(String(customer.id))}&phone=${encodeURIComponent(String(customer.whatsapp_number || ''))}`}
              className="w-full py-4 bg-slate-900 text-white rounded-[24px] font-black text-xs uppercase inline-flex items-center justify-center gap-2"
            >
              <MessageCircle size={16} />
              Hubungi Customer (Chat App)
            </Link>
          ) : null}

          {isFullReturnNoCash ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-bold text-slate-700">
              Retur semua barang: transaksi dengan customer selesai (ongkir hangus). Serahkan barang retur ke Admin/Kasir lalu lanjutkan konfirmasi selesai setelah bukti foto lengkap.
            </div>
          ) : isCod && !paymentRecorded ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] font-bold text-amber-700">
              {codCompletionHint}
            </div>
          ) : isCod && paymentRecorded ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[11px] font-bold text-emerald-700">
              {codCompletionHint}
            </div>
          ) : (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-[11px] font-bold text-blue-700">
              Pembayaran transfer akan ditangani finance.
            </div>
          )}

          {(missingProof || missingCodPaymentRecord) && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-bold text-slate-600 space-y-1">
              <p className="uppercase text-[10px] tracking-widest text-slate-400">Belum Bisa Selesai</p>
              {missingCodPaymentRecord && <p>{codBlockingHint}</p>}
              {missingProof && <p>Upload bukti foto pengiriman (bukan bukti pembayaran).</p>}
            </div>
          )}

          {hasReturToHandover && (
            <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-[11px] font-bold text-violet-800">
              Ingat: ada <span className="font-black">{handoverReadyReturs.length}</span> retur delivery. Serahkan barang retur ke gudang, admin akan verifikasi.
            </div>
          )}

          {completeMessage && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-[11px] font-bold text-blue-700">
              {completeMessage}
            </div>
          )}

          <button
            onClick={() => setIsConfirmOpen(true)}
            disabled={!canComplete}
            className="w-full py-5 bg-emerald-600 text-white rounded-[24px] font-black text-sm uppercase shadow-xl shadow-emerald-200 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100 disabled:shadow-none"
          >
            {loading ? 'Processing...' : 'Konfirmasi Selesai'}
          </button>

          <button
            onClick={() => setIsIssueOpen(true)}
            disabled={loading}
            className="w-full py-4 bg-white border-2 border-slate-200 text-rose-600 rounded-[24px] font-black text-xs uppercase hover:bg-rose-50 hover:border-rose-200 transition-all"
          >
            Lapor Barang Kurang / Bermasalah
          </button>
        </div>
      </div>

      {isConfirmOpen && (
        <div className="fixed inset-0 z-[99999] flex items-start justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-[32px] p-6 shadow-2xl animate-in zoom-in-95 duration-200 space-y-4 max-h-[calc(100svh-2rem)] overflow-y-auto">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Upload size={32} />
              </div>
              <h3 className="text-lg font-black text-slate-900">Konfirmasi Serah Terima</h3>
              <p className="text-sm text-slate-500 leading-relaxed">
                Pastikan barang sudah diterima dengan baik oleh customer dan foto bukti sudah sesuai.
              </p>
            </div>

            {isCod && (
              <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4 text-center space-y-1">
                <p className="text-xs font-bold text-orange-600 uppercase tracking-wide">Tagihan COD</p>
                <p className="text-2xl font-black text-slate-900">
                  Rp {Number(payableInvoiceTotal || 0).toLocaleString('id-ID')}
                </p>
                <p className="text-[10px] text-orange-700 font-medium">
                  Terima uang tunai dari customer bila invoice COD ini belum lunas, lalu lanjutkan setoran ke finance sesuai proses.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => setIsConfirmOpen(false)}
                className="py-3 px-4 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                disabled={loading}
              >
                Batal
              </button>
              <button
                onClick={complete}
                disabled={loading}
                className="py-3 px-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-200"
              >
                {loading ? 'Memproses...' : 'Ya, Selesai'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isIssueOpen && (
        <div className="fixed inset-0 z-[99999] flex items-start justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white w-full max-w-md rounded-[28px] p-5 shadow-2xl space-y-4 max-h-[calc(100svh-2rem)] overflow-y-auto">
            <div>
              <h3 className="text-lg font-black text-slate-900">Laporan Kekurangan Barang</h3>
              <p className="text-xs text-slate-500 mt-1">Catatan wajib, foto bukti opsional.</p>
            </div>

            <textarea
              value={issueNote}
              onChange={(e) => setIssueNote(e.target.value)}
              rows={4}
              placeholder="Contoh: Busi NGK kurang 2 pcs, oli tidak ada."
              className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm"
            />

            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-3">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => setIssuePhoto(e.target.files?.[0] || null)}
                className="hidden"
                id="driver-issue-evidence"
              />
              <label htmlFor="driver-issue-evidence" className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                <Camera size={14} /> {issuePhoto ? issuePhoto.name : 'Tambah foto bukti (opsional)'}
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsIssueOpen(false)}
                disabled={loading}
                className="py-3 rounded-xl border border-slate-300 text-xs font-black uppercase text-slate-700"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={submitIssue}
                disabled={loading}
                className="py-3 rounded-xl bg-rose-600 text-white text-xs font-black uppercase inline-flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <Send size={13} /> {loading ? 'Mengirim...' : 'Kirim Laporan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
