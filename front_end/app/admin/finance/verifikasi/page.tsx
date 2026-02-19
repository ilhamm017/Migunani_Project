'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import FinanceHeader from '@/components/admin/finance/FinanceHeader';
import FinanceBottomNav from '@/components/admin/finance/FinanceBottomNav';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';

const normalizeProofImageUrl = (raw?: string | null) => {
  if (!raw) return null;
  const val = String(raw).trim();
  if (!val) return null;

  if (val.startsWith('http://') || val.startsWith('https://')) return val;
  if (val.startsWith('/uploads/')) return val;
  if (val.startsWith('uploads/')) return `/${val}`;

  const normalizedSlash = val.replace(/\\/g, '/');
  if (normalizedSlash.startsWith('uploads/')) return `/${normalizedSlash}`;
  const uploadsIndex = normalizedSlash.indexOf('/uploads/');
  if (uploadsIndex >= 0) return normalizedSlash.slice(uploadsIndex);
  return val;
};

export default function FinanceVerifyPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_finance']);

  const [activeTab, setActiveTab] = useState<'verify' | 'cod' | 'completed'>('verify');
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.admin.orderManagement.getAll({
        page: 1, limit: 100,
        status: 'waiting_admin_verification,delivered,completed,canceled'
      });
      setOrders(res.data?.orders || []);
    } catch (error) {
      console.error('Failed to load orders:', error);
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPreviewUrl(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Client-side filtering for tabs
  const tabOrders = useMemo(() => {
    return orders.filter(o => {
      if (activeTab === 'verify') return o.status === 'waiting_admin_verification';
      if (activeTab === 'cod') {
        const isCod = ['cod', 'cash_store'].includes(o.Invoice?.payment_method);
        return o.status === 'delivered' && isCod && o.Invoice?.payment_status !== 'paid';
      }
      if (activeTab === 'completed') {
        return o.status === 'completed' || (o.Invoice?.payment_status === 'paid' && o.status !== 'cancelled');
      }
      return false;
    });
  }, [orders, activeTab]);

  if (!allowed) return null;

  const handleAction = async (id: string, actionType: 'verify', verifyAction?: 'approve' | 'reject') => {
    try {
      setBusyId(id);
      await api.admin.finance.verifyPayment(id, verifyAction || 'approve');
      await load();
    } catch (error: any) {
      console.error('Action failed:', error);
      alert(error?.response?.data?.message || 'Gagal memproses.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-slate-50 min-h-screen pb-24">
      <div className="bg-white px-6 pb-4 pt-2 shadow-sm sticky top-0 z-40">
        <FinanceHeader title="Verifikasi Command" />

        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          <button
            onClick={() => setActiveTab('verify')}
            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${activeTab === 'verify' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
          >
            Verifikasi
          </button>
          <button
            onClick={() => setActiveTab('cod')}
            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${activeTab === 'cod' ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-600'
              }`}
          >
            COD Setoran
          </button>
          <button
            onClick={() => setActiveTab('completed')}
            className={`px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-colors ${activeTab === 'completed' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600'
              }`}
          >
            History
          </button>
        </div>
      </div>

      <div className="px-5 py-4 space-y-3">
        {loading ? (
          [1, 2, 3].map(i => <div key={i} className="h-24 bg-slate-200 rounded-2xl animate-pulse" />)
        ) : tabOrders.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <p className="text-sm">Tidak ada data</p>
          </div>
        ) : (
          tabOrders.map((o) => {
            const proofUrl = normalizeProofImageUrl(o.Invoice?.payment_proof_url);
            const deliveryProofUrl = normalizeProofImageUrl(o.delivery_proof_url);
            const isCodTab = activeTab === 'cod';
            // const isVerifyTab = activeTab === 'verify'; 
            const initial = (o.customer_name || 'C').charAt(0).toUpperCase();

            return (
              <div key={o.id} className="bg-white rounded-[20px] p-4 shadow-sm border border-slate-100 active:scale-[0.98] transition-all">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm ${isCodTab ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-600'
                      }`}>
                      {initial}
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm line-clamp-1">{o.customer_name}</h4>
                      <p className="text-[10px] text-slate-500 font-mono">#{o.Invoice?.invoice_number || o.id}</p>
                    </div>
                  </div>
                  <span className="text-sm font-black text-slate-900">
                    {formatCurrency(Number(o.Invoice?.total || o.total_amount))}
                  </span>
                </div>

                {/* Middle Content */}
                <div className="bg-slate-50 rounded-xl p-3 mb-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-500">Metode</span>
                    <span className="font-bold text-slate-700 uppercase">{o.Invoice?.payment_method || '-'}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Tanggal</span>
                    <span className="font-medium text-slate-700">{formatDateTime(o.createdAt)}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  {activeTab === 'verify' && (
                    <>
                      {proofUrl ? (
                        <button
                          onClick={() => setPreviewUrl(proofUrl)}
                          className="px-3 py-2.5 bg-blue-50 text-blue-600 rounded-xl text-xs font-bold"
                        >
                          Bukti
                        </button>
                      ) : null}
                      <button
                        onClick={() => handleAction(o.id, 'verify', 'approve')}
                        disabled={busyId === o.id || !proofUrl}
                        className="flex-1 bg-emerald-600 text-white py-2.5 rounded-xl text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Approve
                      </button>
                    </>
                  )}

                  {activeTab === 'cod' && (
                    <Link
                      href="/admin/finance/cod"
                      className="flex-1 bg-orange-500 text-white py-2.5 rounded-xl text-xs font-bold hover:bg-orange-600 text-center"
                    >
                      Buka Settlement COD
                    </Link>
                  )}

                  {activeTab === 'completed' && (o.Invoice?.payment_status === 'paid') && (
                    <button
                      onClick={() => {
                        if (!confirm('Void invoice ini?')) return;
                        api.admin.finance.voidInvoice(o.Invoice?.id).then(() => load());
                      }}
                      className="flex-1 bg-rose-100 text-rose-600 py-2.5 rounded-xl text-xs font-bold"
                    >
                      Void (Batal)
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {previewUrl && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4 backdrop-blur-md" onClick={() => setPreviewUrl(null)}>
          <div className="relative w-full max-w-sm bg-white rounded-3xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="font-bold text-slate-900">Bukti Transfer</h3>
              <button onClick={() => setPreviewUrl(null)} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200"><X size={16} /></button>
            </div>
            <div className="p-0 bg-slate-900 flex items-center justify-center min-h-[300px]">
              <img src={previewUrl} className="max-w-full max-h-[50vh] object-contain" alt="Proof" />
            </div>
            <div className="p-4 flex gap-2">
              <button onClick={() => setPreviewUrl(null)} className="flex-1 py-3 font-bold text-slate-600 text-sm">Tutup</button>
            </div>
          </div>
        </div>
      )}

      <FinanceBottomNav />
    </div>
  );
}
