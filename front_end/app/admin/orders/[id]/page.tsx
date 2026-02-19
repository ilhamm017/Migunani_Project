'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, X, AlertTriangle, ExternalLink } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';

const STATUS_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'pending', label: 'pending (Menunggu Review Admin)' },
  { key: 'allocated', label: 'allocated (Stok Dialokasikan)' },
  { key: 'partially_fulfilled', label: 'partially_fulfilled (Stok Tersedia Sebagian)' },
  { key: 'ready_to_ship', label: 'ready_to_ship (Siap Dikirim)' },
  { key: 'waiting_admin_verification', label: 'waiting_admin_verification (Menunggu Verifikasi Admin)' },
  { key: 'debt_pending', label: 'debt_pending (Utang Belum Lunas)' },
  { key: 'shipped', label: 'shipped (Dikirim)' },
  { key: 'delivered', label: 'delivered (Sampai)' },
  { key: 'completed', label: 'completed (Selesai)' },
  { key: 'canceled', label: 'canceled (Dibatalkan)' },
  { key: 'hold', label: 'hold (Bermasalah)' },
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
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'admin_finance', 'kasir']);
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
  const [isVerifyPaymentOpen, setIsVerifyPaymentOpen] = useState(false);
  const [isCancelBackorderOpen, setIsCancelBackorderOpen] = useState(false);
  const [cancelBackorderReason, setCancelBackorderReason] = useState('');

  const canUpdateStatus = useMemo(
    () => !!user && ['super_admin', 'admin_gudang', 'admin_finance'].includes(user.role),
    [user]
  );

  const loadCouriers = async () => {
    try {
      const res = await api.admin.orderManagement.getCouriers();
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
      const normalizedStatus = res.data?.status === 'waiting_payment' ? 'ready_to_ship' : res.data?.status;
      setSelectedStatus(normalizedStatus || 'pending');
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
        setIsVerifyPaymentOpen(false);
        setIsCancelBackorderOpen(false);
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
      await api.admin.orderManagement.updateStatus(orderId, {
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
    if (['shipped', 'waiting_admin_verification'].includes(status)) return 'bg-blue-100 text-blue-700';
    if (status === 'allocated') return 'bg-teal-100 text-teal-700';
    if (status === 'partially_fulfilled') return 'bg-amber-100 text-amber-700';
    if (status === 'canceled') return 'bg-rose-100 text-rose-700';
    if (status === 'debt_pending') return 'bg-amber-100 text-amber-700';
    if (status === 'hold') return 'bg-violet-100 text-violet-700';
    return 'bg-slate-100 text-slate-700';
  };

  const proofImageUrl = normalizeProofImageUrl(order?.Invoice?.payment_proof_url);
  const activeIssue = order?.active_issue || null;
  const issueDueAt = activeIssue?.due_at ? new Date(activeIssue.due_at) : null;
  const isIssueOverdue = Boolean(order?.issue_overdue);
  const normalizedOrderStatus = order?.status === 'waiting_payment' ? 'ready_to_ship' : order?.status;
  const needsCourier = selectedStatus === 'shipped' && order?.source !== 'pos_store';
  const statusChanged = selectedStatus !== normalizedOrderStatus;
  const courierChanged = needsCourier && (selectedCourierId || '') !== (order?.courier_id || '');
  const issueNoteChanged = selectedStatus === 'hold' && ((issueNote || '').trim() !== (activeIssue?.note || '').trim());
  const canSubmitUpdate = canUpdateStatus && !updating && (statusChanged || courierChanged || issueNoteChanged);
  const CANCELABLE_ORDER_STATUSES = ['pending', 'waiting_invoice', 'ready_to_ship', 'allocated', 'partially_fulfilled', 'debt_pending', 'processing', 'hold'];
  const BACKORDER_CANCELABLE_STATUSES = ['pending', 'waiting_invoice', 'ready_to_ship', 'allocated', 'partially_fulfilled', 'debt_pending', 'hold'];
  const canCancelByRole = ['kasir', 'super_admin'].includes(user?.role || '');
  const isOrderCancelable = canCancelByRole && CANCELABLE_ORDER_STATUSES.includes(String(normalizedOrderStatus || ''));

  const orderQtyByProduct = (order?.OrderItems || []).reduce((acc: Record<string, number>, item: any) => {
    const key = String(item?.product_id || '');
    if (!key) return acc;
    acc[key] = Number(acc[key] || 0) + Number(item?.qty || 0);
    return acc;
  }, {});
  const allocQtyByProduct = (order?.Allocations || []).reduce((acc: Record<string, number>, allocation: any) => {
    const key = String(allocation?.product_id || '');
    if (!key) return acc;
    acc[key] = Number(acc[key] || 0) + Number(allocation?.allocated_qty || 0);
    return acc;
  }, {});
  const shortageTotal = Object.entries(orderQtyByProduct).reduce((sum, [productId, orderedQty]) => {
    const allocatedQty = Number(allocQtyByProduct[productId] || 0);
    return sum + Math.max(0, Number(orderedQty || 0) - allocatedQty);
  }, 0);
  const isBackorderCancelable =
    canCancelByRole &&
    BACKORDER_CANCELABLE_STATUSES.includes(String(normalizedOrderStatus || '')) &&
    shortageTotal > 0;

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

        {/* Order Relationships (Split/Backorder) */}
        {(order.parent_order_id || (order.Children && order.Children.length > 0)) && (
          <div className="bg-slate-900 text-white rounded-[24px] p-5 space-y-3">
            <div className="flex items-center gap-2">
              <ExternalLink size={18} className="text-blue-400" />
              <p className="text-sm font-black">Relasi Order (Split / Backorder)</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {order.parent_order_id && (
                <Link
                  href={`/admin/orders/${order.parent_order_id}`}
                  className="bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl p-3 transition-colors"
                >
                  <p className="text-[10px] font-bold text-blue-200 uppercase tracking-wider">Order Induk (Parent)</p>
                  <p className="text-xs font-black mt-0.5">#{order.parent_order_id.slice(-8).toUpperCase()}</p>
                </Link>
              )}
              {order.Children?.map((child: any) => (
                <Link
                  key={child.id}
                  href={`/admin/orders/${child.id}`}
                  className="bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl p-3 transition-colors"
                >
                  <p className="text-[10px] font-bold text-emerald-300 uppercase tracking-wider">Order Anak (Backorder)</p>
                  <p className="text-xs font-black mt-0.5">#{child.id.slice(-8).toUpperCase()}</p>
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-black text-slate-900">Item Pesanan</p>
          </div>
          {(order.OrderItems || []).length === 0 ? (
            <div className="bg-slate-50 rounded-2xl p-4">
              <p className="text-sm text-slate-500">Tidak ada item.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(order.OrderItems || []).map((item: any) => {
                const allocation = order.Allocations?.find((a: any) => a.product_id === item.product_id);
                const allocQty = allocation ? allocation.allocated_qty : 0;
                const isPartial = allocQty > 0 && allocQty < item.qty;
                const isUnallocated = allocQty === 0;

                return (
                  <div key={item.id} className="bg-slate-50 rounded-2xl p-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-slate-900">{item.Product?.name || '-'}</p>
                      <p className="text-xs text-slate-600">
                        SKU: {item.Product?.sku || '-'} | Dipesan: {item.qty} | Harga: {formatCurrency(Number(item.price_at_purchase || 0))}
                      </p>
                      {allocQty > 0 && (
                        <p className={`text-xs mt-0.5 font-bold ${isPartial ? 'text-amber-600' : 'text-emerald-600'}`}>
                          Dialokasikan: {allocQty}{isPartial && ` (kurang ${item.qty - allocQty})`}
                        </p>
                      )}
                      {isUnallocated && ['allocated', 'partially_fulfilled', 'waiting_admin_verification'].includes(order.status) && (
                        <p className="text-xs mt-0.5 font-bold text-rose-500">Belum dialokasikan</p>
                      )}
                    </div>
                    <p className="text-sm font-black text-slate-900">
                      {formatCurrency(
                        Number(item.price_at_purchase || 0) *
                        Number((['pending', 'canceled'].includes(order.status) ? item.qty : allocQty) || 0)
                      )}
                    </p>
                  </div>
                );
              })}
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
          <p className="text-sm font-black text-slate-900">Aksi Order</p>

          {/* Step 1: Kasir — Alokasi sekarang dikelola di halaman Orders */}

          {(isOrderCancelable || isBackorderCancelable) && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-rose-600 uppercase tracking-widest">Aksi Pembatalan (Kasir / Super Admin)</p>
              {isOrderCancelable && (
                <button
                  onClick={async () => {
                    if (!confirm(`Batalkan order #${order.id.slice(-8).toUpperCase()}?`)) return;
                    try {
                      setUpdating(true);
                      setError('');
                      await api.admin.orderManagement.updateStatus(orderId, { status: 'canceled' });
                      await loadOrder();
                    } catch (e: any) {
                      setError(e?.response?.data?.message || 'Gagal membatalkan order');
                    } finally {
                      setUpdating(false);
                    }
                  }}
                  disabled={updating}
                  className="w-full px-4 py-2.5 rounded-xl bg-rose-600 text-white text-sm font-bold disabled:opacity-50 hover:bg-rose-700 transition-colors"
                >
                  {updating ? 'Memproses...' : 'Cancel Order'}
                </button>
              )}
              {isBackorderCancelable && (
                <button
                  onClick={() => setIsCancelBackorderOpen(true)}
                  disabled={updating}
                  className="w-full px-4 py-2.5 rounded-xl bg-white border border-rose-200 text-rose-700 text-sm font-bold disabled:opacity-50 hover:bg-rose-50 transition-colors"
                >
                  Cancel Backorder ({shortageTotal} item kurang)
                </button>
              )}
            </div>
          )}

          {/* Step 2: Kasir — Terbitkan Invoice (waiting_invoice) */}
          {order.status === 'waiting_invoice' && ['kasir', 'super_admin'].includes(user?.role || '') && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Aksi Kasir</p>
              <button
                onClick={async () => {
                  try {
                    setUpdating(true);
                    setError('');
                    await api.admin.finance.issueInvoice(orderId);
                    await loadOrder();
                  } catch (e: any) {
                    setError(e?.response?.data?.message || 'Gagal menerbitkan invoice');
                  } finally {
                    setUpdating(false);
                  }
                }}
                disabled={updating}
                className="w-full px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold disabled:opacity-50 hover:bg-blue-700 transition-colors shadow-sm shadow-blue-200"
              >
                {updating ? 'Memproses...' : 'Terbitkan Invoice'}
              </button>
            </div>
          )}

          {/* Step 3: Finance — Approve/Reject Payment (waiting_admin_verification) */}
          {['waiting_admin_verification'].includes(order.status) && ['admin_finance', 'super_admin'].includes(user?.role || '') && (
            <div className="space-y-3">
              <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Verifikasi Pembayaran (Finance)</p>
              <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100 italic">
                {proofImageUrl ? 'Bukti pembayaran sudah diunggah. Silakan verifikasi di bawah.' : 'Menunggu customer mengunggah bukti pembayaran.'}
              </p>
              {proofImageUrl && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsVerifyPaymentOpen(true)}
                    disabled={updating}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold disabled:opacity-50 hover:bg-emerald-700 transition-colors"
                  >
                    Setujui (Approve)
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm('Tolak pembayaran ini?')) return;
                      try {
                        setUpdating(true);
                        setError('');
                        await api.admin.finance.verifyPayment(orderId, 'reject');
                        await loadOrder();
                      } catch (e: any) {
                        setError(e?.response?.data?.message || 'Gagal reject');
                      } finally {
                        setUpdating(false);
                      }
                    }}
                    disabled={updating}
                    className="px-4 py-2.5 rounded-xl bg-rose-500 text-white text-sm font-bold disabled:opacity-50"
                  >
                    Tolak
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Step 4: Gudang — Assign Driver (ready_to_ship) */}
          {normalizedOrderStatus === 'ready_to_ship' && ['admin_gudang', 'super_admin'].includes(user?.role || '') && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">Aksi Gudang / Logistik</p>
              <p className="text-xs text-slate-600">Barang siap dikirim. Pilih driver.</p>
              <select
                value={selectedCourierId}
                onChange={(e) => setSelectedCourierId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:border-amber-400 outline-none"
                disabled={updating}
              >
                <option value="">Pilih driver/kurir</option>
                {couriers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.display_name || item.name || 'Driver'}
                  </option>
                ))}
              </select>
              <button
                onClick={async () => {
                  if (!selectedCourierId) { setError('Pilih driver terlebih dahulu'); return; }
                  try {
                    setUpdating(true);
                    setError('');
                    await api.admin.orderManagement.updateStatus(orderId, { status: 'shipped', courier_id: selectedCourierId });
                    await loadOrder();
                  } catch (e: any) {
                    setError(e?.response?.data?.message || 'Gagal assign driver');
                  } finally {
                    setUpdating(false);
                  }
                }}
                disabled={updating || !selectedCourierId}
                className="w-full px-4 py-2.5 rounded-xl bg-amber-600 text-white text-sm font-bold disabled:opacity-50 hover:bg-amber-700 transition-colors shadow-sm shadow-amber-200"
              >
                {updating ? 'Memproses...' : 'Kirim dengan Driver →'}
              </button>
            </div>
          )}

          {/* Step 6: Gudang/Finance — Mark Completed (delivered) */}
          {normalizedOrderStatus === 'delivered' && ['admin_gudang', 'admin_finance', 'super_admin'].includes(user?.role || '') && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Konfirmasi Akhir</p>
              <button
                onClick={async () => {
                  try {
                    setUpdating(true);
                    setError('');
                    await api.admin.orderManagement.updateStatus(orderId, { status: 'completed' });
                    await loadOrder();
                  } catch (e: any) {
                    setError(e?.response?.data?.message || 'Gagal tandai selesai');
                  } finally {
                    setUpdating(false);
                  }
                }}
                disabled={updating}
                className="w-full px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold disabled:opacity-50 hover:bg-emerald-700 transition-colors shadow-sm shadow-emerald-200"
              >
                {updating ? 'Memproses...' : 'Selesaikan Order ✓'}
              </button>
            </div>
          )}

          {/* Delivery proof display */}
          {order.delivery_proof_url && (
            <div className="pt-1">
              <p className="text-xs text-slate-600 mb-2">Bukti Serah Terima Driver:</p>
              <div className="bg-white border border-slate-200 rounded-xl p-2">
                <img
                  src={normalizeProofImageUrl(order.delivery_proof_url) || ''}
                  alt="Bukti serah terima"
                  className="w-full max-h-72 object-contain rounded-lg bg-slate-100"
                />
              </div>
            </div>
          )}

          {/* Super Admin Override */}
          {user?.role === 'super_admin' && (
            <div className="border-t border-slate-200 pt-3 mt-3 space-y-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Override Manual (Super Admin)</p>
              <div className="flex gap-2">
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                  disabled={updating}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
                <button
                  onClick={async () => {
                    try {
                      setUpdating(true);
                      setError('');
                      const payload: any = { status: selectedStatus };
                      if (selectedStatus === 'shipped' && selectedCourierId) payload.courier_id = selectedCourierId;
                      if (selectedStatus === 'hold') { payload.issue_type = 'shortage'; payload.issue_note = issueNote; }
                      await api.admin.orderManagement.updateStatus(orderId, payload);
                      await loadOrder();
                    } catch (e: any) {
                      setError(e?.response?.data?.message || 'Gagal update status');
                    } finally {
                      setUpdating(false);
                    }
                  }}
                  disabled={updating || selectedStatus === normalizedOrderStatus}
                  className="px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold disabled:opacity-50"
                >
                  Override
                </button>
              </div>
              {selectedStatus === 'shipped' && (
                <select
                  value={selectedCourierId}
                  onChange={(e) => setSelectedCourierId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                >
                  <option value="">Pilih driver</option>
                  {couriers.map((item) => (
                    <option key={item.id} value={item.id}>{item.display_name || item.name || 'Driver'}</option>
                  ))}
                </select>
              )}
              {selectedStatus === 'hold' && (
                <textarea
                  value={issueNote}
                  onChange={(e) => setIssueNote(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm min-h-20"
                  placeholder="Catatan masalah"
                />
              )}
            </div>
          )}

          <button
            onClick={handleRefresh}
            disabled={loading || updating}
            className="w-full px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold inline-flex items-center justify-center gap-2"
          >
            <RefreshCw size={14} />
            Refresh
          </button>

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

      {/* Confirmation Modal for Payment Verification */}
      {isVerifyPaymentOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4 animate-in fade-in zoom-in duration-200">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 text-amber-600">
                <AlertTriangle size={20} />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-slate-900 text-lg">Konfirmasi Verifikasi</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Pastikan uang sudah masuk ke rekening toko. Apakah Anda yakin ingin melanjutkan?
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setIsVerifyPaymentOpen(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-50 transition-colors"
                disabled={updating}
              >
                Batal
              </button>
              <button
                onClick={async () => {
                  try {
                    setUpdating(true);
                    setError('');
                    await api.admin.finance.verifyPayment(orderId, 'approve');
                    setIsVerifyPaymentOpen(false);
                    await loadOrder();
                  } catch (e: any) {
                    setError(e?.response?.data?.message || 'Gagal approve');
                    setIsVerifyPaymentOpen(false);
                  } finally {
                    setUpdating(false);
                  }
                }}
                disabled={updating}
                className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition-colors inline-flex items-center justify-center gap-2"
              >
                {updating ? 'Memproses...' : 'Ya, Verifikasi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isCancelBackorderOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="space-y-1">
              <h3 className="font-bold text-slate-900 text-lg">Cancel Backorder</h3>
              <p className="text-sm text-slate-600">
                Order ini masih kekurangan alokasi <span className="font-bold text-rose-600">{shortageTotal}</span> item.
                Isi alasan pembatalan untuk catatan order.
              </p>
            </div>
            <textarea
              value={cancelBackorderReason}
              onChange={(e) => setCancelBackorderReason(e.target.value)}
              rows={4}
              placeholder="Contoh: customer tidak ingin menunggu restock."
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-rose-400"
            />
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  if (updating) return;
                  setIsCancelBackorderOpen(false);
                  setCancelBackorderReason('');
                }}
                disabled={updating}
                className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-50 transition-colors"
              >
                Batal
              </button>
              <button
                onClick={async () => {
                  const reason = cancelBackorderReason.trim();
                  if (reason.length < 5) {
                    setError('Alasan cancel backorder minimal 5 karakter.');
                    return;
                  }
                  try {
                    setUpdating(true);
                    setError('');
                    await api.allocation.cancelBackorder(orderId, reason);
                    setIsCancelBackorderOpen(false);
                    setCancelBackorderReason('');
                    await loadOrder();
                  } catch (e: any) {
                    setError(e?.response?.data?.message || 'Gagal cancel backorder');
                  } finally {
                    setUpdating(false);
                  }
                }}
                disabled={updating}
                className="flex-1 px-4 py-2.5 rounded-xl bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 transition-colors"
              >
                {updating ? 'Memproses...' : 'Ya, Cancel Backorder'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
