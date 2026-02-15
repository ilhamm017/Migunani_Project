'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { X, CheckCircle, FileText, Wallet } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { formatCurrency, formatDateTime } from '@/lib/utils';

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
  const { user } = useAuthStore();
  const canVerify = useMemo(() => ['admin_finance', 'super_admin'].includes(user?.role || ''), [user?.role]);

  const [activeTab, setActiveTab] = useState<'invoice' | 'verify' | 'cod'>('invoice');
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      // Fetch relevant statuses: waiting_invoice, waiting_payment, delivered.
      // delivered is for COD settlement.
      // We'll filter client-side for tabs.
      const res = await api.admin.orderManagement.getAll({
        page: 1, limit: 100,
        status: 'waiting_invoice,waiting_payment,delivered'
      });
      setOrders(res.data?.orders || []);
    } catch (error) {
      console.error('Failed to load orders:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (allowed) load();
  }, [allowed]);

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
      if (activeTab === 'invoice') return o.status === 'waiting_invoice';
      if (activeTab === 'verify') return o.status === 'waiting_payment';
      if (activeTab === 'cod') {
        const isCod = ['cod', 'cash_store'].includes(o.Invoice?.payment_method);
        return o.status === 'delivered' && isCod && o.Invoice?.payment_status !== 'paid';
      }
      return false;
    });
  }, [orders, activeTab]);

  if (!allowed) return null;

  const handleAction = async (id: string, actionType: 'issue' | 'verify' | 'cod_settle', verifyAction?: 'approve' | 'reject') => {
    try {
      setBusyId(id);
      if (actionType === 'issue') {
        await api.admin.finance.issueInvoice(id);
      } else if (actionType === 'verify') {
        await api.admin.finance.verifyPayment(id, verifyAction || 'approve');
      } else if (actionType === 'cod_settle') {
        // Use verifyPayment with 'approve' for COD settlement (backend logic handles transition delivered -> completed)
        await api.admin.finance.verifyPayment(id, 'approve');
      }
      await load();
    } catch (error: any) {
      console.error('Action failed:', error);
      alert(error?.response?.data?.message || 'Gagal memproses.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
        <h1 className="text-xl font-black text-slate-900">Finance Command Center</h1>
        <p className="text-xs text-slate-600 mt-1">
          Kelola penerbitan invoice, verifikasi pembayaran transfer, dan setoran uang COD dari driver.
        </p>
      </div>

      <div className="flex gap-2 border-b border-slate-200 overflow-x-auto">
        <button
          onClick={() => setActiveTab('invoice')}
          className={`pb-3 px-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${activeTab === 'invoice' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          <FileText size={16} /> Perlu Invoice
        </button>
        <button
          onClick={() => setActiveTab('verify')}
          className={`pb-3 px-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${activeTab === 'verify' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          <CheckCircle size={16} /> Verifikasi Transfer
        </button>
        <button
          onClick={() => setActiveTab('cod')}
          className={`pb-3 px-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${activeTab === 'cod' ? 'border-orange-600 text-orange-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          <Wallet size={16} /> Setoran COD
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Memuat data...</p>
      ) : (
        <div className="space-y-3">
          {tabOrders.length === 0 && (
            <div className="bg-slate-50 rounded-2xl p-8 text-center min-h-[200px] flex flex-col items-center justify-center">
              <p className="text-sm text-slate-500 font-medium">Tidak ada order di tab ini.</p>
              <p className="text-xs text-slate-400 mt-1">Order baru akan muncul di sini sesuai statusnya.</p>
            </div>
          )}
          {tabOrders.map((o) => {
            const proofUrl = normalizeProofImageUrl(o.Invoice?.payment_proof_url);
            const deliveryProofUrl = normalizeProofImageUrl(o.delivery_proof_url); // For COD tab

            return (
              <div key={o.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-slate-900">Order #{o.id}</p>
                    <p className="text-xs text-slate-600 mt-1">
                      Invoice: {o.Invoice?.invoice_number || '-'} | Customer: {o.customer_name || '-'}
                    </p>
                    <p className="text-xs text-slate-600">
                      Total: {formatCurrency(Number(o.total_amount || 0))} | Metode: <span className="font-bold uppercase">{o.Invoice?.payment_method || '-'}</span>
                    </p>
                    {o.Courier && (
                      <p className="text-xs text-slate-600">Driver: {o.courier_display_name || o.Courier.name}</p>
                    )}
                  </div>
                  <Link
                    href={`/admin/orders/${o.id}`}
                    className="inline-flex items-center justify-center px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold hover:bg-slate-200 transition-colors"
                  >
                    Detail Order
                  </Link>
                </div>

                {/* Content based on tab */}
                {activeTab === 'invoice' && (
                  <div className="flex justify-end pt-2 border-t border-slate-100 mt-2">
                    <button
                      onClick={() => handleAction(o.id, 'issue')}
                      disabled={!canVerify || busyId === o.id}
                      className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold disabled:opacity-50 hover:bg-blue-700 transition-colors"
                    >
                      {busyId === o.id ? 'Memproses...' : 'Terbitkan Invoice'}
                    </button>
                  </div>
                )}

                {activeTab === 'verify' && (
                  <div className="space-y-3 pt-2 border-t border-slate-100 mt-2">
                    <div>
                      <p className="text-xs text-slate-600 mb-1">Bukti Transfer:</p>
                      {proofUrl ? (
                        <button onClick={() => setPreviewUrl(proofUrl)} className="text-xs text-blue-600 font-medium underline hover:text-blue-700">Lihat Bukti</button>
                      ) : (
                        <p className="text-xs text-rose-500 font-medium">Belum ada bukti transfer.</p>
                      )}
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => handleAction(o.id, 'verify', 'approve')}
                        disabled={!canVerify || !proofUrl || busyId === o.id}
                        className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold disabled:opacity-50 hover:bg-emerald-700 transition-colors"
                      >
                        {busyId === o.id ? '...' : 'Approve Payment'}
                      </button>
                      <button
                        onClick={() => handleAction(o.id, 'verify', 'reject')}
                        disabled={!canVerify || busyId === o.id}
                        className="px-4 py-2 bg-rose-500 text-white rounded-xl text-xs font-bold disabled:opacity-50 hover:bg-rose-600 transition-colors"
                      >
                        {busyId === o.id ? '...' : 'Reject'}
                      </button>
                    </div>
                  </div>
                )}

                {activeTab === 'cod' && (
                  <div className="space-y-3 pt-2 border-t border-slate-100 mt-2">
                    <div className="bg-orange-50 border border-orange-100 p-3 rounded-xl">
                      <p className="text-xs text-orange-800 font-bold flex items-center gap-2">
                        <CheckCircle size={14} />
                        Driver sudah mengantar. Pastikan uang cash sebesar {formatCurrency(Number(o.total_amount))} sudah disetor.
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-600 mb-1">Bukti Serah Terima (Driver):</p>
                      {deliveryProofUrl ? (
                        <button onClick={() => setPreviewUrl(deliveryProofUrl)} className="text-xs text-blue-600 font-medium underline hover:text-blue-700">Lihat Foto Serah Terima</button>
                      ) : (
                        <p className="text-xs text-slate-400">-</p>
                      )}
                    </div>
                    <div className="flex justify-end">
                      <button
                        onClick={() => handleAction(o.id, 'cod_settle')}
                        disabled={!canVerify || busyId === o.id}
                        className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold disabled:opacity-50 hover:bg-emerald-700 transition-colors"
                      >
                        {busyId === o.id ? 'Memproses...' : 'Uang Diterima & Selesai'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Preview Modal */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-[120] bg-black/75 p-4 sm:p-8 flex items-center justify-center backdrop-blur-sm"
          onClick={() => setPreviewUrl(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/90 text-slate-800 flex items-center justify-center hover:bg-white transition-colors"
            onClick={() => setPreviewUrl(null)}
          >
            <X size={18} />
          </button>
          <img
            src={previewUrl}
            alt="Preview"
            className="max-w-full max-h-[90vh] object-contain rounded-xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
