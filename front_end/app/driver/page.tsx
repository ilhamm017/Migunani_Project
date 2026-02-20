'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, User, Wallet, MapPin, Phone, Package, ChevronRight, RotateCcw, HandCoins, MessageCircle, ClipboardList, Truck, ClipboardCheck } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { useOrderStatusNotifications } from '@/lib/useOrderStatusNotifications';
import { formatOrderStatusLabel } from '@/lib/orderStatusMeta';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';

const normalizeInvoiceRef = (raw: unknown) => String(raw || '').trim();
const isDoneOrderStatus = (raw: unknown) => ['delivered', 'completed', 'cancelled', 'canceled'].includes(String(raw || '').toLowerCase());
const getOrderInvoicePayload = (order: any) => {
  const latestInvoice = order?.Invoice || (Array.isArray(order?.Invoices) ? order.Invoices[0] : null) || null;
  return {
    id: normalizeInvoiceRef(order?.invoice_id || latestInvoice?.id),
    number: normalizeInvoiceRef(order?.invoice_number || latestInvoice?.invoice_number),
    total: Number(latestInvoice?.total || 0),
  };
};
const getInvoiceItems = (invoiceData: any) => {
  if (Array.isArray(invoiceData?.InvoiceItems)) return invoiceData.InvoiceItems;
  if (Array.isArray(invoiceData?.Items)) return invoiceData.Items;
  return [];
};

const checklistScopeStorageKey = (scopeId: string) => `driver-checklist-scope-${scopeId}`;
const getChecklistStatus = (scopeId: string): 'not_checked' | 'mismatch' | 'ready' => {
  if (typeof window === 'undefined' || !scopeId) return 'not_checked';
  const raw = sessionStorage.getItem(checklistScopeStorageKey(scopeId));
  if (!raw) return 'not_checked';
  try {
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
    if (rows.length === 0) return 'not_checked';
    const hasMismatch = rows.some((row: any) => Number(row?.actualQty || 0) !== Number(row?.expectedQty || 0));
    return hasMismatch ? 'mismatch' : 'ready';
  } catch {
    return 'not_checked';
  }
};

