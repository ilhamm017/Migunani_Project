'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, User, Wallet, MapPin, Phone, Package, ChevronRight, RotateCcw, HandCoins, MessageCircle, ClipboardList, Truck } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { useOrderStatusNotifications } from '@/lib/useOrderStatusNotifications';
import { formatOrderStatusLabel } from '@/lib/orderStatusMeta';

export default function DriverTaskPage() {
  const allowed = useRequireRoles(['driver', 'super_admin', 'admin_gudang']);
  const [wallet, setWallet] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [returs, setReturs] = useState<any[]>([]);
  const { user } = useAuthStore();
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
  const remainingDeliveryCount = orders.filter((o) => !['delivered', 'completed', 'cancelled'].includes(String(o?.status || '').toLowerCase())).length;
  const remainingPickupCount = returs.filter((r) => !['handed_to_warehouse', 'approved', 'rejected'].includes(String(r?.status || '').toLowerCase())).length;
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
        api.driver.getReturs()
      ]);
      setOrders(Array.isArray(ordersRes.data) ? ordersRes.data : []);
      setWallet(walletRes.data);
      setReturs(Array.isArray(retursRes.data) ? retursRes.data : []);
    } catch (error) {
      console.error('Failed to load driver data:', error);
    }
  }, []);

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
              <p className="text-[11px] font-bold text-slate-600 inline-flex items-center gap-1.5">
                <RotateCcw size={13} className="text-amber-600" /> Pickup Retur: {remainingPickupCount}
              </p>
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
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">Misi Pengiriman ({orders.length})</h2>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {orders.length === 0 && (
            <div className="bg-white border border-slate-100 rounded-3xl p-10 text-center shadow-sm">
              <Box size={40} className="mx-auto text-slate-200 mb-3" />
              <p className="text-sm font-bold text-slate-400 italic">Belum ada tugas untuk Anda saat ini.</p>
            </div>
          )}
          {orders.map((o) => {
            const customer = o.Customer || {};
            const profile = customer.CustomerProfile || {};
            const addresses = Array.isArray(profile.saved_addresses) ? profile.saved_addresses : [];
            // Try to find primary, or take first
            const addressObj = addresses.find((a: any) => a.isPrimary) || addresses[0];
            const address = addressObj ? (addressObj.fullAddress || addressObj.address || 'Alamat tersimpan') : 'Alamat tidak tersedia';
            const whatsapp = customer.whatsapp_number || '-';

            return (
              <div
                key={o.id}
                className="group bg-white border border-slate-100 rounded-[28px] p-5 shadow-sm hover:shadow-xl hover:border-emerald-200 transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Order ID</p>
                    <p className="text-lg font-black text-slate-900 leading-none">#{o.id.slice(-8).toUpperCase()}</p>
                  </div>
                  <div className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-[10px] font-black uppercase">
                    {o.status}
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-slate-50 space-y-3">
                  {/* Customer Name */}
                  <div className="flex items-center gap-2 text-slate-600">
                    <User size={14} className="min-w-[14px] opacity-40" />
                    <span className="text-xs font-bold line-clamp-1">{o.customer_name || customer.name || 'Customer Umum'}</span>
                  </div>

                  {/* Address */}
                  <div className="flex items-start gap-2 text-slate-600">
                    <MapPin size={14} className="min-w-[14px] mt-0.5 opacity-40" />
                    <span className="text-xs font-medium leading-relaxed line-clamp-2">{address}</span>
                  </div>

                  {/* Phone */}
                  <div className="flex items-center gap-2 text-slate-600">
                    <Phone size={14} className="min-w-[14px] opacity-40" />
                    <span className="text-xs font-medium">{whatsapp}</span>
                  </div>

                  {/* Items Summary */}
                  <div className="bg-slate-50 rounded-xl p-3 flex items-start gap-2 mt-1">
                    <Package size={14} className="min-w-[14px] mt-0.5 text-slate-400" />
                    <div className="flex-1">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Barang Dikirim</p>
                      <div className="text-xs font-medium text-slate-800 space-y-0.5">
                        {(o.OrderItems || []).slice(0, 3).map((item: any, idx: number) => (
                          <p key={idx}>{item.qty}x {item.Product?.name || 'Produk'}</p>
                        ))}
                        {(o.OrderItems || []).length > 3 && (
                          <p className="text-[10px] text-slate-400 italic">...dan {(o.OrderItems.length - 3)} lainnya</p>
                        )}
                        {(o.OrderItems || []).length === 0 && <p className="text-slate-400 italic">Tidak ada item</p>}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Link
                    href={`/driver/orders/${o.id}/checklist`}
                    className="py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-black uppercase text-center"
                  >
                    Cek Barang
                  </Link>
                  <Link
                    href={`/driver/orders/${o.id}`}
                    className="py-3 rounded-xl bg-white border border-slate-200 text-slate-700 text-[10px] font-black uppercase inline-flex items-center justify-center gap-1"
                  >
                    Detail <ChevronRight size={14} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Return Task List */}
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
