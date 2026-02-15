'use client';

import { useEffect, useState } from 'react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';

export default function DriverHistoryPage() {
  const allowed = useRequireRoles(['driver', 'super_admin', 'admin_gudang']);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'today' | 'week'>('today');

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const params: any = { status: 'delivered,completed' };

        const now = new Date();
        if (filter === 'today') {
          params.startDate = now.toISOString();
          params.endDate = now.toISOString();
        } else if (filter === 'week') {
          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 7);
          params.startDate = weekAgo.toISOString();
          params.endDate = now.toISOString();
        }

        const res = await api.driver.getOrders(params);
        setRows(Array.isArray(res.data) ? res.data : []);
      } catch (error) {
        console.error('Failed to load driver history:', error);
      } finally {
        setLoading(false);
      }
    };
    if (allowed) load();
  }, [allowed, filter]);

  if (!allowed) return null;

  return (
    <div className="p-6 pb-24 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black text-slate-900">Riwayat Pengiriman</h1>
        <div className="flex gap-2">
          {['all', 'today', 'week'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f as any)}
              className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase transition-colors ${filter === f
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
            >
              {f === 'all' ? 'Semua' : f === 'today' ? 'Hari Ini' : 'Minggu Ini'}
            </button>
          ))}
        </div>
      </div>

      {/* Mini Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-2xl">
          <p className="text-[10px] uppercase font-bold text-emerald-600 mb-1">Selesai</p>
          <p className="text-2xl font-black text-emerald-800">{rows.filter(r => r.status === 'delivered' || r.status === 'completed').length}</p>
        </div>
        <div className="bg-white border border-slate-200 p-4 rounded-2xl">
          <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Total Item</p>
          <p className="text-2xl font-black text-slate-800">
            {rows.reduce((acc, curr) => acc + (curr.OrderItems?.length || 0), 0)}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {loading ? (
          <p className="text-center text-xs text-slate-400 py-10">Memuat data...</p>
        ) : rows.length === 0 ? (
          <div className="text-center py-10 opacity-50">
            <p className="text-sm font-bold text-slate-500">Belum ada riwayat.</p>
            <p className="text-xs text-slate-400">Coba ubah filter waktu.</p>
          </div>
        ) : (
          rows.map((r) => {
            const customer = r.Customer || {};
            const date = new Date(r.updatedAt || r.createdAt);
            const dateStr = date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
            const timeStr = date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

            return (
              <div key={r.id} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full uppercase tracking-wider">
                      #{r.id.slice(-6)}
                    </span>
                    <h3 className="text-sm font-bold text-slate-900 mt-1.5">{customer.name || r.customer_name || 'Customer'}</h3>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-slate-900">{dateStr}</p>
                    <p className="text-[10px] text-slate-400">{timeStr}</p>
                  </div>
                </div>

                <div className="border-t border-slate-50 pt-3 flex justify-between items-center">
                  <div className="flex -space-x-2">
                    {(r.OrderItems || []).slice(0, 3).map((item: any, idx: number) => (
                      <div key={idx} className="w-6 h-6 rounded-full bg-slate-200 border border-white flex items-center justify-center text-[8px] font-bold text-slate-500 overflow-hidden" title={item.Product?.name}>
                        {item.Product?.name?.charAt(0) || '?'}
                      </div>
                    ))}
                    {(r.OrderItems || []).length > 3 && (
                      <div className="w-6 h-6 rounded-full bg-slate-100 border border-white flex items-center justify-center text-[8px] font-bold text-slate-400">
                        +{(r.OrderItems?.length || 0) - 3}
                      </div>
                    )}
                  </div>
                  <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-lg ${r.status === 'completed'
                    ? 'bg-slate-100 text-slate-600'
                    : 'bg-emerald-100 text-emerald-700'
                    }`}>
                    {r.status === 'completed' ? 'Selesai (Final)' : 'Terkirim'}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
