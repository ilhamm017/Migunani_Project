'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, X } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';

const STATUS_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'pending', label: 'Pending' },
  { key: 'waiting_payment', label: 'Menunggu Verifikasi Pembayaran' },
  { key: 'processing', label: 'Diproses Gudang' },
  { key: 'debt_pending', label: 'Utang Belum Lunas' },
  { key: 'shipped', label: 'Dikirim' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'completed', label: 'Selesai' },
  { key: 'canceled', label: 'Dibatalkan' },
  { key: 'hold', label: 'Bermasalah (Barang Kurang)' },
];

const normalizeProofImageUrl = (raw?: string | null) => {
  if (!raw) return null;
  const val = String(raw).trim();
  if (!val) return null;

  if (val.startsWith('http://') || val.startsWith('https://')) {
    return val;
  }

  if (val.startsWith('/uploads/')) {
    return val;
  }

  if (val.startsWith('uploads/')) {
    return `/${val}`;
  }

  const normalizedSlash = val.replace(/\\/g, '/');
  if (normalizedSlash.startsWith('uploads/')) {
    return `/${normalizedSlash}`;
  }
  const uploadsIndex = normalizedSlash.indexOf('/uploads/');
  if (uploadsIndex >= 0) {
    return normalizedSlash.slice(uploadsIndex);
  }

  return val;
};

