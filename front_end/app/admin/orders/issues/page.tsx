'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock3, Search } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

const toDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const formatRemaining = (dueAt: string | Date | null | undefined): string => {
  const dueDate = toDate(dueAt);
  if (!dueDate) return '-';

  const diffMs = dueDate.getTime() - Date.now();
  const absHours = Math.floor(Math.abs(diffMs) / (1000 * 60 * 60));
  const absMinutes = Math.floor((Math.abs(diffMs) % (1000 * 60 * 60)) / (1000 * 60));

  if (diffMs < 0) {
    return `Terlambat ${absHours}j ${absMinutes}m`;
  }
  return `Sisa ${absHours}j ${absMinutes}m`;
};

export default function AdminIssueOrdersPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'admin_finance', 'kasir']);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);

  const load = async (searchValue: string) => {
    try {
      setLoading(true);
      const res = await api.admin.orderManagement.getAll({
        status: 'hold',
        limit: 100,
        search: searchValue || undefined,
      });

      const rows = (res.data?.orders || []) as any[];
      const sorted = [...rows].sort((a, b) => {
        const aOverdue = Boolean(a.issue_overdue);
        const bOverdue = Boolean(b.issue_overdue);
        if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;

        const aDue = toDate(a.active_issue?.due_at)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const bDue = toDate(b.active_issue?.due_at)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        return aDue - bDue;
      });

      setOrders(sorted);
    } catch (error) {
      console.error('Failed to load problematic orders:', error);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!allowed) return;
    const timer = setTimeout(() => load(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [allowed, search]);

  const filteredOrders = useMemo(() => {
    if (!overdueOnly) return orders;
    return orders.filter((order) => Boolean(order.issue_overdue));
  }, [orders, overdueOnly]);

  const summary = useMemo(() => {
    const total = orders.length;
    const overdue = orders.filter((item) => Boolean(item.issue_overdue)).length;
    const dueSoon = orders.filter((item) => {
      const dueDate = toDate(item.active_issue?.due_at);
      if (!dueDate) return false;
      const diff = dueDate.getTime() - Date.now();
      return diff > 0 && diff <= 24 * 60 * 60 * 1000;
    }).length;
    return { total, overdue, dueSoon };
  }, [orders]);

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900">Order Bermasalah</h1>
          <p className="text-sm text-slate-600 mt-1">
            Fokus penanganan kasus barang kurang. SLA penyelesaian maksimal 2x24 jam.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/orders" className="px-3 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold">
            Semua Order
          </Link>
          <Link href="/admin/orders/status/hold" className="px-3 py-2 rounded-xl border border-violet-300 text-violet-700 text-xs font-bold">
            Status Hold
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4">
          <p className="text-xs text-violet-700">Total Order Bermasalah</p>
          <p className="text-2xl font-black text-violet-700 mt-1">{summary.total}</p>
        </div>
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4">
          <p className="text-xs text-rose-700">Melewati SLA</p>
          <p className="text-2xl font-black text-rose-700 mt-1">{summary.overdue}</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <p className="text-xs text-amber-700">Deadline &lt; 24 Jam</p>
          <p className="text-2xl font-black text-amber-700 mt-1">{summary.dueSoon}</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari order id / customer..."
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => setOverdueOnly((prev) => !prev)}
          className={`px-3 py-2 rounded-xl text-xs font-bold border ${overdueOnly ? 'bg-rose-50 border-rose-300 text-rose-700' : 'bg-slate-50 border-slate-200 text-slate-700'}`}
        >
          {overdueOnly ? 'Tampilkan Semua' : 'Hanya Overdue'}
        </button>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <p className="text-sm text-slate-500">Memuat order bermasalah...</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <p className="text-sm text-slate-500">Tidak ada order bermasalah pada filter ini.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredOrders.map((order) => (
            <Link
              key={order.id}
              href={`/admin/orders/${order.id}`}
              className="block bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:border-violet-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-slate-900">Order #{order.id}</p>
                  <p className="text-xs text-slate-600 mt-1">
                    Customer: <span className="font-semibold text-slate-800">{order.customer_name || '-'}</span>
                  </p>
                  <p className="text-xs text-slate-600">
                    Courier: <span className="font-semibold text-slate-800">{order.courier_display_name || order.Courier?.name || '-'}</span>
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Dibuat: {formatDateTime(order.createdAt)}
                  </p>
                  {order.active_issue?.note && (
                    <p className="text-xs text-slate-700 mt-2">
                      Catatan: <span className="font-semibold">{order.active_issue.note}</span>
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className={`text-xs font-bold ${order.issue_overdue ? 'text-rose-700' : 'text-amber-700'}`}>
                    {order.issue_overdue ? 'OVERDUE' : 'PERLU FOLLOW UP'}
                  </p>
                  <p className="text-xs text-slate-600 mt-1">
                    Deadline: {order.active_issue?.due_at ? formatDateTime(order.active_issue.due_at) : '-'}
                  </p>
                  <p className={`text-xs mt-1 inline-flex items-center gap-1 ${order.issue_overdue ? 'text-rose-700' : 'text-amber-700'}`}>
                    <Clock3 size={12} />
                    {formatRemaining(order.active_issue?.due_at)}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {summary.overdue > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-rose-600 mt-0.5" />
          <p className="text-sm text-rose-700">
            Ada {summary.overdue} order yang melewati SLA 2x24 jam. Prioritaskan penyelesaian untuk menghindari komplain berulang.
          </p>
        </div>
      )}
    </div>
  );
}
