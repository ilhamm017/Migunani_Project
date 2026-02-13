'use client';

import { useEffect, useState } from 'react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';

export default function DriverHistoryPage() {
  const allowed = useRequireRoles(['driver', 'super_admin', 'admin_gudang']);
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.driver.getOrders({ status: 'delivered' });
        setRows(Array.isArray(res.data) ? res.data : []);
      } catch (error) {
        console.error('Failed to load driver history:', error);
      }
    };
    if (allowed) load();
  }, [allowed]);

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      <h1 className="text-xl font-black text-slate-900">Riwayat Pengiriman Driver</h1>
      <div className="space-y-2">
        {rows.length === 0 && <p className="text-sm text-slate-500">Belum ada riwayat selesai.</p>}
        {rows.map((r) => (
          <div key={r.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <p className="text-sm font-bold text-slate-900">Order #{r.id}</p>
            <p className="text-xs text-slate-600 mt-1">Customer: {r.customer_name || '-'}</p>
            <p className="text-xs text-slate-600">Status: {r.status}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
