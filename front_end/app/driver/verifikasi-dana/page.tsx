'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CreditCard, HandCoins, MapPin, Search, Truck, User, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { useAuthStore } from '@/store/authStore';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';
import type { DriverAssignedOrderRow } from '@/lib/apiTypes';

const formatCurrency = (value: number) =>
  `Rp ${Number.isFinite(value) ? value.toLocaleString('id-ID') : '0'}`;

export default function DriverVerifikasiDanaPage() {
  const allowed = useRequireRoles(['driver', 'super_admin']);
  const { user } = useAuthStore();
  const [wallet, setWallet] = useState<Record<string, any> | null>(null);
  const [orders, setOrders] = useState<DriverAssignedOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    try {
      if (!silent) setLoading(true);
      const [walletRes, ordersRes] = await Promise.all([
        api.driver.getWallet(),
        api.driver.getOrders({ status: 'shipped,delivered,completed' }),
      ]);
      setWallet(walletRes.data || null);
      setOrders(Array.isArray(ordersRes.data) ? ordersRes.data : []);
    } catch (error) {
      console.error('Failed to load driver COD finance handover tasks:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) {
      void load();
    }
  }, [allowed, load]);

  useRealtimeRefresh({
    enabled: allowed,
    onRefresh: () => load({ silent: true }),
    domains: ['order', 'cod', 'admin'],
    pollIntervalMs: 12000,
    filterDriverIds: user?.id ? [String(user.id)] : [],
  });

  const codCards = useMemo(() => {
    const buckets = new Map<string, {
      key: string;
      invoiceNumber: string;
      amount: number;
      orders: DriverAssignedOrderRow[];
      customerName: string;
      address: string;
      status: string;
    }>();

    orders.forEach((order) => {
      const invoice = order?.Invoice || (Array.isArray(order?.Invoices) ? order.Invoices[0] : null) || null;
      const paymentMethod = String(invoice?.payment_method || order?.payment_method || '').toLowerCase();
      const paymentStatus = String(invoice?.payment_status || order?.payment_status || '').toLowerCase();
      if (paymentMethod !== 'cod' || paymentStatus !== 'cod_pending') return;

      const invoiceId = String(invoice?.id || order?.invoice_id || order?.id || '').trim();
      const invoiceNumber = String(invoice?.invoice_number || order?.invoice_number || invoiceId).trim();
      const bucket = buckets.get(invoiceId) || {
        key: invoiceId,
        invoiceNumber,
        amount: Number(invoice?.amount_paid || invoice?.total || order?.total_amount || 0),
        orders: [],
        customerName: String(order?.customer_name || order?.Customer?.name || 'Customer'),
        address: String(order?.shipping_address || '').trim(),
        status: String(order?.status || '').trim(),
      };
      bucket.orders.push(order);
      if (!bucket.address) {
        const profile = order?.Customer?.CustomerProfile || {};
        const addresses = Array.isArray(profile?.saved_addresses) ? profile.saved_addresses : [];
        const addressObj = addresses.find((row: any) => Boolean(row?.isPrimary)) || addresses[0] || null;
        bucket.address = String(addressObj?.fullAddress || addressObj?.address || '').trim();
      }
      buckets.set(invoiceId, bucket);
    });

    return Array.from(buckets.values()).sort((a, b) => b.amount - a.amount);
  }, [orders]);

  const filteredCodCards = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return codCards;
    return codCards.filter((card) => {
      const orderIds = card.orders.map((order) => String(order?.real_order_id || order?.id || '').toLowerCase());
      return [
        card.invoiceNumber,
        card.customerName,
        card.address,
        ...orderIds,
      ].some((value) => String(value || '').toLowerCase().includes(keyword));
    });
  }, [codCards, search]);

  const activeCodAmount = useMemo(
    () => filteredCodCards.reduce((sum, card) => sum + Number(card.amount || 0), 0),
    [filteredCodCards]
  );

  if (!allowed) return null;

  return (
    <div className="p-6 pb-24 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black text-amber-600 uppercase tracking-[0.2em] mb-1">Driver Partner</p>
          <h1 className="text-2xl font-black text-slate-900 leading-none">Verifikasi Dana (CS)</h1>
          <p className="text-xs text-slate-500 mt-2">Fokus ke invoice COD yang sudah selesai dikirim dan harus diserahkan ke admin finance.</p>
        </div>
        <div className="px-4 py-3 rounded-[24px] bg-amber-50 border border-amber-200 min-w-[108px] text-right">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-600">COD Pending</p>
          <p className="text-2xl font-black text-amber-700">{filteredCodCards.length}</p>
          <p className="mt-1 text-[10px] font-bold text-amber-700">{formatCurrency(activeCodAmount)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-[24px] p-4 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Setoran COD Belum Disettle</p>
          <p className="text-2xl font-black text-slate-900">{formatCurrency(Number(wallet?.cash_on_hand || 0))}</p>
          <p className="text-[11px] text-slate-500 mt-2">Nilai COD yang masih dibawa driver atau masih menunggu settlement finance.</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-[24px] p-4 shadow-sm">
          <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-1">Tugas Finance</p>
          <p className="text-sm font-black text-amber-800">Serahkan uang COD yang sudah diterima customer ke admin finance.</p>
          <p className="text-[11px] text-amber-700 mt-2">Halaman ini tidak lagi menampilkan pickup retur. Pickup retur kembali ke menu Tugas.</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-[24px] p-4 shadow-sm">
        <label htmlFor="driver-retur-search" className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
          Cari Invoice COD
        </label>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            id="driver-retur-search"
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cari invoice, customer, alamat, atau order ID"
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm text-slate-700 outline-none transition focus:border-amber-300 focus:bg-white"
          />
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-black text-amber-500 uppercase tracking-widest flex items-center gap-2">
            <HandCoins size={14} /> COD Menunggu Setoran Finance ({filteredCodCards.length})
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {loading ? (
            <div className="bg-white border border-slate-100 rounded-3xl p-10 text-center shadow-sm">
              <Wallet size={40} className="mx-auto text-slate-200 mb-3" />
              <p className="text-sm font-bold text-slate-400 italic">Memuat invoice COD...</p>
            </div>
          ) : filteredCodCards.length === 0 ? (
            <div className="bg-white border border-slate-100 rounded-3xl p-10 text-center shadow-sm">
              <Wallet size={40} className="mx-auto text-slate-200 mb-3" />
              <p className="text-sm font-bold text-slate-400 italic">
                {search.trim() ? 'Tidak ada invoice COD yang cocok.' : 'Tidak ada invoice COD yang menunggu setoran finance.'}
              </p>
            </div>
          ) : (
            filteredCodCards.map((card) => {
              return (
                <Link
                  key={card.key}
                  href={`/driver/invoices/${card.key}`}
                  className="group block bg-white border-2 border-amber-100 rounded-[24px] p-4 shadow-sm hover:shadow-lg hover:border-amber-300 transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-black text-amber-500 uppercase tracking-tighter">Invoice COD</p>
                      <p className="text-base font-black text-slate-900 leading-none">{card.invoiceNumber}</p>
                    </div>
                    <div className="px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-[10px] font-black uppercase flex items-center gap-1">
                      <CreditCard size={10} /> COD Pending
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-slate-50 space-y-2.5">
                    <div className="flex items-center gap-2 text-slate-600">
                      <User size={14} className="min-w-[14px] opacity-40" />
                      <span className="text-[11px] font-bold line-clamp-1">{card.customerName}</span>
                    </div>
                    <div className="flex items-start gap-2 text-slate-600">
                      <MapPin size={14} className="min-w-[14px] mt-0.5 opacity-40" />
                      <span className="text-[11px] font-medium leading-snug line-clamp-2">{card.address || 'Alamat tidak tersedia'}</span>
                    </div>
                    <div className="bg-amber-50/60 rounded-xl p-2.5 flex items-start gap-2 border border-amber-100">
                      <Truck size={14} className="min-w-[14px] mt-0.5 text-amber-600" />
                      <div className="flex-1">
                        <p className="text-[10px] font-black text-amber-600 uppercase tracking-wide mb-1">Order Terkait</p>
                        <p className="text-[11px] font-black text-slate-800">{card.orders.length} order COD sudah selesai dikirim</p>
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2 border border-slate-100">
                      <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Nilai Dana</p>
                      <p className="text-sm font-black text-slate-900">{formatCurrency(card.amount)}</p>
                    </div>
                  </div>

                  <div className="mt-3">
                    <span className="w-full py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-[10px] font-black uppercase inline-flex items-center justify-center gap-1">
                      Detail Invoice <HandCoins size={14} />
                    </span>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
