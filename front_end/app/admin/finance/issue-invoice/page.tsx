'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import FinanceHeader from '@/components/admin/finance/FinanceHeader';
import FinanceBottomNav from '@/components/admin/finance/FinanceBottomNav';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';

export default function FinanceIssueInvoicePage() {
  const allowed = useRequireRoles(['super_admin', 'kasir']);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [selectionError, setSelectionError] = useState('');

  const orderById = useMemo(() => {
    const map = new Map<string, any>();
    orders.forEach((order) => {
      if (order?.id) map.set(String(order.id), order);
    });
    return map;
  }, [orders]);

  const selectedCustomerId = useMemo(() => {
    const firstId = selectedOrderIds[0];
    if (!firstId) return null;
    return String(orderById.get(firstId)?.customer_id || '');
  }, [orderById, selectedOrderIds]);

  const selectedCustomerName = useMemo(() => {
    const firstId = selectedOrderIds[0];
    if (!firstId) return '';
    return String(orderById.get(firstId)?.customer_name || '');
  }, [orderById, selectedOrderIds]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.admin.orderManagement.getAll({
        page: 1,
        limit: 200,
        status: 'waiting_invoice'
      });
      setOrders(res.data?.orders || []);
      setSelectedOrderIds([]);
      setSelectionError('');
    } catch (error) {
      console.error('Failed to load invoice candidates:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  useRealtimeRefresh({
    enabled: allowed,
    onRefresh: load,
    domains: ['order', 'retur', 'cod', 'admin'],
    pollIntervalMs: 10000,
  });

  if (!allowed) return null;

  const toggleSelectOrder = (id: string) => {
    setSelectionError('');
    setSelectedOrderIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((value) => value !== id);
      }
      const nextOrder = orderById.get(id);
      const nextCustomerId = String(nextOrder?.customer_id || '');
      const currentCustomerId = selectedCustomerId;
      if (currentCustomerId && nextCustomerId && currentCustomerId !== nextCustomerId) {
        setSelectionError('Invoice gabungan hanya boleh untuk customer yang sama.');
        return prev;
      }
      return [...prev, id];
    });
  };

  const handleIssueSingle = async (id: string) => {
    try {
      setBusyId(id);
      await api.admin.finance.issueInvoice(id);
      await load();
    } catch (error: any) {
      console.error('Issue invoice failed:', error);
      alert(error?.response?.data?.message || 'Gagal menerbitkan invoice.');
    } finally {
      setBusyId(null);
    }
  };

  const handleIssueBatch = async () => {
    if (selectedOrderIds.length === 0) return;
    try {
      setBusyId('batch');
      await api.admin.finance.issueInvoiceBatch(selectedOrderIds);
      await load();
    } catch (error: any) {
      console.error('Batch issue failed:', error);
      alert(error?.response?.data?.message || 'Gagal menerbitkan invoice gabungan.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-slate-50 min-h-screen pb-24">
      <div className="bg-white px-6 pb-4 pt-2 shadow-sm sticky top-0 z-40">
        <FinanceHeader title="Terbitkan Invoice (Kasir)" />
        <p className="text-[11px] text-slate-500 mt-1">
          Pilih order dengan status <span className="font-bold">waiting_invoice</span>. Invoice bisa digabung jika customer sama.
        </p>
      </div>

      <div className="px-5 pt-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-100 rounded-2xl p-3 shadow-sm">
          <div className="text-xs text-slate-500 space-y-1">
            <p>
              Terpilih: <span className="font-bold text-slate-900">{selectedOrderIds.length}</span>
            </p>
            {selectedOrderIds.length > 0 && (
              <p>
                Customer: <span className="font-bold text-slate-900">{selectedCustomerName || '-'}</span>
              </p>
            )}
            {selectionError && (
              <p className="text-rose-600 font-bold">{selectionError}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setSelectedOrderIds([]);
                setSelectionError('');
              }}
              disabled={selectedOrderIds.length === 0}
              className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 text-slate-600 disabled:opacity-50"
            >
              Reset
            </button>
            <button
              onClick={handleIssueBatch}
              disabled={selectedOrderIds.length === 0 || busyId === 'batch'}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white disabled:opacity-50"
            >
              {busyId === 'batch' ? 'Memproses...' : 'Issue Invoice Gabungan'}
            </button>
          </div>
        </div>

        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-[11px] text-emerald-700">
          Invoice dihitung dari qty yang sudah dialokasikan di gudang. Jika belum ada alokasi, invoice tidak bisa diterbitkan.
        </div>
      </div>

      <div className="px-5 py-4 space-y-3">
        {loading ? (
          [1, 2, 3].map(i => <div key={i} className="h-24 bg-slate-200 rounded-2xl animate-pulse" />)
        ) : orders.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <p className="text-sm">Tidak ada order waiting_invoice.</p>
            <Link href="/admin/orders" className="text-xs font-bold text-emerald-700 mt-2 inline-block">
              Lihat daftar order
            </Link>
          </div>
        ) : (
          orders.map((order) => {
            const isSelected = selectedOrderIds.includes(order.id);
            return (
              <div key={order.id} className="bg-white rounded-[20px] p-4 shadow-sm border border-slate-100">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectOrder(order.id)}
                      className="w-4 h-4"
                    />
                    <div>
                      <p className="text-sm font-bold text-slate-900">{order.customer_name || 'Customer'}</p>
                      <p className="text-[10px] text-slate-500 font-mono">#{order.id}</p>
                    </div>
                  </div>
                  <span className="text-sm font-black text-slate-900">
                    {formatCurrency(Number(order.total_amount || 0))}
                  </span>
                </div>

                <div className="bg-slate-50 rounded-xl p-3 mb-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-500">Status</span>
                    <span className="font-bold text-slate-700 uppercase">{order.status}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Tanggal</span>
                    <span className="font-medium text-slate-700">{formatDateTime(order.createdAt)}</span>
                  </div>
                </div>

                <button
                  onClick={() => handleIssueSingle(order.id)}
                  disabled={busyId === order.id}
                  className="w-full bg-slate-900 text-white py-2.5 rounded-xl text-xs font-bold hover:bg-slate-800 disabled:opacity-50"
                >
                  {busyId === order.id ? 'Memproses...' : 'Issue Invoice'}
                </button>
              </div>
            );
          })
        )}
      </div>

      <FinanceBottomNav />
    </div>
  );
}