export default function DriverTaskPage() {
  const allowed = useRequireRoles(['driver', 'super_admin', 'admin_gudang']);
  const [wallet, setWallet] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [invoiceDetailsById, setInvoiceDetailsById] = useState<Record<string, any>>({});
  const [returs, setReturs] = useState<any[]>([]);
  const { user } = useAuthStore();
  const canMonitorReturTasks = ['driver', 'super_admin'].includes(String(user?.role || ''));
  const {
    newTaskCount,
    latestEvents,
    markSeen,
    activeToast,
    dismissToast,
  } = useOrderStatusNotifications({
    enabled: !!allowed,
    role: user?.role,
    userId: user?.id,
  });
  useEffect(() => {
    if (!allowed) return;
    const invoiceIds = Array.from(
      new Set(
        orders
          .map((row: any) => getOrderInvoicePayload(row).id)
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
          console.error('Failed to load invoice snapshot for driver page:', error);
        }
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [allowed, orders]);

  const deliveryCards = useMemo(() => {
    const buckets = orders.reduce((acc, order: any) => {
      const orderId = String(order?.id || '').trim();
      if (!orderId) return acc;
      const invoiceData = getOrderInvoicePayload(order);
      const invoiceId = invoiceData.id;
      const invoiceNumber = invoiceData.number;
      const groupKey = invoiceId ? `id:${invoiceId}` : invoiceNumber ? `num:${invoiceNumber.toLowerCase()}` : `order:${orderId}`;
      const bucket = acc.get(groupKey) || {
        groupKey,
        invoiceId,
        invoiceNumber,
        orders: [] as any[],
      };
      bucket.orders.push(order);
      acc.set(groupKey, bucket);
      return acc;
    }, new Map<string, { groupKey: string; invoiceId: string; invoiceNumber: string; orders: any[] }>());

    const bucketValues = Array.from(buckets.values()) as Array<{
      groupKey: string;
      invoiceId: string;
      invoiceNumber: string;
      orders: any[];
    }>;

    return bucketValues
      .map((bucket) => {
        const sortedOrders = [...bucket.orders].sort((a: any, b: any) => {
          const bTs = Date.parse(String(b?.updatedAt || b?.createdAt || ''));
          const aTs = Date.parse(String(a?.updatedAt || a?.createdAt || ''));
          const bVal = Number.isFinite(bTs) ? bTs : 0;
          const aVal = Number.isFinite(aTs) ? aTs : 0;
          return bVal - aVal;
        });
        const primaryOrder = sortedOrders[0] || null;
        const primaryOrderId = String(primaryOrder?.id || '').trim();
        const targetId = bucket.invoiceId || primaryOrderId;
        const invoiceDetail = bucket.invoiceId ? invoiceDetailsById[bucket.invoiceId] : null;

        const customer = primaryOrder?.Customer || {};
        const profile = customer.CustomerProfile || {};
        const addresses = Array.isArray(profile.saved_addresses) ? profile.saved_addresses : [];
        const addressObj = addresses.find((a: any) => a.isPrimary) || addresses[0];
        const address = addressObj ? (addressObj.fullAddress || addressObj.address || 'Alamat tersimpan') : 'Alamat tidak tersedia';
        const whatsapp = customer.whatsapp_number || '-';

        const itemMap = new Map<string, { name: string; qty: number }>();
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
        } else {
          sortedOrders.forEach((order: any) => {
            const items = Array.isArray(order?.OrderItems) ? order.OrderItems : [];
            items.forEach((item: any) => {
              const key = String(item?.product_id || item?.Product?.sku || item?.Product?.name || item?.id || '').trim();
              if (!key) return;
              const prev = itemMap.get(key) || { name: item?.Product?.name || 'Produk', qty: 0 };
              prev.qty += Number(item?.qty || 0);
              itemMap.set(key, prev);
            });
          });
        }

        const mergedItems = Array.from(itemMap.values()).sort((a, b) => b.qty - a.qty);
        const activeOrderCount = sortedOrders.filter((order: any) => !isDoneOrderStatus(order?.status)).length;
        const invoiceTotalFromOrders = sortedOrders
          .map((row: any) => getOrderInvoicePayload(row).total)
          .find((value: number) => Number.isFinite(value) && value > 0);
        const invoiceTotalFromSnapshot = Number(invoiceDetail?.total || 0);
        const totalAmount = Number.isFinite(invoiceTotalFromSnapshot) && invoiceTotalFromSnapshot > 0
          ? invoiceTotalFromSnapshot
          : Number.isFinite(invoiceTotalFromOrders)
            ? Number(invoiceTotalFromOrders)
            : sortedOrders.reduce((sum: number, row: any) => sum + Number(row?.total_amount || 0), 0);
        const statusValues = Array.from(new Set(sortedOrders.map((order: any) => String(order?.status || '').trim()).filter(Boolean)));
        const statusLabel = statusValues.length <= 1 ? (statusValues[0] || '-') : `${statusValues.length} status`;
        const invoiceLabel = normalizeInvoiceRef(invoiceDetail?.invoice_number) || (bucket.invoiceNumber
          ? bucket.invoiceNumber
          : bucket.invoiceId
            ? bucket.invoiceId
            : `order-${primaryOrderId.slice(-8).toUpperCase()}`);

        return {
          groupKey: bucket.groupKey,
          targetId,
          invoiceId: bucket.invoiceId,
          invoiceLabel,
          orders: sortedOrders,
          primaryOrder,
          primaryOrderId,
          customerName: primaryOrder?.customer_name || customer?.name || 'Customer Umum',
          address,
          whatsapp,
          mergedItems,
          activeOrderCount,
          totalAmount,
          statusLabel,
          checklistStatus: getChecklistStatus(targetId),
        };
      })
      .sort((a, b) => {
        const aTs = Date.parse(String(a.primaryOrder?.updatedAt || a.primaryOrder?.createdAt || ''));
        const bTs = Date.parse(String(b.primaryOrder?.updatedAt || b.primaryOrder?.createdAt || ''));
        const aVal = Number.isFinite(aTs) ? aTs : 0;
        const bVal = Number.isFinite(bTs) ? bTs : 0;
        return bVal - aVal;
      });
  }, [invoiceDetailsById, orders]);

  const readyDeliveryCards = useMemo(() => deliveryCards.filter(card => card.checklistStatus === 'ready'), [deliveryCards]);
  const pendingChecklistCount = useMemo(() => deliveryCards.filter(card => card.checklistStatus !== 'ready').length, [deliveryCards]);

  const remainingDeliveryCount = readyDeliveryCards.filter((card) => card.activeOrderCount > 0).length;
  const remainingPickupCount = canMonitorReturTasks
    ? returs.filter((r) => !['handed_to_warehouse', 'approved', 'rejected'].includes(String(r?.status || '').toLowerCase())).length
    : 0;
  const remainingTaskCount = remainingDeliveryCount + remainingPickupCount;
  const latestDriverEvent = latestEvents[0];
  const latestDriverStatusLabel = useMemo(
    () => (latestDriverEvent ? formatOrderStatusLabel(latestDriverEvent.to_status) : '-'),
    [latestDriverEvent]
  );

  const load = useCallback(async () => {
    try {
      const [ordersRes, walletRes, retursRes] = await Promise.all([
        api.driver.getOrders(),
        api.driver.getWallet(),
        canMonitorReturTasks ? api.driver.getReturs() : Promise.resolve({ data: [] })
      ]);
      setOrders(Array.isArray(ordersRes.data) ? ordersRes.data : []);
      setWallet(walletRes.data);
      setReturs(Array.isArray(retursRes.data) ? retursRes.data : []);
    } catch (error) {
      console.error('Failed to load driver data:', error);
    }
  }, [canMonitorReturTasks]);

  useEffect(() => {
    if (allowed) {
      void load();
    }
  }, [allowed, load]);

  useEffect(() => {
    if (allowed && latestEvents.length > 0) {
      void load();
    }
  }, [allowed, latestEvents.length, load]);

  useRealtimeRefresh({
    enabled: allowed,
    onRefresh: load,
    domains: ['order', 'retur', 'cod', 'admin'],
    pollIntervalMs: 12000,
    filterDriverIds: user?.id ? [String(user.id)] : [],
  });

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-6 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] mb-1">Driver Partner</p>
          <h1 className="text-2xl font-black text-slate-900 leading-none">Halo, {user?.name}</h1>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Wallet Card */}
        <div className="bg-slate-900 rounded-[32px] p-6 text-white shadow-xl shadow-slate-200 relative overflow-hidden">
          <div className="relative z-10">
            <p className="text-[10px] font-bold opacity-60 uppercase tracking-widest mb-1">Utang COD ke Finance</p>
            <h3 className="text-3xl font-black">Rp {(wallet?.cash_on_hand || 0).toLocaleString('id-ID')}</h3>
            <p className="text-[10px] mt-3 bg-white/10 inline-block px-2 py-1 rounded-lg">Nilai ini sinkron dengan dashboard Finance</p>
          </div>
          <Wallet size={100} className="absolute -right-6 -bottom-6 opacity-10" />
        </div>

        {/* Remaining Tasks Card */}
        <div className="bg-white rounded-[32px] p-6 border border-slate-200 shadow-sm relative overflow-hidden">
          <div className="relative z-10">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Sisa Tugas Aktif</p>
            <h3 className="text-3xl font-black text-slate-900">{remainingTaskCount}</h3>
            <div className="mt-3 space-y-1">
              <p className="text-[11px] font-bold text-slate-600 inline-flex items-center gap-1.5">
                <Truck size={13} className="text-emerald-600" /> Pengiriman: {remainingDeliveryCount}
              </p>
              {canMonitorReturTasks && (
                <p className="text-[11px] font-bold text-slate-600 inline-flex items-center gap-1.5">
                  <RotateCcw size={13} className="text-amber-600" /> Pickup Retur: {remainingPickupCount}
                </p>
              )}
            </div>
          </div>
          <ClipboardList size={100} className="absolute -right-6 -bottom-6 text-slate-200" />
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-[24px] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Notifikasi Tugas Baru</p>
            <p className="text-xs font-semibold text-blue-700 mt-1">
              {newTaskCount > 0
                ? `${newTaskCount} tugas baru. Status terbaru: ${latestDriverStatusLabel}`
                : 'Belum ada notifikasi tugas baru.'}
            </p>
          </div>
          <button
            type="button"
            onClick={markSeen}
            className="px-3 py-2 rounded-xl text-[10px] font-black uppercase border border-blue-300 text-blue-700 bg-white hover:bg-blue-100"
          >
            Tandai Dilihat
          </button>
        </div>
        {latestEvents.length > 0 && (
          <div className="mt-3 space-y-1">
            {latestEvents.slice(0, 2).map((event) => (
              <p key={`${event.order_id}-${event.triggered_at}`} className="text-[11px] font-semibold text-blue-700">
                #{String(event.order_id).slice(-8).toUpperCase()} {'->'} {formatOrderStatusLabel(event.to_status)}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Task List */}
      <div className="space-y-4">
        {pendingChecklistCount > 0 && (
          <div className="bg-amber-50 border-2 border-amber-200 rounded-[24px] p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="bg-amber-100 p-2 rounded-xl text-amber-600">
                <ClipboardCheck size={20} />
              </div>
              <div className="flex-1">
                <p className="text-xs font-black text-amber-700 uppercase tracking-widest">Lakukan Checklist</p>
                <p className="text-[11px] font-semibold text-amber-600 mt-1">
                  Ada {pendingChecklistCount} invoice yang perlu dicek barangnya sebelum muncul di daftar tugas.
                </p>
              </div>
              <Link
                href="/driver/precheck"
                className="px-4 py-2 bg-amber-600 text-white text-[10px] font-black uppercase rounded-xl"
              >
                Ke Checklist
              </Link>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">Misi Pengiriman ({readyDeliveryCards.length} Invoice Ready)</h2>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {readyDeliveryCards.length === 0 && (
            <div className="bg-white border border-slate-100 rounded-3xl p-10 text-center shadow-sm">
              <Package size={40} className="mx-auto text-slate-200 mb-3" />
              <p className="text-sm font-bold text-slate-400 italic">Belum ada tugas yang siap dikirim.</p>
              {pendingChecklistCount > 0 && (
                <p className="text-[11px] text-slate-400 mt-2">Selesaikan checklist terlebih dahulu agar tugas muncul di sini.</p>
              )}
            </div>
          )}
          {readyDeliveryCards.map((card) => {
            return (
              <div
                key={card.groupKey}
                className="group bg-white border border-slate-100 rounded-[28px] p-5 shadow-sm hover:shadow-xl hover:border-emerald-200 transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Invoice</p>
                    <p className="text-lg font-black text-slate-900 leading-none">{card.invoiceLabel}</p>
                    <p className="text-[10px] text-slate-500">
                      {card.orders.length} order
                      {card.orders.length > 1 ? ` (${card.orders.map((row: any) => `#${String(row?.id || '').slice(-6)}`).join(', ')})` : ''}
                    </p>
                  </div>
                  <div className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-[10px] font-black uppercase">
                    {card.statusLabel}
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-slate-50 space-y-3">
                  {/* Customer Name */}
                  <div className="flex items-center gap-2 text-slate-600">
                    <User size={14} className="min-w-[14px] opacity-40" />
                    <span className="text-xs font-bold line-clamp-1">{card.customerName}</span>
                  </div>

                  {/* Address */}
                  <div className="flex items-start gap-2 text-slate-600">
                    <MapPin size={14} className="min-w-[14px] mt-0.5 opacity-40" />
                    <span className="text-xs font-medium leading-relaxed line-clamp-2">{card.address}</span>
                  </div>

                  {/* Phone */}
                  <div className="flex items-center gap-2 text-slate-600">
                    <Phone size={14} className="min-w-[14px] opacity-40" />
                    <span className="text-xs font-medium">{card.whatsapp}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-600">
                    <Wallet size={14} className="min-w-[14px] opacity-40" />
                    <span className="text-xs font-bold">Total {card.totalAmount.toLocaleString('id-ID')}</span>
                  </div>

                  {/* Items Summary */}
                  <div className="bg-slate-50 rounded-xl p-3 flex items-start gap-2 mt-1">
                    <Package size={14} className="min-w-[14px] mt-0.5 text-slate-400" />
                    <div className="flex-1">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Barang Dikirim (Gabungan Invoice)</p>
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
                </div>

                <div className="mt-4">
                  <Link
                    href={`/driver/orders/${card.targetId}`}
                    className="w-full py-3 rounded-xl bg-white border border-slate-200 text-slate-700 text-[10px] font-black uppercase inline-flex items-center justify-center gap-1"
                  >
                    Detail Invoice <ChevronRight size={14} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {canMonitorReturTasks && (
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-black text-amber-500 uppercase tracking-widest flex items-center gap-2">
              <RotateCcw size={14} /> Misi Penjemputan Retur ({returs.length})
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {returs.length === 0 && (
              <div className="bg-white border border-slate-100 rounded-3xl p-10 text-center shadow-sm">
                <RotateCcw size={40} className="mx-auto text-slate-200 mb-3" />
                <p className="text-sm font-bold text-slate-400 italic">Tidak ada jemputan retur.</p>
              </div>
            )}
            {returs.map((r) => {
              const customer = r.Creator || {};
              const profile = customer.CustomerProfile || {};
              const addresses = Array.isArray(profile.saved_addresses) ? profile.saved_addresses : [];
              const addressObj = addresses.find((a: any) => a.isPrimary) || addresses[0];
              const address = addressObj ? (addressObj.fullAddress || addressObj.address || 'Alamat tersimpan') : 'Alamat tidak tersedia';
              const whatsapp = customer.whatsapp_number || '-';

              return (
                <Link
                  key={r.id}
                  href={`/driver/retur/${r.id}`}
                  className="group block bg-white border-2 border-amber-100 rounded-[28px] p-5 shadow-sm hover:shadow-xl hover:border-amber-300 transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-[10px] font-black text-amber-500 uppercase tracking-tighter">RETUR Pesanan</p>
                      <p className="text-lg font-black text-slate-900 leading-none">#{r.order_id.slice(-8).toUpperCase()}</p>
                    </div>
                    <div className="px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-[10px] font-black uppercase flex items-center gap-1">
                      <HandCoins size={10} /> Verifikasi Dana (CS)
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-slate-50 space-y-3">
                    <div className="flex items-center gap-2 text-slate-600">
                      <User size={14} className="min-w-[14px] opacity-40" />
                      <span className="text-xs font-bold line-clamp-1">{customer.name || 'Customer'}</span>
                    </div>

                    <div className="flex items-start gap-2 text-slate-600">
                      <MapPin size={14} className="min-w-[14px] mt-0.5 opacity-40" />
                      <span className="text-xs font-medium leading-relaxed line-clamp-2">{address}</span>
                    </div>

                    <div className="flex items-center gap-2 text-slate-600">
                      <Phone size={14} className="min-w-[14px] opacity-40" />
                      <span className="text-xs font-medium">{whatsapp}</span>
                    </div>

                    <div className="bg-amber-50/50 rounded-xl p-3 flex items-start gap-2 mt-1 border border-amber-100">
                      <Package size={14} className="min-w-[14px] mt-0.5 text-amber-600" />
                      <div className="flex-1">
                        <p className="text-[10px] font-black text-amber-600 uppercase tracking-wide mb-1">Barang Diambil</p>
                        <p className="text-xs font-black text-slate-800">{r.qty}x {r.Product?.name || 'Produk'}</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between text-amber-600 font-black text-[10px] uppercase tracking-widest">
                    <span className="flex items-center gap-1 bg-slate-900 text-white px-3 py-2 rounded-xl">
                      <MessageCircle size={12} /> Buka Detail Tugas
                    </span>
                    <span className="flex items-center gap-1 italic opacity-60">Status: {r.status}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {activeToast && (
        <button
          type="button"
          onClick={dismissToast}
          className="fixed right-4 bottom-28 z-50 max-w-[320px] rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-left shadow-lg"
        >
          <p className="text-[11px] font-black uppercase tracking-widest text-emerald-700">Update Pesanan</p>
          <p className="text-xs font-semibold text-emerald-700 mt-1">{activeToast}</p>
        </button>
      )}
    </div>
  );
}
