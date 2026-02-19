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

const getChecklistMeta = (orderId: string): ChecklistMeta => {
  if (typeof window === 'undefined' || !orderId) {
    return { status: 'not_checked' };
  }
  const raw = sessionStorage.getItem(`driver-checklist-${orderId}`);
  if (!raw) return { status: 'not_checked' };
  try {
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
    const mismatchCount = rows.filter((row: any) => Number(row?.actualQty || 0) !== Number(row?.expectedQty || 0)).length;
    return {
      status: mismatchCount > 0 ? 'mismatch' : 'ready',
      savedAt: parsed?.savedAt,
      mismatchCount,
    };
  } catch {
    return { status: 'not_checked' };
  }
};

export default function DriverPrecheckPage() {
  const allowed = useRequireRoles(['driver', 'super_admin', 'admin_gudang']);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [checklistByOrder, setChecklistByOrder] = useState<Record<string, ChecklistMeta>>({});

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
    const next: Record<string, ChecklistMeta> = {};
    for (const order of orders) {
      const orderId = String(order?.id || '');
      if (!orderId) continue;
      next[orderId] = getChecklistMeta(orderId);
    }
    setChecklistByOrder(next);
  }, [allowed, orders]);

  const orderCards = useMemo(() => orders.map((order) => {
    const orderId = String(order?.id || '');
    const meta = checklistByOrder[orderId] || { status: 'not_checked' };
    const customer = order?.Customer || {};
    const profile = customer.CustomerProfile || {};
    const addresses = Array.isArray(profile.saved_addresses) ? profile.saved_addresses : [];
    const addressObj = addresses.find((a: any) => a.isPrimary) || addresses[0];
    const address = addressObj ? (addressObj.fullAddress || addressObj.address || 'Alamat tersimpan') : 'Alamat tidak tersedia';

    const badge = meta.status === 'ready'
      ? { label: 'Checklist OK', className: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle2 }
      : meta.status === 'mismatch'
        ? { label: 'Ada Selisih', className: 'bg-rose-100 text-rose-700 border-rose-200', icon: AlertTriangle }
        : { label: 'Belum Dicek', className: 'bg-amber-100 text-amber-700 border-amber-200', icon: ClipboardCheck };

    const BadgeIcon = badge.icon;

    return (
      <div
        key={orderId}
        className="bg-white border border-slate-100 rounded-[28px] p-5 shadow-sm hover:shadow-xl hover:border-emerald-200 transition-all"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Order</p>
            <p className="text-lg font-black text-slate-900 leading-none">#{orderId.slice(-8).toUpperCase()}</p>
          </div>
          <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-black uppercase border ${badge.className}`}>
            <BadgeIcon size={12} />
            {badge.label}
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-slate-50 space-y-2">
          <div className="flex items-center gap-2 text-slate-600">
            <User size={14} className="min-w-[14px] opacity-40" />
            <span className="text-xs font-bold line-clamp-1">{order?.customer_name || customer.name || 'Customer'}</span>
          </div>
          <div className="flex items-start gap-2 text-slate-600">
            <MapPin size={14} className="min-w-[14px] mt-0.5 opacity-40" />
            <span className="text-xs font-medium leading-relaxed line-clamp-2">{address}</span>
          </div>
          <div className="bg-slate-50 rounded-xl p-3 flex items-start gap-2 mt-1">
            <Package size={14} className="min-w-[14px] mt-0.5 text-slate-400" />
            <div className="flex-1">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Barang</p>
              <div className="text-xs font-medium text-slate-800 space-y-0.5">
                {(order?.OrderItems || []).slice(0, 3).map((item: any, idx: number) => (
                  <p key={idx}>{item.qty}x {item.Product?.name || 'Produk'}</p>
                ))}
                {(order?.OrderItems || []).length > 3 && (
                  <p className="text-[10px] text-slate-400 italic">...dan {(order.OrderItems.length - 3)} lainnya</p>
                )}
                {(order?.OrderItems || []).length === 0 && <p className="text-slate-400 italic">Tidak ada item</p>}
              </div>
            </div>
          </div>
          {meta.savedAt && (
            <p className="text-[10px] text-slate-500">Terakhir disimpan: {new Date(meta.savedAt).toLocaleString('id-ID')}</p>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link
            href={`/driver/orders/${orderId}/checklist`}
            className="py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-black uppercase text-center"
          >
            Buka Checklist
          </Link>
          <Link
            href={`/driver/orders/${orderId}`}
            className="py-3 rounded-xl bg-white border border-slate-200 text-slate-700 text-[10px] font-black uppercase text-center"
          >
            Detail Order
          </Link>
        </div>
      </div>
    );
  }), [orders, checklistByOrder]);

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-6 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] mb-1">Pengecekan</p>
          <h1 className="text-2xl font-black text-slate-900 leading-none">Checklist Sebelum Kirim</h1>
          <p className="text-xs text-slate-500 mt-2">Pastikan barang sesuai sebelum melakukan pengantaran.</p>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-100 rounded-3xl p-10 text-center shadow-sm">
          <p className="text-sm font-bold text-slate-400 italic">Memuat daftar checklist...</p>
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-white border border-slate-100 rounded-3xl p-10 text-center shadow-sm">
          <ClipboardCheck size={40} className="mx-auto text-slate-200 mb-3" />
          <p className="text-sm font-bold text-slate-400 italic">Belum ada order untuk dicek.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {orderCards}
        </div>
      )}
    </div>
  );
}
