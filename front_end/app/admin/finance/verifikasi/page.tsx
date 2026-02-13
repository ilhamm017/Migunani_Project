'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
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

  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const res = await api.orders.getAllAdmin({ page: 1, limit: 100, status: 'waiting_payment' });
      setOrders(res.data?.orders || []);
    } catch (error) {
      console.error('Failed to load verification orders:', error);
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

  if (!allowed) return null;

  const verify = async (id: string, action: 'approve' | 'reject') => {
    try {
      setBusyId(id);
      await api.admin.finance.verifyPayment(id, action);
      await load();
    } catch (error: any) {
      console.error('Verify failed:', error);
      alert(error?.response?.data?.message || 'Verifikasi gagal.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
        <h1 className="text-xl font-black text-slate-900">Verifikasi Pembayaran</h1>
        <p className="text-xs text-slate-600 mt-1">
          SOP: Cek bukti transfer, cocokkan dengan mutasi rekening bank, lalu lakukan approve/reject.
        </p>
        <p className="text-xs text-slate-600 mt-2">
          Role yang bisa approve/reject: <span className="font-bold">admin_finance</span> dan <span className="font-bold">super_admin</span>.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Memuat data...</p>
      ) : (
        <div className="space-y-3">
          {orders.length === 0 && <p className="text-sm text-slate-500">Tidak ada order menunggu verifikasi.</p>}
          {orders.map((o) => {
            const proofUrl = normalizeProofImageUrl(o.Invoice?.payment_proof_url);
            return (
              <div key={o.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-slate-900">Order #{o.id}</p>
                    <p className="text-xs text-slate-600 mt-1">
                      Invoice: {o.Invoice?.invoice_number || '-'} | Customer: {o.customer_name || '-'}
                    </p>
                    <p className="text-xs text-slate-600">
                      Total: {formatCurrency(Number(o.total_amount || 0))} | Tanggal: {formatDateTime(o.createdAt)}
                    </p>
                  </div>
                  <Link
                    href={`/admin/orders/${o.id}`}
                    className="inline-flex items-center justify-center px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold hover:bg-slate-200 transition-colors"
                  >
                    Buka Detail Order
                  </Link>
                </div>

                <div>
                  <p className="text-xs text-slate-600 mb-2">Bukti Transfer:</p>
                  {!proofUrl ? (
                    <p className="text-xs text-rose-600">Belum ada lampiran bukti transfer.</p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPreviewUrl(proofUrl)}
                      className="w-full md:w-72 bg-slate-100 border border-slate-200 rounded-xl p-2 cursor-zoom-in"
                    >
                      <img
                        src={proofUrl}
                        alt={`Bukti transfer ${o.id}`}
                        className="w-full h-44 object-contain rounded-lg"
                      />
                      <p className="text-[11px] text-slate-500 mt-1">Klik untuk perbesar</p>
                    </button>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => verify(o.id, 'approve')}
                    disabled={!canVerify || !proofUrl || busyId === o.id}
                    className="px-3 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold disabled:opacity-50"
                  >
                    {busyId === o.id ? 'Memproses...' : 'Approve'}
                  </button>
                  <button
                    onClick={() => verify(o.id, 'reject')}
                    disabled={!canVerify || busyId === o.id}
                    className="px-3 py-2 bg-rose-500 text-white rounded-xl text-xs font-bold disabled:opacity-50"
                  >
                    {busyId === o.id ? 'Memproses...' : 'Reject'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {previewUrl && (
        <div
          className="fixed inset-0 z-[120] bg-black/75 p-4 sm:p-8 flex items-center justify-center"
          onClick={() => setPreviewUrl(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/90 text-slate-800 flex items-center justify-center"
            onClick={() => setPreviewUrl(null)}
          >
            <X size={18} />
          </button>
          <img
            src={previewUrl}
            alt="Preview bukti pembayaran"
            className="max-w-full max-h-[90vh] object-contain rounded-xl bg-white"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
