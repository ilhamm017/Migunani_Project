'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Package, User, MapPin, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';

type ChecklistIndicator = 'not_checked' | 'mismatch' | 'ready';

type ChecklistMeta = {
  status: ChecklistIndicator;
  savedAt?: string;
  mismatchCount?: number;
};

const normalizeInvoiceRef = (raw: unknown) => String(raw || '').trim();
const checklistScopeStorageKey = (scopeId: string) => `driver-checklist-scope-${scopeId}`;
const legacyChecklistStorageKey = (orderId: string) => `driver-checklist-${orderId}`;
const getInvoiceItems = (invoiceData: any) => {
  if (Array.isArray(invoiceData?.InvoiceItems)) return invoiceData.InvoiceItems;
  if (Array.isArray(invoiceData?.Items)) return invoiceData.Items;
  return [];
};

const getChecklistMeta = (scopeId: string, orderIds: string[]): ChecklistMeta => {
  if (typeof window === 'undefined' || !scopeId) {
    return { status: 'not_checked' };
  }

  const scopeRaw = sessionStorage.getItem(checklistScopeStorageKey(scopeId));
  if (scopeRaw) {
    try {
      const parsed = JSON.parse(scopeRaw);
      const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
      if (rows.length === 0) return { status: 'not_checked' };
      const mismatchCount = rows.filter((row: any) => Number(row?.actualQty || 0) !== Number(row?.expectedQty || 0)).length;
      return {
        status: mismatchCount > 0 ? 'mismatch' : 'ready',
        savedAt: parsed?.savedAt,
        mismatchCount,
      };
    } catch {
      return { status: 'not_checked' };
    }
  }

  // Fallback legacy per-order checklist.
  let existsCount = 0;
  let mismatchTotal = 0;
  let latestSavedAt: string | undefined;
  orderIds.forEach((orderId) => {
    const raw = sessionStorage.getItem(legacyChecklistStorageKey(orderId));
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
      mismatchTotal += rows.filter((row: any) => Number(row?.actualQty || 0) !== Number(row?.expectedQty || 0)).length;
      if (parsed?.savedAt) {
        const savedAtText = String(parsed.savedAt);
        if (!latestSavedAt || savedAtText > latestSavedAt) latestSavedAt = savedAtText;
      }
      existsCount += 1;
    } catch {
      // ignore broken legacy row
    }
  });

  if (existsCount === 0 || existsCount < orderIds.length) {
    return { status: 'not_checked' };
  }

  return {
    status: mismatchTotal > 0 ? 'mismatch' : 'ready',
    savedAt: latestSavedAt,
    mismatchCount: mismatchTotal,
  };
};

