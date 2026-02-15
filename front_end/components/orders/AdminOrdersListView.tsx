'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, PackageSearch, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';

type Props = {
  title: string;
  description: string;
  fixedStatus?: string;
};

const STATUS_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'Semua' },
  { key: 'pending', label: 'Pending' },
  { key: 'waiting_payment', label: 'Waiting Payment' },
  { key: 'processing', label: 'Processing' },
  { key: 'debt_pending', label: 'Utang Belum Lunas' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'completed', label: 'Completed' },
  { key: 'canceled', label: 'Canceled' },
  { key: 'hold', label: 'Bermasalah (Barang Kurang)' },
];

const statusHref = (status: string) =>
  status === 'all' ? '/admin/orders' : `/admin/orders/status/${status}`;

export default function AdminOrdersListView({ title, description, fixedStatus = 'all' }: Props) {
  const router = useRouter();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const activeStatus = fixedStatus || 'all';

  const dateRangeError = useMemo(() => {
    if (!startDate || !endDate) return '';
    if (startDate <= endDate) return '';
    return 'Tanggal mulai tidak boleh lebih besar dari tanggal akhir.';
  }, [startDate, endDate]);

  const load = async (params?: { search?: string; startDate?: string; endDate?: string }) => {
    try {
      setLoading(true);
      const res = await api.admin.orderManagement.getAll({
        page: 1,
        limit: 100,
        status: activeStatus,
        search: params?.search || '',
        startDate: params?.startDate || undefined,
        endDate: params?.endDate || undefined,
      });
      setOrders(res.data?.orders || []);
    } catch (error) {
      console.error('Failed to load admin orders:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (dateRangeError) return;
    const timer = setTimeout(() => {
      load({ search, startDate, endDate });
    }, 250);
    return () => clearTimeout(timer);
  }, [activeStatus, search, startDate, endDate, dateRangeError]);

  const statusBadgeClass = (status: string) => {
    if (['completed', 'delivered'].includes(status)) return 'bg-emerald-100 text-emerald-700';
    if (['shipped', 'processing'].includes(status)) return 'bg-blue-100 text-blue-700';
    if (status === 'canceled') return 'bg-rose-100 text-rose-700';
    if (status === 'waiting_payment' || status === 'debt_pending') return 'bg-amber-100 text-amber-700';
    if (status === 'hold') return 'bg-violet-100 text-violet-700';
    return 'bg-slate-100 text-slate-700';
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900">{title}</h1>
          <p className="text-sm text-slate-600">{description}</p>
        </div>
        <Link
          href="/admin/orders/issues"
          className="px-3 py-2 rounded-xl border border-violet-300 text-violet-700 text-xs font-bold bg-violet-50"
        >
          Order Bermasalah
        </Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm grid grid-cols-1 md:grid-cols-5 gap-2">
        <select
          value={activeStatus}
          onChange={(e) => router.push(statusHref(e.target.value))}
          className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>
              Status: {option.label}
            </option>
          ))}
        </select>

        <div className="md:col-span-2 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari order id, customer, invoice..."
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm"
          />
        </div>
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
        />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            setSearch('');
            setStartDate('');
            setEndDate('');
          }}
          className="text-xs font-bold text-slate-600 bg-slate-100 rounded-lg px-3 py-2"
        >
          Reset Filter
        </button>
      </div>

      {dateRangeError && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3">
          <p className="text-xs text-rose-700">{dateRangeError}</p>
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <p className="text-sm text-slate-500">Memuat daftar order...</p>
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex items-center gap-3">
          <PackageSearch className="text-slate-400" size={20} />
          <p className="text-sm text-slate-500">Tidak ada order untuk filter ini.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <Link
              key={o.id}
              href={`/admin/orders/${o.id}`}
              className="block bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:border-emerald-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 truncate">Order #{o.id}</p>
                  <p className="text-xs text-slate-500 mt-1">{formatDateTime(o.createdAt)}</p>
                  <p className="text-xs text-slate-600 mt-1">
                    Customer: <span className="font-semibold text-slate-800">{o.customer_name || '-'}</span>
                  </p>
                  <p className="text-xs text-slate-600">
                    Source: <span className="font-semibold text-slate-800 uppercase">{o.source}</span>
                  </p>
                  <p className="text-xs text-slate-600">
                    Payment: <span className="font-semibold text-slate-800">{o.Invoice?.payment_status || '-'}</span>
                  </p>
                  {o.active_issue && (
                    <p className={`text-xs mt-1 ${o.issue_overdue ? 'text-rose-700' : 'text-amber-700'}`}>
                      Issue: Barang kurang • deadline {o.active_issue?.due_at ? formatDateTime(o.active_issue.due_at) : '-'}
                    </p>
                  )}
                </div>

                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase ${statusBadgeClass(o.status)}`}>
                    {o.status}
                  </span>
                  <p className="text-sm font-black text-slate-900">{formatCurrency(Number(o.total_amount || 0))}</p>
                  <span className="text-xs font-semibold text-emerald-700 inline-flex items-center gap-1">
                    Buka Detail <ChevronRight size={14} />
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
