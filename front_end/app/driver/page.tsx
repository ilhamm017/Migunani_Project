'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Bell, User, Wallet, MapPin, Package, ChevronRight, RotateCcw, MessageCircle, ClipboardList, Truck, Search, HandCoins, Phone } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { notifyFromAlertMessage, notifyOpen, notifySuccess } from '@/lib/notify';
import { useAuthStore } from '@/store/authStore';
import { useOrderStatusNotifications } from '@/lib/useOrderStatusNotifications';
import { formatOrderStatusLabel } from '@/lib/orderStatusMeta';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';
import type { DriverAssignedOrderRow, InvoiceDetailResponse } from '@/lib/apiTypes';

const normalizeInvoiceRef = (raw: unknown) => String(raw || '').trim();
const isDoneOrderStatus = (raw: unknown) => ['delivered', 'completed', 'partially_fulfilled', 'cancelled', 'canceled'].includes(String(raw || '').toLowerCase());
const getOrderInvoicePayload = (order?: DriverAssignedOrderRow | null) => {
  const latestInvoice = order?.Invoice || (Array.isArray(order?.Invoices) ? order.Invoices[0] : null) || null;
  return {
    id: normalizeInvoiceRef(order?.invoice_id || latestInvoice?.id),
    number: normalizeInvoiceRef(order?.invoice_number || latestInvoice?.invoice_number),
    total: Number(latestInvoice?.total || 0),
  };
};
const getInvoiceItems = (invoiceData?: InvoiceDetailResponse | null): any[] => {
  if (Array.isArray(invoiceData?.InvoiceItems)) return invoiceData.InvoiceItems as any[];
  if (Array.isArray(invoiceData?.Items)) return invoiceData.Items as any[];
  return [];
};