export default function DriverPrecheckPage() {
  const allowed = useRequireRoles(['driver', 'super_admin', 'admin_gudang']);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [invoiceDetailsById, setInvoiceDetailsById] = useState<Record<string, any>>({});
  const [checklistByScope, setChecklistByScope] = useState<Record<string, ChecklistMeta>>({});

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.driver.getOrders({ status: 'ready_to_ship,shipped' });
      const rows = Array.isArray(res.data) ? res.data : [];
      setOrders(rows);
    } catch (error) {
      console.error('Load driver precheck failed:', error);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) {
      void load();
    }
  }, [allowed, load]);

  useEffect(() => {
    if (!allowed) return;
    const invoiceIds = Array.from(
      new Set(
        orders
          .map((row: any) => normalizeInvoiceRef(row?.invoice_id || row?.Invoice?.id))
          .filter(Boolean)
      )
    );
    if (invoiceIds.length === 0) {
      queueMicrotask(() => setInvoiceDetailsById({}));
      return;
    }

    let isCancelled = false;
    void (async () => {
      try {
        const responses = await Promise.allSettled(
          invoiceIds.map((invoiceId) => api.invoices.getById(invoiceId))
        );
        if (isCancelled) return;
        const nextMap: Record<string, any> = {};
        responses.forEach((result, index) => {
          if (result.status !== 'fulfilled') return;
          const data = result.value?.data || null;
          const id = normalizeInvoiceRef(data?.id || invoiceIds[index]);
          if (!id) return;
          nextMap[id] = data;
        });
        setInvoiceDetailsById(nextMap);
      } catch (error) {
        if (!isCancelled) {
          console.error('Load invoice snapshot for precheck failed:', error);
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [allowed, orders]);

  const invoiceCards = useMemo(() => {
    const buckets = orders.reduce((acc, order: any) => {
      const orderId = String(order?.id || '').trim();
      if (!orderId) return acc;
      const invoiceId = normalizeInvoiceRef(order?.invoice_id || order?.Invoice?.id);
      const invoiceNumber = normalizeInvoiceRef(order?.invoice_number || order?.Invoice?.invoice_number);
      const key = invoiceId ? `id:${invoiceId}` : invoiceNumber ? `num:${invoiceNumber.toLowerCase()}` : `order:${orderId}`;
      const bucket = acc.get(key) || {
        key,
        invoiceId,
        invoiceNumber,
        orders: [] as any[],
      };
      bucket.orders.push(order);
      acc.set(key, bucket);
      return acc;
    }, new Map<string, { key: string; invoiceId: string; invoiceNumber: string; orders: any[] }>());

    const bucketValues = Array.from(buckets.values()) as Array<{
      key: string;
      invoiceId: string;
      invoiceNumber: string;
      orders: any[];
    }>;

    return bucketValues.map((bucket) => {
      const sortedOrders = [...bucket.orders].sort((a: any, b: any) => {
        const bTs = Date.parse(String(b?.updatedAt || b?.createdAt || ''));
        const aTs = Date.parse(String(a?.updatedAt || a?.createdAt || ''));
        const bVal = Number.isFinite(bTs) ? bTs : 0;
        const aVal = Number.isFinite(aTs) ? aTs : 0;
        return bVal - aVal;
      });

      const primaryOrder = sortedOrders[0] || null;
      const primaryOrderId = String(primaryOrder?.id || '').trim();
      const scopeId = bucket.invoiceId || primaryOrderId;
      const orderIds = sortedOrders.map((row: any) => String(row?.id || '').trim()).filter(Boolean);
      const invoiceDetail = bucket.invoiceId ? invoiceDetailsById[bucket.invoiceId] : null;

      const customer = primaryOrder?.Customer || {};
      const profile = customer.CustomerProfile || {};
      const addresses = Array.isArray(profile.saved_addresses) ? profile.saved_addresses : [];
      const addressObj = addresses.find((a: any) => a.isPrimary) || addresses[0];
      const address = addressObj ? (addressObj.fullAddress || addressObj.address || 'Alamat tersimpan') : 'Alamat tidak tersedia';

      const itemMap = new Map<string, { name: string; qty: number }>();
      const invoiceItems = getInvoiceItems(invoiceDetail);
      if (invoiceItems.length > 0) {
        invoiceItems.forEach((item: any) => {
          const orderItem = item?.OrderItem || {};
          const product = orderItem?.Product || {};
          const productKey = String(orderItem?.product_id || product?.sku || product?.name || item?.id || '').trim();
          if (!productKey) return;
          const entry = itemMap.get(productKey) || { name: product?.name || 'Produk', qty: 0 };
          entry.qty += Number(item?.qty || item?.allocated_qty || 0);
          itemMap.set(productKey, entry);
        });
      } else {
        sortedOrders.forEach((order: any) => {
          const items = Array.isArray(order?.OrderItems) ? order.OrderItems : [];
          items.forEach((item: any) => {
            const productKey = String(item?.product_id || item?.Product?.sku || item?.Product?.name || item?.id || '').trim();
            if (!productKey) return;
            const entry = itemMap.get(productKey) || { name: item?.Product?.name || 'Produk', qty: 0 };
            entry.qty += Number(item?.qty || 0);
            itemMap.set(productKey, entry);
          });
        });
      }

      const mergedItems = Array.from(itemMap.values()).sort((a, b) => b.qty - a.qty);
      const invoiceLabel = normalizeInvoiceRef(invoiceDetail?.invoice_number) || (bucket.invoiceNumber
        ? bucket.invoiceNumber
        : bucket.invoiceId
          ? bucket.invoiceId
          : `order-${primaryOrderId.slice(-8).toUpperCase()}`);

      return {
        key: bucket.key,
        scopeId,
        invoiceLabel,
        orderIds,
        customerName: primaryOrder?.customer_name || customer?.name || 'Customer',
        address,
        mergedItems,
      };
    });
  }, [invoiceDetailsById, orders]);

  useEffect(() => {
    if (!allowed) return;
    const next: Record<string, ChecklistMeta> = {};
    invoiceCards.forEach((card) => {
      if (!card.scopeId) return;
      next[card.scopeId] = getChecklistMeta(card.scopeId, card.orderIds);
    });
    setChecklistByScope(next);
  }, [allowed, invoiceCards]);

  const checklistCards = useMemo(() => invoiceCards.map((card) => {
    const meta = checklistByScope[card.scopeId] || { status: 'not_checked' };

    const badge = meta.status === 'ready'
      ? { label: 'Checklist OK', className: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle2 }
      : meta.status === 'mismatch'
        ? { label: 'Ada Selisih', className: 'bg-rose-100 text-rose-700 border-rose-200', icon: AlertTriangle }
        : { label: 'Belum Dicek', className: 'bg-amber-100 text-amber-700 border-amber-200', icon: ClipboardCheck };

    const BadgeIcon = badge.icon;
    const encodedScope = encodeURIComponent(card.scopeId);

    return (
      <div
        key={card.key}
        className="bg-white border border-slate-100 rounded-[28px] p-5 shadow-sm hover:shadow-xl hover:border-emerald-200 transition-all"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Invoice</p>
            <p className="text-lg font-black text-slate-900 leading-none">{card.invoiceLabel}</p>
            <p className="text-[10px] text-slate-500 mt-1">{card.orderIds.length} order digabung</p>
          </div>
          <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-black uppercase border ${badge.className}`}>
            <BadgeIcon size={12} />
            {badge.label}
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-50 space-y-2">
          <div className="flex items-center gap-2 text-slate-600">
            <User size={14} className="min-w-[14px] opacity-40" />
            <span className="text-xs font-bold line-clamp-1">{card.customerName}</span>
          </div>
          <div className="flex items-start gap-2 text-slate-600">
            <MapPin size={14} className="min-w-[14px] mt-0.5 opacity-40" />
            <span className="text-xs font-medium leading-relaxed line-clamp-2">{card.address}</span>
          </div>
          <div className="bg-slate-50 rounded-xl p-3 flex items-start gap-2 mt-1">
            <Package size={14} className="min-w-[14px] mt-0.5 text-slate-400" />
            <div className="flex-1">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Barang Invoice</p>
              <div className="text-xs font-medium text-slate-800 space-y-0.5">
                {card.mergedItems.slice(0, 3).map((item: any, idx: number) => (
                  <p key={`${item.name}-${idx}`}>{item.qty}x {item.name}</p>
                ))}
                {card.mergedItems.length > 3 && (
                  <p className="text-[10px] text-slate-400 italic">...dan {(card.mergedItems.length - 3)} produk lainnya</p>
                )}
                {card.mergedItems.length === 0 && <p className="text-slate-400 italic">Tidak ada item</p>}
              </div>
            </div>
          </div>
          {meta.savedAt && (
            <p className="text-[10px] text-slate-500">Terakhir disimpan: {new Date(meta.savedAt).toLocaleString('id-ID')}</p>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link
            href={`/driver/orders/${encodedScope}/checklist`}
            className="py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-black uppercase text-center"
          >
            Buka Checklist
          </Link>
          <Link
            href={`/driver/orders/${encodedScope}`}
            className="py-3 rounded-xl bg-white border border-slate-200 text-slate-700 text-[10px] font-black uppercase text-center"
          >
            Detail Invoice
          </Link>
        </div>
      </div>
    );
  }), [invoiceCards, checklistByScope]);

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-6 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] mb-1">Pengecekan</p>
          <h1 className="text-2xl font-black text-slate-900 leading-none">Checklist Invoice Sebelum Kirim</h1>
          <p className="text-xs text-slate-500 mt-2">Pastikan barang per invoice sudah sesuai sebelum pengantaran.</p>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-100 rounded-3xl p-10 text-center shadow-sm">
          <p className="text-sm font-bold text-slate-400 italic">Memuat daftar checklist...</p>
        </div>
      ) : invoiceCards.length === 0 ? (
        <div className="bg-white border border-slate-100 rounded-3xl p-10 text-center shadow-sm">
          <ClipboardCheck size={40} className="mx-auto text-slate-200 mb-3" />
          <p className="text-sm font-bold text-slate-400 italic">Belum ada invoice untuk dicek.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {checklistCards}
        </div>
      )}
    </div>
  );
}
