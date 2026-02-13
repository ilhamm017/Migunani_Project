'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';

export default function DriverTaskPage() {
  const allowed = useRequireRoles(['driver', 'super_admin', 'admin_gudang']);
  const [orders, setOrders] = useState<any[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.driver.getOrders();
        setOrders(Array.isArray(res.data) ? res.data : []);
      } catch (error) {
        console.error('Failed to load driver tasks:', error);
      }
    };
    if (allowed) load();
  }, [allowed]);

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black text-slate-900">Daftar Tugas Driver</h1>
        <Link href="/driver/history" className="text-sm font-bold text-emerald-700">Riwayat</Link>
      </div>

      <div className="space-y-2">
        {orders.length === 0 && <p className="text-sm text-slate-500">Belum ada tugas pengiriman.</p>}
        {orders.map((o) => (
          <Link key={o.id} href={`/driver/orders/${o.id}`} className="bg-white border border-slate-200 rounded-2xl p-4 block shadow-sm">
            <p className="text-sm font-bold text-slate-900">Order #{o.id}</p>
            <p className="text-xs text-slate-600 mt-1">Status: {o.status}</p>
            <p className="text-xs text-slate-600">Customer: {o.customer_name || '-'}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
