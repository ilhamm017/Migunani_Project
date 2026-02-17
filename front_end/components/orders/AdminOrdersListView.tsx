'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, PackageSearch, Search, Smartphone, MessageCircle } from 'lucide-react';
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
  { key: 'waiting_admin_verification', label: 'Waiting Admin Verification' },
  { key: 'debt_pending', label: 'Utang Belum Lunas' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'completed', label: 'Completed' },
  { key: 'canceled', label: 'Canceled' },
  { key: 'hold', label: 'Bermasalah (Barang Kurang)' },
];

const statusHref = (status: string) =>
  status === 'all' ? '/admin/orders' : `/admin/orders/status/${status}`;

const TABS = [
  { id: 'baru_masuk', label: 'Baru Masuk' },
  { id: 'selesai', label: 'Order Selesai' },
  { id: 'backorder', label: 'Backorder / Preorder' },
];

const calculateAge = (createdAt: string) => {
  const created = new Date(createdAt);
  const now = new Date();
  const diffTime = Math.abs(now.getTime() - created.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

export default function AdminOrdersListView({ title, description, fixedStatus = 'all' }: Props) {
  const router = useRouter();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const activeStatus = fixedStatus || 'all';
  const [activeTab, setActiveTab] = useState('baru_masuk');

  const dateRangeError = useMemo(() => {
    if (!startDate || !endDate) return '';
    if (startDate <= endDate) return '';
    return 'Tanggal mulai tidak boleh lebih besar dari tanggal akhir.';
  }, [startDate, endDate]);

  const load = async (params?: { search?: string; startDate?: string; endDate?: string }) => {
    try {
      setLoading(true);

      let fetchStatus = activeStatus;
      let isBackorder = undefined;
      let excludeBackorder = undefined;

      if (fixedStatus === 'all') {
        if (activeTab === 'baru_masuk') {
          // These are active statuses that are NOT completed/canceled/backorder
          fetchStatus = 'pending,waiting_invoice,waiting_payment,waiting_admin_verification,allocated,ready_to_ship,hold,debt_pending';
          excludeBackorder = 'true';
        } else if (activeTab === 'selesai') {
          fetchStatus = 'completed,delivered';
        } else if (activeTab === 'backorder') {
          fetchStatus = 'all';
          isBackorder = 'true';
        }
      }

      const res = await api.admin.orderManagement.getAll({
        page: 1,
        limit: 100,
        status: fetchStatus,
        search: params?.search || '',
        startDate: params?.startDate || undefined,
        endDate: params?.endDate || undefined,
        is_backorder: isBackorder,
        exclude_backorder: excludeBackorder,
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
  }, [activeStatus, activeTab, search, startDate, endDate, dateRangeError]);

  const statusBadgeClass = (status: string) => {
    if (['completed', 'delivered'].includes(status)) return 'bg-emerald-100 text-emerald-700';
    if (['shipped', 'waiting_admin_verification'].includes(status)) return 'bg-blue-100 text-blue-700';
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

      {fixedStatus === 'all' && (
        <div className="flex bg-slate-100 p-1 rounded-2xl w-fit">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === tab.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

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
          {orders.map((o) => {
            const isChild = !!o.parent_order_id;
            const isParent = Array.isArray(o.Children) && o.Children.length > 0;
            const payStatus = o.Invoice?.payment_status || 'unpaid';

            return (
              <Link
                key={o.id}
                href={`/admin/orders/${o.id}`}
                className="block bg-white border border-slate-200 rounded-[24px] p-4 shadow-sm hover:border-emerald-300 transition-all hover:shadow-md"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="mt-1 shrink-0 bg-slate-50 p-2.5 rounded-2xl border border-slate-100 flex items-center justify-center">
                      {o.source === 'whatsapp' ? (
                        <div className="text-emerald-600"><MessageCircle size={18} /></div>
                      ) : (
                        <div className="text-blue-600"><Smartphone size={18} /></div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-black text-slate-900">#{o.id.slice(-8).toUpperCase()}</span>
                        {isChild && (
                          <>
                            <span className="bg-amber-100 text-amber-700 text-[10px] font-black px-2 py-0.5 rounded-lg uppercase">Backorder</span>
                            <span className="bg-slate-100 text-slate-600 text-[10px] font-black px-2 py-0.5 rounded-lg uppercase">Umur: {calculateAge(o.createdAt)} Hari</span>
                          </>
                        )}
                        {isParent && (
                          <span className="bg-blue-100 text-blue-700 text-[10px] font-black px-2 py-0.5 rounded-lg uppercase">Split/Parent</span>
                        )}
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg uppercase ${statusBadgeClass(o.status)}`}>
                          {o.status.replace(/_/g, ' ')}
                        </span>
                      </div>

                      <div className="mt-2 text-xs font-semibold text-slate-900 truncate">
                        {o.customer_name || 'Anonymous Customer'}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-[11px] text-slate-500 font-medium">{formatDateTime(o.createdAt)}</span>
                        <span className="text-[11px] text-slate-400">•</span>
                        <span className={`text-[11px] font-bold ${payStatus === 'paid' ? 'text-emerald-600' :
                          payStatus === 'draft' ? 'text-slate-400' : 'text-amber-600'
                          }`}>
                          {payStatus.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 border-t sm:border-0 pt-3 sm:pt-0 mt-1 sm:mt-0">
                    <div className="text-right">
                      <p className="text-[14px] font-black text-slate-900 leading-tight">
                        {formatCurrency(Number(o.total_amount || 0))}
                      </p>
                      {o.Invoice?.invoice_number && (
                        <p className="text-[10px] text-slate-400 font-bold mt-0.5 uppercase tracking-wider">
                          {o.Invoice.invoice_number}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl hover:bg-emerald-100 transition-colors">
                      Detail <ChevronRight size={14} strokeWidth={3} />
                    </div>
                  </div>
                </div>

                {o.active_issue && (
                  <div className={`mt-3 p-2.5 rounded-xl border flex items-center gap-2 ${o.issue_overdue ? 'bg-rose-50 border-rose-100 text-rose-700' : 'bg-amber-50 border-amber-100 text-amber-700'
                    }`}>
                    <PackageSearch size={14} />
                    <span className="text-[10px] font-bold leading-none">
                      Peringatan: {o.active_issue.issue_type === 'shortage' ? 'Kekurangan Barang' : 'Masalah Order'}
                    </span>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