export default function DriverTaskPage() {
  const allowed = useRequireRoles(['driver', 'super_admin', 'admin_gudang']);
  const [wallet, setWallet] = useState<any>(null);
  const [orders, setOrders] = useState<DriverAssignedOrderRow[]>([]);
  const [invoiceDetailsById, setInvoiceDetailsById] = useState<Record<string, InvoiceDetailResponse | null | undefined>>({});
  const [returs, setReturs] = useState<any[]>([]);
  const [deliveryReturs, setDeliveryReturs] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [batchLoading, setBatchLoading] = useState(false);
  const batchProofInputRef = useRef<HTMLInputElement | null>(null);
  const pendingBatchIdsRef = useRef<string[]>([]);
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
          .map((row) => getOrderInvoicePayload(row).id)
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
        const nextMap: Record<string, InvoiceDetailResponse | null> = {};
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

  const invoiceCards = useMemo(() => {
    const buckets = orders.reduce((acc, order) => {
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
        orders: [] as DriverAssignedOrderRow[],
      };
      bucket.orders.push(order);
      acc.set(groupKey, bucket);
      return acc;
    }, new Map<string, { groupKey: string; invoiceId: string; invoiceNumber: string; orders: DriverAssignedOrderRow[] }>());

    const bucketValues = Array.from(buckets.values()) as Array<{
      groupKey: string;
      invoiceId: string;
      invoiceNumber: string;
      orders: DriverAssignedOrderRow[];
    }>;

    return bucketValues
      .map((bucket) => {
        const sortedOrders = [...bucket.orders].sort((a, b) => {
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
        const customerId = normalizeInvoiceRef((customer as any)?.id);
        const profile = customer.CustomerProfile || {};
        const addresses = Array.isArray(profile.saved_addresses) ? profile.saved_addresses : [];
        const addressObj = addresses.find((a: any) => a?.isPrimary) || addresses[0];
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
          sortedOrders.forEach((order) => {
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
        const activeOrderCount = sortedOrders.filter((order) => !isDoneOrderStatus(order?.status)).length;
        const invoiceTotalFromOrders = sortedOrders
          .map((row) => getOrderInvoicePayload(row).total)
          .find((value: number) => Number.isFinite(value) && value > 0);
        const invoiceTotalFromSnapshot = Number(invoiceDetail?.total || 0);
        const totalAmount = Number.isFinite(invoiceTotalFromSnapshot) && invoiceTotalFromSnapshot > 0
          ? invoiceTotalFromSnapshot
          : Number.isFinite(invoiceTotalFromOrders)
            ? Number(invoiceTotalFromOrders)
            : sortedOrders.reduce((sum: number, row) => sum + Number(row?.total_amount || 0), 0);
        const statusValues = Array.from(new Set(sortedOrders.map((order) => String(order?.status || '').trim()).filter(Boolean)));
        const statusLabel = statusValues.length <= 1 ? (statusValues[0] || '-') : `${statusValues.length} status`;
        const invoiceLabel = normalizeInvoiceRef(invoiceDetail?.invoice_number) || (bucket.invoiceNumber
          ? bucket.invoiceNumber
          : bucket.invoiceId
            ? bucket.invoiceId
            : `order-${primaryOrderId.slice(-8).toUpperCase()}`);

        return {
          groupKey: bucket.groupKey,
          targetId,
          deliveryId: targetId,
          invoiceId: bucket.invoiceId,
          invoiceLabel,
          orders: sortedOrders,
          primaryOrder,
          primaryOrderId,
          customerId,
          customerName: String((primaryOrder as any)?.customer_name || customer?.name || 'Customer Umum'),
          address,
          whatsapp,
          mergedItems,
          activeOrderCount,
          totalAmount,
          statusLabel,
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

  const filteredInvoiceCards = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return invoiceCards;
    return invoiceCards.filter((card) => {
      const orderIds = card.orders.map((order) => String(order?.id || '').toLowerCase());
      const itemNames = card.mergedItems.map((item) => String((item as any)?.name || '').toLowerCase());
      return [
        card.customerName,
        card.invoiceLabel,
        card.address,
        card.whatsapp,
        ...orderIds,
        ...itemNames,
      ].some((value) => String(value || '').toLowerCase().includes(keyword));
    });
  }, [invoiceCards, search]);

  const activeInvoiceCards = useMemo(
    () => filteredInvoiceCards.filter((card) => card.activeOrderCount > 0),
    [filteredInvoiceCards]
  );

  const activeDeliveryGroups = useMemo(() => {
    const groups = activeInvoiceCards.reduce((acc, card) => {
      const customerId = String((card as any).customerId || '').trim();
      const whatsapp = String(card.whatsapp || '').trim();
      const customerName = String(card.customerName || '').trim();
      const groupKey = customerId
        ? `cid:${customerId}`
        : whatsapp && whatsapp !== '-'
          ? `wa:${whatsapp}`
          : `name:${customerName.toLowerCase() || 'unknown'}`;

      const bucket = acc.get(groupKey) || {
        groupKey,
        customerId,
        customerName: customerName || 'Customer Umum',
        address: String(card.address || 'Alamat tidak tersedia'),
        whatsapp: whatsapp || '-',
        invoiceCards: [] as typeof activeInvoiceCards,
        totalAmount: 0,
        latestTs: 0,
      };
      bucket.invoiceCards.push(card);
      bucket.totalAmount += Number(card.totalAmount || 0);
      const ts = Date.parse(String(card.primaryOrder?.updatedAt || card.primaryOrder?.createdAt || ''));
      const val = Number.isFinite(ts) ? ts : 0;
      bucket.latestTs = Math.max(bucket.latestTs, val);
      acc.set(groupKey, bucket);
      return acc;
    }, new Map<string, { groupKey: string; customerId: string; customerName: string; address: string; whatsapp: string; invoiceCards: typeof activeInvoiceCards; totalAmount: number; latestTs: number }>());

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        invoiceCards: [...group.invoiceCards].sort((a, b) => {
          const aTs = Date.parse(String(a.primaryOrder?.updatedAt || a.primaryOrder?.createdAt || ''));
          const bTs = Date.parse(String(b.primaryOrder?.updatedAt || b.primaryOrder?.createdAt || ''));
          const aVal = Number.isFinite(aTs) ? aTs : 0;
          const bVal = Number.isFinite(bTs) ? bTs : 0;
          return bVal - aVal;
        }),
      }))
      .sort((a, b) => b.latestTs - a.latestTs);
  }, [activeInvoiceCards]);

  const remainingDeliveryCustomerCount = activeDeliveryGroups.length;
  const remainingDeliveryInvoiceCount = activeInvoiceCards.length;
  const activePickupReturs = useMemo(() => {
    if (!canMonitorReturTasks) return [];
    return returs.filter((r) =>
      !['handed_to_warehouse', 'approved', 'rejected'].includes(String(r?.status || '').toLowerCase())
    );
  }, [canMonitorReturTasks, returs]);
  const remainingPickupCount = activePickupReturs.length;
  const activeDeliveryReturs = useMemo(() => {
    if (!canMonitorReturTasks) return [];
    return deliveryReturs.filter((r) => String(r?.status || '').toLowerCase() === 'picked_up');
  }, [canMonitorReturTasks, deliveryReturs]);
  const remainingDeliveryReturCount = activeDeliveryReturs.length;
  const remainingDeliveryReturItemCount = useMemo(
    () => activeDeliveryReturs.reduce((sum, row) => sum + Number(row?.qty || 0), 0),
    [activeDeliveryReturs]
  );
  const remainingTaskCount = remainingDeliveryCustomerCount + remainingPickupCount + remainingDeliveryReturCount;
  const latestDriverEvent = latestEvents[0];
  const latestDriverStatusLabel = useMemo(
    () => (latestDriverEvent ? formatOrderStatusLabel(latestDriverEvent.to_status) : '-'),
    [latestDriverEvent]
  );

  const load = useCallback(async () => {
    try {
      const [ordersRes, walletRes, retursRes, deliveryRetursRes] = await Promise.all([
        api.driver.getOrders({ status: 'shipped' }),
        api.driver.getWallet(),
        canMonitorReturTasks ? api.driver.getReturs() : Promise.resolve({ data: [] }),
        canMonitorReturTasks ? api.driver.getDeliveryReturs() : Promise.resolve({ data: [] })
      ]);
      setOrders(Array.isArray(ordersRes.data) ? ordersRes.data : []);
      setWallet(walletRes.data);
      setReturs(Array.isArray(retursRes.data) ? retursRes.data : []);
      setDeliveryReturs(Array.isArray(deliveryRetursRes.data) ? deliveryRetursRes.data : []);
    } catch (error) {
      console.error('Failed to load driver data:', error);
    }
  }, [canMonitorReturTasks]);

  useEffect(() => {
    if (allowed) {
      Promise.resolve().then(() => {
        void load();
      });
    }
  }, [allowed, load]);

  useEffect(() => {
    if (allowed && latestEvents.length > 0) {
      Promise.resolve().then(() => {
        void load();
      });
    }
  }, [allowed, latestEvents.length, load]);

  useRealtimeRefresh({
    enabled: allowed,
    onRefresh: load,
    domains: ['order', 'retur', 'cod', 'admin'],
    pollIntervalMs: 12000,
    filterDriverIds: user?.id ? [String(user.id)] : [],
  });

  const startBatchComplete = useCallback((ids: string[]) => {
    const cleaned = Array.from(new Set((ids || []).map((v) => String(v || '').trim()).filter(Boolean)));
    if (cleaned.length === 0) {
      notifyOpen({ variant: 'warning', title: 'Perhatian', message: 'Tidak ada invoice yang bisa diproses.' });
      return;
    }
    if (batchLoading) return;
    if (!batchProofInputRef.current) return;
    pendingBatchIdsRef.current = cleaned;
    // Reset to allow selecting the same file twice.
    batchProofInputRef.current.value = '';
    batchProofInputRef.current.click();
  }, [batchLoading]);

  const handleBatchProofSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';

    const ids = pendingBatchIdsRef.current;
    pendingBatchIdsRef.current = [];

    if (!file || ids.length === 0) return;

    const confirmed = window.confirm(`Selesaikan pengiriman untuk ${ids.length} invoice?`);
    if (!confirmed) return;

    try {
      setBatchLoading(true);
      await api.driver.completeOrdersBatch(ids, { proof: file });
      notifySuccess(`Pengiriman selesai untuk ${ids.length} invoice.`);
      await load();
    } catch (error: any) {
      const message = String((error?.response?.data as any)?.message || error?.message || 'Gagal menyelesaikan pengiriman.');
      notifyFromAlertMessage(message);
    } finally {
      setBatchLoading(false);
    }
  }, [load]);

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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Wallet Card */}
        <div className="bg-slate-900 rounded-[32px] p-6 text-white shadow-xl shadow-slate-200 relative overflow-hidden">
          <div className="relative z-10">
            <p className="text-[10px] font-bold opacity-60 uppercase tracking-widest mb-1">Setoran COD Belum Disettle</p>
            <h3 className="text-3xl font-black">Rp {(wallet?.cash_on_hand || 0).toLocaleString('id-ID')}</h3>
            <p className="text-[10px] mt-3 bg-white/10 inline-block px-2 py-1 rounded-lg">
              Nilai ini menunjukkan COD yang masih dibawa driver atau masih menunggu settlement finance.
            </p>
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
                <Truck size={13} className="text-emerald-600" /> Pengiriman (Customer): {remainingDeliveryCustomerCount} <span className="text-slate-400 font-black">•</span> Invoice: {remainingDeliveryInvoiceCount}
              </p>
              {canMonitorReturTasks && (
                <p className="text-[11px] font-bold text-slate-600 inline-flex items-center gap-1.5">
                  <RotateCcw size={13} className="text-amber-600" /> Pickup Retur: {remainingPickupCount}
                </p>
              )}
              {canMonitorReturTasks && (
                <p className="text-[11px] font-bold text-slate-600 inline-flex items-center gap-1.5">
                  <RotateCcw size={13} className="text-rose-600" /> Retur Delivery: {remainingDeliveryReturCount}
                </p>
              )}
            </div>
          </div>
          <ClipboardList size={100} className="absolute -right-6 -bottom-6 text-slate-200" />
        </div>

        {/* Retur Info Card */}
        <div className="bg-amber-50 rounded-[32px] p-6 border border-amber-200 shadow-sm relative overflow-hidden">
          <div className="relative z-10">
            <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1">Barang Harus Diretur</p>
            <h3 className="text-3xl font-black text-amber-700">{remainingDeliveryReturCount}</h3>
            <p className="text-[11px] font-bold text-amber-800 mt-3">
              {remainingDeliveryReturCount > 0
                ? `Total ${remainingDeliveryReturItemCount} item retur delivery perlu diserahkan ke gudang.`
                : 'Tidak ada barang retur delivery yang perlu diserahkan.'}
            </p>
            {canMonitorReturTasks && remainingDeliveryReturCount > 0 && (
              <a
                href="#delivery-retur"
                className="btn-3d mt-4 inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-600 text-white px-4 py-3 text-[10px] font-black uppercase tracking-widest"
              >
                Di Sini
                <ChevronRight size={14} />
              </a>
            )}
          </div>
          <RotateCcw size={100} className="absolute -right-6 -bottom-6 text-amber-200" />
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
        <div className="bg-white border border-slate-200 rounded-[24px] p-4 shadow-sm">
          <label htmlFor="driver-search" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
            Cari Tugas Pengiriman
          </label>
	          <div className="relative">
	            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
	            <input
	              id="driver-search"
	              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cari invoice, customer, alamat, order ID, atau barang"
	              className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm text-slate-700 outline-none transition focus:border-emerald-300 focus:bg-white"
	            />
		        </div>
		      </div>

	        <div className="flex items-center justify-between px-1">
              <input
                ref={batchProofInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleBatchProofSelected}
              />
	            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                Misi Pengiriman ({activeDeliveryGroups.length} Customer • {activeInvoiceCards.length} Invoice)
              </h2>
              {batchLoading && (
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Memproses...</span>
              )}
	          </div>

	          <div className="grid grid-cols-1 gap-3">
	          {activeDeliveryGroups.length === 0 && (
	            <div className="bg-white border border-slate-100 rounded-3xl p-10 text-center shadow-sm">
	              <Package size={40} className="mx-auto text-slate-200 mb-3" />
	              <p className="text-sm font-bold text-slate-400 italic">
	                {search.trim() ? 'Tidak ada tugas yang cocok dengan pencarian ini.' : 'Belum ada tugas yang siap dikirim.'}
	              </p>
	            </div>
	          )}
	          {activeDeliveryGroups.map((group) => {
              const deliveryIds = group.invoiceCards
                .map((row: any) => String(row?.invoiceId || row?.deliveryId || '').trim())
                .filter(Boolean);
              const customerId = String((group as any)?.customerId || '').trim();
              const whatsapp = String(group.whatsapp || '-');

	            return (
	              <div
	                key={group.groupKey}
	                className="group bg-white border border-slate-100 rounded-[24px] p-4 shadow-sm hover:shadow-lg hover:border-emerald-200 transition-all"
	              >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Customer</p>
                      <p className="text-base font-black text-slate-900 leading-none">{group.customerName}</p>
                      <p className="text-[10px] text-slate-500">{group.invoiceCards.length} invoice</p>
                    </div>
                    <div className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-[10px] font-black uppercase">
                      Total Rp {Number(group.totalAmount || 0).toLocaleString('id-ID')}
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-50 space-y-2.5">
                    <div className="flex items-start gap-2 text-slate-600">
                      <MapPin size={14} className="min-w-[14px] mt-0.5 opacity-40" />
                      <span className="text-[11px] font-medium leading-snug line-clamp-2">{group.address}</span>
                    </div>
                    <div className="flex items-center gap-2 text-slate-600">
                      <Phone size={14} className="min-w-[14px] opacity-40" />
                      <span className="text-[11px] font-bold">{whatsapp}</span>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-50 space-y-2">
                    {group.invoiceCards.map((card: any) => {
                      const deliveryId = String(card?.deliveryId || '').trim();
                      const invoiceHref = deliveryId ? `/driver/invoices/${encodeURIComponent(deliveryId)}` : '#';
                      return (
                        <div
                          key={card.groupKey}
                          className="flex items-center justify-between gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-black text-slate-900 truncate">{card.invoiceLabel}</p>
                            <p className="text-[10px] text-slate-500 truncate">
                              {card.orders.length} order • Rp {Number(card.totalAmount || 0).toLocaleString('id-ID')} • {card.statusLabel}
                            </p>
                          </div>
                          <Link
                            href={invoiceHref}
                            className="shrink-0 px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-[10px] font-black uppercase inline-flex items-center justify-center gap-1"
                          >
                            Detail Invoice <ChevronRight size={14} />
                          </Link>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    {customerId && (
                      <Link
                        href={`/driver/orders/${encodeURIComponent(customerId)}`}
                        className="px-3 py-2 rounded-xl text-[10px] font-black uppercase border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60 inline-flex items-center gap-1"
                      >
                        Detail Customer <ChevronRight size={14} />
                      </Link>
                    )}
                    <button
                      type="button"
                      disabled={batchLoading || deliveryIds.length === 0}
                      onClick={() => startBatchComplete(deliveryIds)}
                      className="flex-1 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase inline-flex items-center justify-center gap-1 disabled:opacity-60"
                    >
                      Kirim Semua Invoice ({deliveryIds.length})
                    </button>
                  </div>
	              </div>
	            );
	          })}
	        </div>
      </div>

      {canMonitorReturTasks && (
        <div id="pickup-retur" className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-black text-amber-500 uppercase tracking-widest flex items-center gap-2">
              <RotateCcw size={14} /> Misi Penjemputan Retur (Customer Request) ({returs.length})
            </h2>
          </div>
          <p className="text-[11px] font-bold text-slate-500 px-1">
            Retur saat pengiriman (tidak jadi beli / rusak) diproses dari detail invoice dan diserahkan ke Admin/Kasir.
          </p>

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
              const addressObj = addresses.find((a: any) => a?.isPrimary) || addresses[0];
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
                      <HandCoins size={10} /> Pickup Retur
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

      {canMonitorReturTasks && (
        <div id="delivery-retur" className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-black text-rose-600 uppercase tracking-widest flex items-center gap-2">
              <RotateCcw size={14} className="text-rose-600" /> Retur Delivery (Bawa ke Gudang) ({activeDeliveryReturs.length})
            </h2>
          </div>
          <p className="text-[11px] font-bold text-slate-500 px-1">
            Barang yang sudah dibawa driver karena retur saat pengiriman. Serahkan fisik barang ke gudang, admin akan verifikasi.
          </p>

          <div className="grid grid-cols-1 gap-3">
            {activeDeliveryReturs.length === 0 && (
              <div className="bg-white border border-slate-100 rounded-3xl p-10 text-center shadow-sm">
                <RotateCcw size={40} className="mx-auto text-slate-200 mb-3" />
                <p className="text-sm font-bold text-slate-400 italic">Tidak ada retur delivery.</p>
              </div>
            )}
            {activeDeliveryReturs.map((r) => {
              const productName = String(r?.Product?.name || 'Produk').trim();
              const qty = Number(r?.qty || 0);
              const orderId = String(r?.order_id || r?.Order?.id || '').trim();
              const invoiceId = String(r?.invoice_id || '').trim();
              const invoiceNumber = String(r?.invoice_number || '').trim();
              const returType = String(r?.retur_type || '').trim();
              const typeLabel = returType === 'delivery_damage' ? 'Rusak' : 'Tidak Jadi';
              const href = invoiceId
                ? `/driver/invoices/${invoiceId}`
                : orderId
                  ? `/driver/invoices/${orderId}`
                  : '/driver';

              return (
                <Link
                  key={String(r?.id || `${orderId}-${productName}`)}
                  href={href}
                  className="group block bg-white border-2 border-rose-100 rounded-[28px] p-5 shadow-sm hover:shadow-xl hover:border-rose-300 transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-[10px] font-black text-rose-600 uppercase tracking-tighter">RETUR Delivery ({typeLabel})</p>
                      <p className="text-lg font-black text-slate-900 leading-none">{productName}</p>
                    </div>
                    <div className="px-3 py-1 bg-rose-50 text-rose-700 rounded-full text-[10px] font-black uppercase flex items-center gap-1">
                      <Package size={10} /> Qty {qty}
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-slate-50 space-y-2">
                    {invoiceNumber && (
                      <p className="text-xs font-black text-slate-700">Invoice: {invoiceNumber}</p>
                    )}
                    {!invoiceNumber && invoiceId && (
                      <p className="text-xs font-black text-slate-700">Invoice: INV-{invoiceId.slice(-8).toUpperCase()}</p>
                    )}
                    {!invoiceId && orderId && (
                      <p className="text-xs font-black text-slate-700">Order: #{orderId.slice(-8).toUpperCase()}</p>
                    )}
                    <p className="text-[10px] font-bold text-slate-500">Status: {String(r?.status || '-')}</p>
                  </div>

                  <div className="mt-4 flex items-center justify-between text-rose-600 font-black text-[10px] uppercase tracking-widest">
                    <span className="flex items-center gap-1 bg-slate-900 text-white px-3 py-2 rounded-xl">
                      <MessageCircle size={12} /> Buka Detail Invoice
                    </span>
                    <span className="flex items-center gap-1 italic opacity-60">Klik untuk lihat rincian</span>
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
          onClick={() => {
            notifyOpen({ variant: 'info', title: 'Update Pesanan', message: activeToast });
            dismissToast();
          }}
          className="fixed right-4 bottom-28 z-50 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-700 shadow-lg hover:bg-emerald-50"
        >
          <Bell size={16} />
          <span>Update Pesanan</span>
          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-label="Ada notifikasi" />
        </button>
      )}
    </div>
  );
}