export default function AdminOrderDetailPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'admin_finance']);
  const { user } = useAuthStore();
  const params = useParams();
  const router = useRouter();
  const orderId = String(params?.id || '');

  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState('pending');
  const [couriers, setCouriers] = useState<any[]>([]);
  const [selectedCourierId, setSelectedCourierId] = useState('');
  const [issueNote, setIssueNote] = useState('');
  const [error, setError] = useState('');
  const [proofLoadError, setProofLoadError] = useState(false);
  const [isProofPreviewOpen, setIsProofPreviewOpen] = useState(false);

  const canUpdateStatus = useMemo(
    () => !!user && ['super_admin', 'admin_gudang'].includes(user.role),
    [user]
  );

  const loadCouriers = async () => {
    try {
      const res = await api.orders.getCouriers();
      setCouriers(res.data?.employees || []);
    } catch (e) {
      console.error('Failed to load couriers:', e);
    }
  };

  const loadOrder = async () => {
    try {
      setError('');
      setLoading(true);
      const res = await api.orders.getOrderById(orderId);
      setOrder(res.data);
      setSelectedStatus(res.data?.status || 'pending');
      setSelectedCourierId(res.data?.courier_id || '');
      setIssueNote(res.data?.active_issue?.note || '');
      setProofLoadError(false);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Gagal memuat detail order');
      setOrder(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (allowed && orderId) {
      loadOrder();
    }
  }, [allowed, orderId]);

  useEffect(() => {
    if (allowed && canUpdateStatus) {
      loadCouriers();
    }
  }, [allowed, canUpdateStatus]);

  useEffect(() => {
    if (allowed && canUpdateStatus && selectedStatus === 'shipped') {
      loadCouriers();
    }
  }, [allowed, canUpdateStatus, selectedStatus]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsProofPreviewOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleUpdateStatus = async () => {
    if (!orderId || !selectedStatus) return;
    try {
      const needsCourier = selectedStatus === 'shipped' && order?.source !== 'pos_store';
      if (needsCourier && !selectedCourierId) {
        setError('Status dikirim wajib memilih driver/kurir.');
        return;
      }

      setUpdating(true);
      setError('');
      await api.orders.updateStatusAdmin(orderId, {
        status: selectedStatus,
        courier_id: needsCourier ? selectedCourierId : undefined,
        issue_type: selectedStatus === 'hold' ? 'shortage' : undefined,
        issue_note: selectedStatus === 'hold' ? issueNote : undefined,
      });
      await loadOrder();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Gagal update status order');
    } finally {
      setUpdating(false);
    }
  };

  const handleRefresh = async () => {
    await loadOrder();
    if (canUpdateStatus) {
      await loadCouriers();
    }
  };

  const statusBadgeClass = (status: string) => {
    if (['completed', 'delivered'].includes(status)) return 'bg-emerald-100 text-emerald-700';
    if (['shipped', 'processing'].includes(status)) return 'bg-blue-100 text-blue-700';
    if (status === 'canceled') return 'bg-rose-100 text-rose-700';
    if (status === 'waiting_payment' || status === 'debt_pending') return 'bg-amber-100 text-amber-700';
    if (status === 'hold') return 'bg-violet-100 text-violet-700';
    return 'bg-slate-100 text-slate-700';
  };

  const proofImageUrl = normalizeProofImageUrl(order?.Invoice?.payment_proof_url);
  const activeIssue = order?.active_issue || null;
  const issueDueAt = activeIssue?.due_at ? new Date(activeIssue.due_at) : null;
  const isIssueOverdue = Boolean(order?.issue_overdue);
  const needsCourier = selectedStatus === 'shipped' && order?.source !== 'pos_store';
  const statusChanged = selectedStatus !== order?.status;
  const courierChanged = needsCourier && (selectedCourierId || '') !== (order?.courier_id || '');
  const issueNoteChanged = selectedStatus === 'hold' && ((issueNote || '').trim() !== (activeIssue?.note || '').trim());
  const canSubmitUpdate = canUpdateStatus && !updating && (statusChanged || courierChanged || issueNoteChanged);

  if (!allowed) return null;

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-sm text-slate-500">Memuat detail order...</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-rose-600">{error || 'Order tidak ditemukan'}</p>
        <Link href="/admin/orders" className="text-sm font-bold text-emerald-700">Kembali ke daftar order</Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
        <ArrowLeft size={16} /> Kembali
      </button>

      <div className="bg-white border border-slate-200 rounded-[28px] p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-xl font-black text-slate-900">Detail Order #{order.id}</h1>
            <p className="text-xs text-slate-500 mt-1">Dibuat: {formatDateTime(order.createdAt)}</p>
          </div>
          <span className={`text-[11px] font-bold px-3 py-2 rounded-full uppercase w-fit ${statusBadgeClass(order.status)}`}>
            {order.status}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
            <p className="text-xs text-slate-600">Customer Name: <span className="font-bold text-slate-900">{order.customer_name || '-'}</span></p>
            <p className="text-xs text-slate-600">Customer ID: <span className="font-bold text-slate-900">{order.customer_id || '-'}</span></p>
            <p className="text-xs text-slate-600">Source: <span className="font-bold text-slate-900 uppercase">{order.source || '-'}</span></p>
            <p className="text-xs text-slate-600">Courier ID: <span className="font-bold text-slate-900">{order.courier_id || '-'}</span></p>
            <p className="text-xs text-slate-600">Courier Name: <span className="font-bold text-slate-900">{order.courier_display_name || order.Courier?.name || '-'}</span></p>
            <p className="text-xs text-slate-600">Expiry Date: <span className="font-bold text-slate-900">{order.expiry_date ? formatDateTime(order.expiry_date) : '-'}</span></p>
          </div>

          <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
            <p className="text-xs text-slate-600">Invoice: <span className="font-bold text-slate-900">{order.Invoice?.invoice_number || '-'}</span></p>
            <p className="text-xs text-slate-600">Payment Method: <span className="font-bold text-slate-900">{order.Invoice?.payment_method || '-'}</span></p>
            <p className="text-xs text-slate-600">Payment Status: <span className="font-bold text-slate-900">{order.Invoice?.payment_status || '-'}</span></p>
            <p className="text-xs text-slate-600">Amount Paid: <span className="font-bold text-slate-900">{formatCurrency(Number(order.Invoice?.amount_paid || 0))}</span></p>
            <div className="pt-1">
              <p className="text-xs text-slate-600 mb-2">Bukti Transfer:</p>
              {!proofImageUrl ? (
                <p className="text-xs font-bold text-slate-900">-</p>
              ) : proofLoadError ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <p className="text-xs text-amber-700">
                    Gambar tidak bisa dimuat. URL: <span className="font-bold">{proofImageUrl}</span>
                  </p>
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-xl p-2">
                  <button
                    type="button"
                    onClick={() => setIsProofPreviewOpen(true)}
                    className="w-full cursor-zoom-in"
                  >
                    <img
                      src={proofImageUrl}
                      alt="Bukti pembayaran"
                      className="w-full max-h-72 object-contain rounded-lg bg-slate-100"
                      onError={() => setProofLoadError(true)}
                    />
                  </button>
                  <p className="text-[11px] text-slate-500 mt-2">Klik gambar untuk memperbesar.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-black text-slate-900">Item Pesanan</p>
          {(order.OrderItems || []).length === 0 ? (
            <div className="bg-slate-50 rounded-2xl p-4">
              <p className="text-sm text-slate-500">Tidak ada item.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(order.OrderItems || []).map((item: any) => (
                <div key={item.id} className="bg-slate-50 rounded-2xl p-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-900">{item.Product?.name || '-'}</p>
                    <p className="text-xs text-slate-600">
                      SKU: {item.Product?.sku || '-'} | Qty: {item.qty} | Harga: {formatCurrency(Number(item.price_at_purchase || 0))}
                    </p>
                  </div>
                  <p className="text-sm font-black text-slate-900">
                    {formatCurrency(Number(item.price_at_purchase || 0) * Number(item.qty || 0))}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-slate-900 text-white rounded-2xl p-4 flex items-center justify-between">
          <p className="text-sm">Total Order</p>
          <p className="text-lg font-black">{formatCurrency(Number(order.total_amount || 0))}</p>
        </div>

        {activeIssue && (
          <div className={`border rounded-2xl p-4 ${isIssueOverdue ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-200'}`}>
            <p className={`text-sm font-black ${isIssueOverdue ? 'text-rose-700' : 'text-amber-700'}`}>
              Order Bermasalah: Barang Kurang
            </p>
            <p className={`text-xs mt-1 ${isIssueOverdue ? 'text-rose-700' : 'text-amber-700'}`}>
              Deadline penyelesaian: <span className="font-bold">{issueDueAt ? formatDateTime(issueDueAt) : '-'}</span> (maks 2x24 jam)
            </p>
            {activeIssue.note && (
              <p className={`text-xs mt-1 ${isIssueOverdue ? 'text-rose-700' : 'text-amber-700'}`}>
                Catatan masalah: <span className="font-semibold">{activeIssue.note}</span>
              </p>
            )}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
          <p className="text-sm font-black text-slate-900">Update Proses Order</p>
          <p className="text-xs text-slate-600">
            Update status order dilakukan dari halaman detail ini agar alur verifikasi lebih jelas.
          </p>
          <div className="flex flex-col gap-2">
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
              disabled={!canUpdateStatus || updating}
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status.key} value={status.key}>{status.label}</option>
              ))}
            </select>

            {needsCourier && (
              <select
                value={selectedCourierId}
                onChange={(e) => setSelectedCourierId(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                disabled={!canUpdateStatus || updating}
              >
                <option value="">Pilih driver/kurir</option>
                {couriers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.display_name || item.name || item.whatsapp_number || 'Driver'}
                  </option>
                ))}
              </select>
            )}

            {selectedStatus === 'hold' && (
              <textarea
                value={issueNote}
                onChange={(e) => setIssueNote(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm min-h-20"
                placeholder="Catatan masalah barang kurang (opsional). SLA penyelesaian otomatis 2x24 jam."
                disabled={!canUpdateStatus || updating}
              />
            )}

            <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={handleUpdateStatus}
              disabled={!canSubmitUpdate}
              className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold disabled:opacity-50"
            >
              {updating ? 'Menyimpan...' : 'Simpan Status'}
            </button>
            <button
              onClick={handleRefresh}
              disabled={loading || updating}
              className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold inline-flex items-center justify-center gap-2"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
            </div>
          </div>
          {!canUpdateStatus && (
            <p className="text-xs text-amber-700">
              Role kamu hanya bisa melihat detail order. Update status hanya untuk `super_admin` dan `admin_gudang`.
            </p>
          )}
          {error && <p className="text-xs text-rose-600">{error}</p>}
        </div>
      </div>

      {isProofPreviewOpen && proofImageUrl && (
        <div
          className="fixed inset-0 z-[120] bg-black/75 p-4 sm:p-8 flex items-center justify-center"
          onClick={() => setIsProofPreviewOpen(false)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/90 text-slate-800 flex items-center justify-center"
            onClick={() => setIsProofPreviewOpen(false)}
          >
            <X size={18} />
          </button>
          <img
            src={proofImageUrl}
            alt="Preview bukti pembayaran"
            className="max-w-full max-h-[90vh] object-contain rounded-xl bg-white"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
