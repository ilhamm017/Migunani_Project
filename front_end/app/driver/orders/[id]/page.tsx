'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Camera, ClipboardCheck, MessageCircle, Send, Upload, Coins, CreditCard, Undo2 } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import axios from 'axios';
import type { DriverAssignedOrderRow, InvoiceDetailResponse } from '@/lib/apiTypes';

type StoredChecklistRow = {
  orderId?: string;
  orderIds?: string[];
  productName?: string;
  expectedQty?: number;
  actualQty?: number;
  note?: string;
};

type PaymentMethodConfirmState = {
  step: 1 | 2;
  nextMethod: 'cod' | 'transfer_manual';
  title: string;
  description: string;
};

type CodPaymentConfirmState = {
  step: 1 | 2;
};

const normalizeInvoiceRef = (raw: unknown) => String(raw || '').trim();
const formatCurrency = (value: unknown) =>
  `Rp ${Number(value || 0).toLocaleString('id-ID')}`;
const isOrderDoneStatus = (raw: unknown) =>
  ['delivered', 'completed', 'cancelled', 'canceled'].includes(String(raw || '').toLowerCase());
const checklistScopeStorageKey = (scopeId: string) => `driver-checklist-scope-${scopeId}`;
const legacyChecklistStorageKey = (orderId: string) => `driver-checklist-${orderId}`;
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
  const [loading, setLoading] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isIssueOpen, setIsIssueOpen] = useState(false);
  const [issueNote, setIssueNote] = useState('');
  const [issuePhoto, setIssuePhoto] = useState<File | null>(null);
  const [checklistRows, setChecklistRows] = useState<StoredChecklistRow[]>([]);
  const [issueSubmitted, setIssueSubmitted] = useState(false);
  const [checklistState, setChecklistState] = useState<{ exists: boolean; mismatchCount: number; savedAt?: string }>({
    exists: false,
    mismatchCount: 0,
  });
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
  const [deliveryReturDraft, setDeliveryReturDraft] = useState<Record<string, { qty: string; order_id?: string }>>({});
  const [deliveryReturReason, setDeliveryReturReason] = useState('Retur saat pengiriman (tidak jadi beli)');
  const [deliveryReturLoading, setDeliveryReturLoading] = useState(false);
  const [deliveryReturMessage, setDeliveryReturMessage] = useState('');
  const [deliveryReturStep, setDeliveryReturStep] = useState<1 | 2>(1);
  const [deliveryReturAck, setDeliveryReturAck] = useState(false);
  const [isReturHandoverOpen, setIsReturHandoverOpen] = useState(false);
  const [returHandoverStep, setReturHandoverStep] = useState<1 | 2>(1);
  const [returHandoverAck, setReturHandoverAck] = useState(false);
  const [returHandoverLoading, setReturHandoverLoading] = useState(false);
  const [returHandoverMessage, setReturHandoverMessage] = useState('');
  const [returHandoverNote, setReturHandoverNote] = useState('');

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
    const next = Number.isFinite(net) && net > 0 ? net : gross;
    if (Number.isFinite(next) && next > 0) {
      setPaymentAmount(String(next));
    }
  }, [invoiceDetail?.id, invoiceDetail?.total, (invoiceDetail as any)?.delivery_return_summary?.net_total]);

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

  useEffect(() => {
    if (!allowed || groupedOrderIds.length === 0 || typeof window === 'undefined') {
      setChecklistState({ exists: false, mismatchCount: 0 });
      setChecklistRows([]);
      return;
    }

    const scopeId =
      resolvedInvoiceId
      || normalizeInvoiceRef(groupedOrders[0]?.invoice_id || groupedOrders[0]?.Invoice?.id)
      || groupedOrderIds[0]
      || '';

    if (scopeId) {
      const scopedRaw = sessionStorage.getItem(checklistScopeStorageKey(scopeId));
      if (scopedRaw) {
        try {
          const scopedParsed = JSON.parse(scopedRaw);
          const rows = Array.isArray(scopedParsed?.rows) ? scopedParsed.rows : [];
          const mismatchCount = rows.filter((row: any) => Number(row?.actualQty || 0) !== Number(row?.expectedQty || 0)).length;
          setChecklistRows(rows);
          setChecklistState({
            exists: rows.length > 0,
            mismatchCount,
            savedAt: scopedParsed?.savedAt,
          });
          return;
        } catch (error) {
          console.error('Failed to parse invoice checklist state:', error);
        }
      }
    }

    // Fallback legacy: merge checklist lama per-order.
    const mergedRows: StoredChecklistRow[] = [];
    let totalMismatch = 0;
    let latestSavedAt: string | undefined;
    let existsCount = 0;
    groupedOrderIds.forEach((currentOrderId) => {
      const raw = sessionStorage.getItem(legacyChecklistStorageKey(currentOrderId));
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
        const mismatchCount = rows.filter((row: any) => Number(row?.actualQty || 0) !== Number(row?.expectedQty || 0)).length;
        rows.forEach((row: any) => {
          mergedRows.push({
            ...(row as any),
            orderId: currentOrderId,
          });
        });
        totalMismatch += mismatchCount;
        if (parsed?.savedAt) {
          const savedAtText = String(parsed.savedAt);
          if (!latestSavedAt || savedAtText > latestSavedAt) latestSavedAt = savedAtText;
        }
        existsCount += 1;
      } catch (error) {
        console.error('Failed to parse legacy checklist state:', error);
      }
    });

    setChecklistRows(mergedRows);
    setChecklistState({
      exists: existsCount === groupedOrderIds.length && groupedOrderIds.length > 0,
      mismatchCount: totalMismatch,
      savedAt: latestSavedAt,
    });
  }, [allowed, groupedOrderIds, groupedOrders, resolvedInvoiceId]);

  const mismatchRows = useMemo(
    () => checklistRows.filter((row) => Number(row?.actualQty || 0) !== Number(row?.expectedQty || 0)),
    [checklistRows]
  );
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
        const currentOrderId = String(row?.id || '').trim();
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
  const deliveryReturnSummary = (invoiceDetail as any)?.delivery_return_summary || null;
  const deliveryNetTotal = Number(deliveryReturnSummary?.net_total || 0);
  const deliveryReturnTotal = Number(deliveryReturnSummary?.return_total || 0);
  const existingDeliveryReturs = Array.isArray((invoiceDetail as any)?.delivery_returs) ? ((invoiceDetail as any).delivery_returs as any[]) : [];
  const hasExistingDeliveryRetur = existingDeliveryReturs.length > 0;
  const handoverReadyReturs = existingDeliveryReturs.filter((r: any) => String(r?.status || '') === 'picked_up');
  const canSubmitHandover = handoverReadyReturs.length > 0;
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
  const primaryChecklistOrderId = groupedOrderIds[0] || resolvedFromOrderId || orderId;
  const checklistScopeId = (invoiceContext.invoiceId || primaryChecklistOrderId || '').trim();

  if (!allowed) return null;

  const activePaymentMethod = paymentMethod || invoiceContext.invoicePaymentMethod;
  const isCod = activePaymentMethod === 'cod';
  const paymentRecorded = isCod && ['cod_pending', 'paid'].includes(String(invoiceContext.invoicePaymentStatus || ''));
  const returLocked = ['paid', 'cod_pending'].includes(String(invoiceContext.invoicePaymentStatus || ''));
  const paymentAmountValue = paymentAmount.trim() ? Number(paymentAmount) : undefined;
  const paymentAmountValid = paymentAmountValue === undefined || Number.isFinite(paymentAmountValue);
  const paymentMethodLocked = ['paid', 'cod_pending'].includes(String(invoiceContext.invoicePaymentStatus || ''));
  const missingChecklist = !checklistState.exists;
  const hasChecklistMismatch = checklistState.exists && checklistState.mismatchCount > 0;
  const missingProof = !proof;
  const missingCodPaymentRecord = isCod && !paymentRecorded;
  const missingReturHandover = hasExistingDeliveryRetur && handoverReadyReturs.length > 0;
  const codStatusTitle = paymentRecorded ? 'Status COD sudah tercatat untuk invoice ini.' : 'Konfirmasi COD jika invoice masih belum tercatat.';
  const codStatusHint = paymentRecorded
    ? 'Invoice COD normal bisa sudah berstatus pending sejak invoice diterbitkan. Driver bisa lanjut checklist dan bukti kirim.'
    : 'Jika invoice COD ini masih belum tercatat, driver dapat konfirmasi penerimaan uang customer di sini.';
  const codProofHint = paymentRecorded
    ? 'Upload bukti COD bersifat opsional untuk dokumentasi tambahan.'
    : 'Jika masih diperlukan, upload bukti COD akan mencoba mencatat pembayaran otomatis.';
  const codActionLabel = paymentRecorded ? 'COD Sudah Tercatat' : 'Konfirmasi Penerimaan COD';
  const codCompletionHint = paymentRecorded
    ? 'Status COD invoice ini sudah tercatat. Lanjutkan konfirmasi selesai setelah checklist dan bukti kirim lengkap.'
    : 'Invoice COD ini masih belum tercatat. Konfirmasi penerimaan COD terlebih dahulu sebelum selesai.';
  const codBlockingHint = paymentRecorded
    ? ''
    : 'Pembayaran COD belum tercatat. Upload bukti COD atau klik Konfirmasi Penerimaan COD.';
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
    const selected = invoiceItemRows
      .map((row) => {
        const draft = deliveryReturDraft[row.key];
        const qty = Math.max(0, Math.trunc(Number(draft?.qty || 0)));
        return { row, draft, qty };
      })
      .filter((x) => Number.isFinite(x.qty) && x.qty > 0);

    if (selected.length === 0) {
      return 'Isi minimal 1 item retur dengan qty > 0.';
    }

    for (const { row, draft, qty } of selected) {
      if (qty > Number(row.qty || 0)) {
        return `Qty retur melebihi qty invoice untuk ${row.name}.`;
      }
      if (row.orderIds.length > 1) {
        const orderId = typeof draft?.order_id === 'string' ? draft.order_id.trim() : '';
        if (!orderId) {
          return `Pilih order untuk item ${row.name} (produk ada di beberapa order).`;
        }
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
    const payloadItems = invoiceItemRows
      .map((row) => {
        const draft = deliveryReturDraft[row.key];
        const qty = Math.max(0, Math.trunc(Number(draft?.qty || 0)));
        if (!Number.isFinite(qty) || qty <= 0) return null;
        const order_id = typeof draft?.order_id === 'string' && draft.order_id.trim()
          ? draft.order_id.trim()
          : undefined;
        return {
          product_id: row.key,
          qty,
          ...(order_id ? { order_id } : {}),
          ...(deliveryReturReason.trim() ? { reason: deliveryReturReason.trim() } : {})
        };
      })
      .filter(Boolean) as Array<{ product_id: string; qty: number; order_id?: string; reason?: string }>;

    if (payloadItems.length === 0) {
      setDeliveryReturMessage('Isi minimal 1 item retur dengan qty > 0.');
      return;
    }

    try {
      setDeliveryReturLoading(true);
      setDeliveryReturMessage('');
      await api.driver.createDeliveryReturTicket(orderId, { items: payloadItems });

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
      setDeliveryReturReason('Retur saat pengiriman (tidak jadi beli)');
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

  const submitReturHandover = async () => {
    const invoiceIdToSubmit = String(resolvedInvoiceId || invoiceContext.invoiceId || '').trim();
    if (!invoiceIdToSubmit) {
      setReturHandoverMessage('Invoice belum ditemukan.');
      return;
    }
    if (!canSubmitHandover) {
      setReturHandoverMessage('Tidak ada retur delivery yang siap diserahkan (status picked_up).');
      return;
    }
    try {
      setReturHandoverLoading(true);
      setReturHandoverMessage('');
      await api.driver.submitReturHandover({
        invoice_id: invoiceIdToSubmit,
        note: returHandoverNote.trim() ? returHandoverNote.trim() : undefined
      });

      try {
        const invoiceRes = await api.invoices.getById(invoiceIdToSubmit);
        setInvoiceDetail(invoiceRes.data || null);
      } catch (refreshError) {
        console.error('Refresh invoice detail after retur handover failed:', refreshError);
      }
      await loadOrder();
      setIsReturHandoverOpen(false);
      setReturHandoverStep(1);
      setReturHandoverAck(false);
      setReturHandoverNote('');
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? String(error.response?.data?.message || error.message || 'Gagal serah-terima retur')
        : 'Gagal serah-terima retur';
      setReturHandoverMessage(message);
    } finally {
      setReturHandoverLoading(false);
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
    if (paymentRecorded) {
      setPaymentMessage('Bukti COD tersimpan sebagai dokumentasi. Status COD invoice ini sudah tercatat.');
      return;
    }
    setPaymentMessage('Bukti COD diterima. Lanjutkan Konfirmasi Penerimaan COD untuk mencatat pembayaran.');
  };

  const handlePaymentMethodChange = async (nextMethod: 'cod' | 'transfer_manual') => {
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
      alert('Catatan laporan minimal 5 karakter.');
      return;
    }
    const snapshotPrimaryOrderId = getActionTargetIds()[0] || primaryChecklistOrderId;

    const snapshot = {
      order_id: snapshotPrimaryOrderId,
      invoice_id: invoiceContext.invoiceId || resolvedInvoiceId || null,
      mismatch_total: mismatchRows.length,
      rows: mismatchRows.map((row) => ({
        order_id: row.orderId || row.orderIds?.[0] || snapshotPrimaryOrderId,
        product_name: row.productName || 'Produk',
        expected_qty: Number(row.expectedQty || 0),
        actual_qty: Number(row.actualQty || 0),
        note: String(row.note || '').trim() || null,
      })),
    };

    try {
      setLoading(true);
      const targetIds = getActionTargetIds();
      if (targetIds.length === 0) {
        alert('Order invoice belum ditemukan.');
        return;
      }
      const results = await Promise.allSettled(
        targetIds.map((id) => api.driver.reportIssue(id, {
          note,
          checklist_snapshot: JSON.stringify(snapshot),
          evidence: issuePhoto,
        }))
      );
      const failedIds = results
        .map((result, idx) => (result.status === 'rejected' ? String(targetIds[idx]) : ''))
        .filter(Boolean);
      const successCount = targetIds.length - failedIds.length;

      if (successCount === 0) {
        alert('Semua laporan gagal dikirim. Periksa koneksi lalu coba lagi.');
        return;
      }

      if (failedIds.length > 0) {
        setIsIssueOpen(false);
        alert(`Sebagian laporan berhasil (${successCount}/${targetIds.length}). ${failedIds.length} order gagal diproses.`);
        return;
      }

      setIsIssueOpen(false);
      setIssueSubmitted(true);
      setTimeout(() => router.push('/driver'), 1300);
    } catch (error) {
      console.error('Report issue failed:', error);
      alert('Gagal melaporkan masalah.');
    } finally {
      setLoading(false);
    }
  };

  const canComplete = !!proof
    && checklistState.exists
    && checklistState.mismatchCount === 0
    && !loading
    && (!isCod || paymentRecorded)
    && !missingReturHandover;
  const customer = order?.Customer || {};

  return (
    <div className="p-6 space-y-5">
      {isDeliveryReturOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white w-full max-w-lg rounded-[28px] p-5 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-600">
                  Retur Saat Pengiriman
                </p>
                <h3 className="mt-2 text-lg font-black text-slate-900">Ajukan retur (tidak jadi beli)</h3>
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
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Alasan</label>
                  <input
                    value={deliveryReturReason}
                    onChange={(e) => setDeliveryReturReason(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-800"
                    placeholder="Contoh: Customer tidak jadi beli"
                  />
                </div>

                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 max-h-72 overflow-y-auto space-y-3">
                  {invoiceItemRows.map((row) => {
                    const draft = deliveryReturDraft[row.key] || { qty: '0', order_id: row.orderIds.length === 1 ? row.orderIds[0] : '' };
                    return (
                      <div key={row.key} className="rounded-2xl border border-slate-200 bg-white p-3 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-black text-slate-900">{row.name}</p>
                            <p className="text-[10px] text-slate-500">Qty invoice: <span className="font-black">{row.qty}</span></p>
                          </div>
                          <div className="text-right">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Qty Retur</label>
                            <input
                              type="number"
                              min="0"
                              max={row.qty}
                              value={draft.qty}
                              onChange={(e) => {
                                const nextQty = e.target.value;
                                setDeliveryReturDraft((prev) => ({
                                  ...prev,
                                  [row.key]: { ...draft, qty: nextQty }
                                }));
                              }}
                              className="mt-1 w-28 rounded-xl border border-slate-200 px-3 py-2 text-sm font-black text-slate-800"
                            />
                          </div>
                        </div>
                        {row.orderIds.length > 1 && (
                          <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Order</label>
                            <select
                              value={draft.order_id || ''}
                              onChange={(e) => {
                                const nextOrderId = e.target.value;
                                setDeliveryReturDraft((prev) => ({
                                  ...prev,
                                  [row.key]: { ...draft, order_id: nextOrderId }
                                }));
                              }}
                              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-800 bg-white"
                            >
                              <option value="">Pilih order...</option>
                              {row.orderIds.map((oid) => (
                                <option key={oid} value={oid}>
                                  {oid}
                                </option>
                              ))}
                            </select>
                            <p className="text-[10px] text-slate-500">Produk ini ada di beberapa order. Wajib pilih order.</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {invoiceItemRows.length === 0 && (
                    <p className="text-xs font-semibold text-slate-500">Tidak ada item pada invoice ini.</p>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[11px] text-rose-800 space-y-1">
                  <p className="font-black uppercase tracking-widest text-[10px] text-rose-700">Verifikasi Retur (Final)</p>
                  <p>Retur delivery hanya bisa diinput <span className="font-black">1 kali</span> dan <span className="font-black">tidak bisa diubah</span>.</p>
                </div>

                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 max-h-72 overflow-y-auto space-y-2">
                  {invoiceItemRows
                    .map((row) => {
                      const draft = deliveryReturDraft[row.key];
                      const qty = Math.max(0, Math.trunc(Number(draft?.qty || 0)));
                      if (!Number.isFinite(qty) || qty <= 0) return null;
                      const orderId = typeof draft?.order_id === 'string' && draft.order_id.trim() ? draft.order_id.trim() : '';
                      return (
                        <div key={row.key} className="rounded-xl border border-slate-200 bg-white px-3 py-2 flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-black text-slate-900">{row.name}</p>
                            <p className="text-[10px] text-slate-500">
                              {row.orderIds.length > 1 ? `Order: ${orderId || '(belum dipilih)'}` : `Order: ${row.orderIds[0] || '-'}`}
                            </p>
                          </div>
                          <span className="text-xs font-black text-rose-700">Qty {qty}</span>
                        </div>
                      );
                    })
                    .filter(Boolean)}
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
                disabled={deliveryReturLoading || invoiceItemRows.length === 0 || hasExistingDeliveryRetur}
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
      {isReturHandoverOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white w-full max-w-lg rounded-[28px] p-5 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-700">
                  Serah-Terima Retur Gudang
                </p>
                <h3 className="mt-2 text-lg font-black text-slate-900">
                  {returHandoverStep === 1 ? 'Buat tiket penyerahan retur' : 'Verifikasi Handover (Final)'}
                </h3>
                <p className="mt-2 text-sm text-slate-600">
                  Retur delivery yang sudah dicatat harus diserahkan kembali ke gudang dan diterima admin agar tidak miss.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (returHandoverLoading) return;
                  setIsReturHandoverOpen(false);
                }}
                className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black uppercase text-slate-700"
              >
                Tutup
              </button>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[11px] text-slate-700">
              Step <span className="font-black">{returHandoverStep}</span> / 2
              {returHandoverStep === 2 && (
                <span className="ml-2 text-violet-700 font-black">FINAL</span>
              )}
            </div>

            <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-[11px] text-violet-800 space-y-1">
              <p>
                Retur siap diserahkan: <span className="font-black">{handoverReadyReturs.length}</span>
              </p>
              <p>
                Invoice: <span className="font-black">{invoiceDisplayLabel}</span>
              </p>
            </div>

            {returHandoverStep === 1 ? (
              <>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Catatan (Opsional)</label>
                  <input
                    value={returHandoverNote}
                    onChange={(e) => setReturHandoverNote(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-800"
                    placeholder="Contoh: Diserahkan ke gudang sore hari"
                  />
                </div>

                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 max-h-72 overflow-y-auto space-y-2">
                  {handoverReadyReturs.map((r: any) => (
                    <div key={String(r?.id)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-black text-slate-900 truncate">{String(r?.Product?.name || 'Produk')}</p>
                        <p className="text-[10px] text-slate-500 truncate">
                          Retur ID: {String(r?.id || '').slice(-8).toUpperCase()} · SKU: {String(r?.Product?.sku || '-')}
                        </p>
                      </div>
                      <span className="text-xs font-black text-violet-700">Qty {Number(r?.qty || 0)}</span>
                    </div>
                  ))}
                  {handoverReadyReturs.length === 0 && (
                    <p className="text-xs font-semibold text-slate-500">Tidak ada retur dengan status picked_up.</p>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-[11px] text-violet-900 space-y-1">
                  <p className="font-black uppercase tracking-widest text-[10px] text-violet-700">Konfirmasi Final</p>
                  <p>Setelah submit, semua retur di atas masuk status <span className="font-black">handed_to_warehouse</span> dan menunggu penerimaan admin gudang/kasir.</p>
                </div>

                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 max-h-72 overflow-y-auto space-y-2">
                  {handoverReadyReturs.map((r: any) => (
                    <div key={String(r?.id)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-black text-slate-900 truncate">{String(r?.Product?.name || 'Produk')}</p>
                        <p className="text-[10px] text-slate-500 truncate">
                          Retur ID: {String(r?.id || '').slice(-8).toUpperCase()}
                        </p>
                      </div>
                      <span className="text-xs font-black text-violet-700">Qty {Number(r?.qty || 0)}</span>
                    </div>
                  ))}
                </div>

                <label className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-700">
                  <input
                    type="checkbox"
                    checked={returHandoverAck}
                    onChange={(e) => setReturHandoverAck(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>Saya sudah cek ulang daftar retur dan yakin barang fisik benar-benar diserahkan ke gudang.</span>
                </label>
              </>
            )}

            {returHandoverMessage && (
              <p className="text-xs font-bold text-violet-700">{returHandoverMessage}</p>
            )}

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  if (returHandoverLoading) return;
                  if (returHandoverStep === 2) {
                    setReturHandoverStep(1);
                    setReturHandoverAck(false);
                    setReturHandoverMessage('');
                    return;
                  }
                  setIsReturHandoverOpen(false);
                }}
                disabled={returHandoverLoading}
                className="py-3 rounded-xl border border-slate-300 text-xs font-black uppercase text-slate-700"
              >
                {returHandoverStep === 2 ? 'Kembali' : 'Batal'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (returHandoverStep === 1) {
                    if (!invoiceContext.invoiceId) {
                      setReturHandoverMessage('Invoice belum ditemukan.');
                      return;
                    }
                    if (handoverReadyReturs.length === 0) {
                      setReturHandoverMessage('Tidak ada retur delivery yang siap diserahkan (status picked_up).');
                      return;
                    }
                    setReturHandoverStep(2);
                    setReturHandoverAck(false);
                    setReturHandoverMessage('');
                    return;
                  }
                  if (!returHandoverAck) {
                    setReturHandoverMessage('Centang konfirmasi sebelum submit serah-terima.');
                    return;
                  }
                  void submitReturHandover();
                }}
                disabled={returHandoverLoading || handoverReadyReturs.length === 0}
                className="py-3 rounded-xl bg-violet-700 text-white text-xs font-black uppercase disabled:opacity-60"
              >
                {returHandoverLoading
                  ? 'Memproses...'
                  : returHandoverStep === 1
                    ? 'Lanjut Verifikasi'
                    : 'Ya, Submit Handover'}
              </button>
            </div>
          </div>
        </div>
      )}
      {paymentMethodConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white w-full max-w-md rounded-[28px] p-5 shadow-2xl space-y-4">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white w-full max-w-md rounded-[28px] p-5 shadow-2xl space-y-4">
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
                  const nextDraft: Record<string, { qty: string; order_id?: string }> = {};
                  invoiceItemRows.forEach((row) => {
                    nextDraft[row.key] = {
                      qty: '0',
                      order_id: row.orderIds.length === 1 ? row.orderIds[0] : '',
                    };
                  });
                  setDeliveryReturDraft(nextDraft);
                  setIsDeliveryReturOpen(true);
                }}
                disabled={returLocked || hasExistingDeliveryRetur || invoiceItemRows.length === 0}
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
            <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-violet-700">Serah-Terima Gudang</p>
                <p className="text-xs font-bold text-slate-700 mt-1 truncate">
                  Retur siap diserahkan: <span className="font-black">{handoverReadyReturs.length}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setReturHandoverMessage('');
                  setReturHandoverStep(1);
                  setReturHandoverAck(false);
                  setIsReturHandoverOpen(true);
                }}
                disabled={!canSubmitHandover || returHandoverLoading}
                className="shrink-0 inline-flex items-center gap-2 rounded-2xl border border-violet-200 bg-white px-3 py-2 text-[10px] font-black uppercase text-violet-700 disabled:opacity-60"
              >
                Serahkan
              </button>
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
            {paymentMethodLocked && (
              <span className="text-[10px] font-black uppercase px-2 py-1 rounded-full bg-slate-100 text-slate-600">
                Terkunci
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handlePaymentMethodChange('cod')}
              disabled={paymentMethodLocked || paymentMethodLoading}
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
              disabled={paymentMethodLocked || paymentMethodLoading}
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
              <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-full ${paymentRecorded ? 'bg-emerald-100 text-emerald-700' : 'bg-white text-amber-700 border border-amber-200'}`}>
                {paymentRecorded ? 'Sudah Dicatat' : 'Belum Dicatat'}
              </span>
            </div>

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
                  onChange={(e) => handlePaymentProofChange(e.target.files?.[0] || null)}
                  className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-xl file:border-0 file:bg-amber-200 file:px-3 file:py-2 file:text-[10px] file:font-black file:uppercase file:text-amber-900"
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
              disabled={paymentRecorded || paymentLoading || !paymentAmountValid}
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
          <div className="relative group">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setProof(e.target.files?.[0] || null)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 group-hover:border-emerald-300 rounded-3xl p-8 bg-slate-50 group-hover:bg-emerald-50/30 transition-all">
              <Upload size={24} className="text-slate-400 group-hover:text-emerald-500 mb-2" />
              <p className="text-xs font-bold text-slate-500 group-hover:text-emerald-700">
                {proof ? proof.name : 'Klik untuk Ambil Foto Bukti'}
              </p>
            </div>
          </div>
        </div>

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

          <div className="rounded-[24px] border border-emerald-200 bg-emerald-50/40 p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Checklist Invoice</p>
              <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-black uppercase ${
                !checklistState.exists
                  ? 'bg-amber-100 text-amber-700 border-amber-200'
                  : checklistState.mismatchCount > 0
                    ? 'bg-rose-100 text-rose-700 border-rose-200'
                    : 'bg-emerald-100 text-emerald-700 border-emerald-200'
              }`}>
                {!checklistState.exists
                  ? 'Belum Dicek'
                  : checklistState.mismatchCount > 0
                    ? `Selisih ${checklistState.mismatchCount}`
                    : 'Checklist OK'}
              </span>
            </div>
            {checklistState.savedAt && (
              <p className="text-[10px] text-emerald-700">
                Terakhir disimpan: {new Date(checklistState.savedAt).toLocaleString('id-ID')}
              </p>
            )}
            <Link
              href={`/driver/orders/${encodeURIComponent(checklistScopeId || primaryChecklistOrderId)}/checklist`}
              className="w-full py-3 bg-white border-2 border-emerald-200 text-emerald-700 rounded-2xl font-black text-xs uppercase inline-flex items-center justify-center gap-2"
            >
              <ClipboardCheck size={16} />
              Buka Checklist Invoice
            </Link>
          </div>

          {isCod && !paymentRecorded && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] font-bold text-amber-700">
              {codCompletionHint}
            </div>
          )}
          {isCod && paymentRecorded && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[11px] font-bold text-emerald-700">
              {codCompletionHint}
            </div>
          )}
          {!isCod && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-[11px] font-bold text-blue-700">
              Pembayaran transfer akan ditangani finance.
            </div>
          )}

          {(missingChecklist || hasChecklistMismatch || missingProof || missingCodPaymentRecord || missingReturHandover) && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-bold text-slate-600 space-y-1">
              <p className="uppercase text-[10px] tracking-widest text-slate-400">Belum Bisa Selesai</p>
              {missingCodPaymentRecord && <p>{codBlockingHint}</p>}
              {missingReturHandover && <p>Retur delivery belum diserahkan ke gudang. Klik tombol Serahkan di kartu Serah-Terima Gudang.</p>}
              {missingChecklist && <p>Checklist belum disimpan. Buka checklist lalu klik Simpan.</p>}
              {hasChecklistMismatch && <p>Checklist masih ada selisih. Perbaiki atau laporkan terlebih dahulu.</p>}
              {missingProof && <p>Upload bukti foto pengiriman (bukan bukti pembayaran).</p>}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-[32px] p-6 shadow-2xl animate-in zoom-in-95 duration-200 space-y-4">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white w-full max-w-md rounded-[28px] p-5 shadow-2xl space-y-4">
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
