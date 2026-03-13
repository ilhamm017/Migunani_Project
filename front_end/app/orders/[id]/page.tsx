'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Truck, Clock3, CheckCircle2, AlertCircle, PauseCircle, XCircle, RotateCcw, Receipt } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = String(params?.id || '');

  const [order, setOrder] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const loadOrder = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.orders.getOrderById(orderId);
      setOrder(res.data);
    } catch (error) {
      console.error('Failed to load order detail:', error);
      setOrder(null);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    if (orderId) void loadOrder();
  }, [orderId, loadOrder]);

  useRealtimeRefresh({
    enabled: Boolean(orderId),
    onRefresh: loadOrder,
    domains: ['order', 'retur', 'admin'],
    pollIntervalMs: 10000,
    filterOrderIds: orderId ? [orderId] : [],
  });

  const statusView = useMemo(() => {
    const rawStatus = order?.status || 'pending';
    const status = rawStatus === 'waiting_payment' ? 'ready_to_ship' : rawStatus;
    const summaryRows = Array.isArray(order?.item_summaries) ? order.item_summaries : [];
    const activeBackorderQty = summaryRows.reduce((sum: number, row: unknown) => sum + Number(row?.backorder_open_qty || 0), 0);
    const canceledBackorderQty = summaryRows.reduce((sum: number, row: unknown) => sum + Number(row?.backorder_canceled_qty || 0), 0);
    const allocatedTotalQty = summaryRows.reduce((sum: number, row: unknown) => sum + Number(row?.allocated_qty_total || 0), 0);
    if (status === 'canceled') {
      if (allocatedTotalQty > 0 || canceledBackorderQty > 0) {
        return {
          icon: CheckCircle2,
          label: `canceled (Selesai karena sisa dicancel ${canceledBackorderQty > 0 ? `${canceledBackorderQty}` : ''})`,
          className: 'text-slate-700 bg-slate-100'
        };
      }
      return {
        icon: XCircle,
        label: 'canceled (Dibatalkan dari awal)',
        className: 'text-rose-700 bg-rose-50'
      };
    }
    if (canceledBackorderQty > 0 && activeBackorderQty <= 0 && ['partially_fulfilled', 'delivered', 'completed'].includes(status)) {
      return {
        icon: CheckCircle2,
        label: `completed (Selesai karena sisa dicancel ${canceledBackorderQty})`,
        className: 'text-slate-700 bg-slate-100'
      };
    }
    if (activeBackorderQty > 0 && ['delivered', 'completed'].includes(status)) {
      return {
        icon: AlertCircle,
        label: `partially_fulfilled (Pengiriman Parsial, sisa inden ${activeBackorderQty})`,
        className: 'text-amber-700 bg-amber-50'
      };
    }

    if (status === 'pending') {
      return {
        icon: Clock3,
        label: 'pending (Menunggu Review Admin)',
        className: 'text-orange-700 bg-orange-50'
      };
    }
    if (status === 'waiting_invoice') {
      return {
        icon: Clock3,
        label: 'waiting_invoice (Menunggu Invoice)',
        className: 'text-blue-700 bg-blue-50'
      };
    }
    if (status === 'ready_to_ship') {
      return {
        icon: CheckCircle2,
        label: 'ready_to_ship (Siap Dikirim)',
        className: 'text-emerald-700 bg-emerald-50'
      };
    }
    if (status === 'allocated') {
      return {
        icon: CheckCircle2,
        label: 'allocated (Stok Dialokasikan)',
        className: 'text-teal-700 bg-teal-50'
      };
    }
    if (status === 'partially_fulfilled') {
      return {
        icon: AlertCircle,
        label: `partially_fulfilled (Terkirim Sebagian${activeBackorderQty > 0 ? `, sisa inden ${activeBackorderQty}` : ''})`,
        className: 'text-amber-700 bg-amber-50'
      };
    }
    if (status === 'debt_pending') {
      return {
        icon: Clock3,
        label: 'debt_pending (Utang Belum Lunas)',
        className: 'text-amber-700 bg-amber-50'
      };
    }
    if (status === 'waiting_admin_verification') {
      return {
        icon: Clock3,
        label: 'waiting_admin_verification (Menunggu Verifikasi Admin)',
        className: 'text-blue-700 bg-blue-50'
      };
    }
    if (['completed', 'delivered'].includes(status)) {
      return { icon: CheckCircle2, label: 'completed / delivered (Pesanan Selesai)', className: 'text-emerald-600 bg-emerald-50' };
    }
    if (status === 'shipped') {
      return { icon: Truck, label: 'shipped (Sedang Dikirim)', className: 'text-blue-600 bg-blue-50' };
    }
    if (status === 'hold') {
      return { icon: PauseCircle, label: 'hold (Pesanan Bermasalah)', className: 'text-violet-700 bg-violet-50' };
    }
    if (status === 'expired') {
      return { icon: XCircle, label: 'expired (Pesanan Kedaluwarsa)', className: 'text-rose-700 bg-rose-50' };
    }
    return { icon: Clock3, label: 'Status Pesanan', className: 'text-slate-700 bg-slate-100' };
  }, [order?.status, order?.item_summaries]);

  // --- Missing Item Logic ---
  const [showMissingModal, setShowMissingModal] = useState(false);
  const [missingItems, setMissingItems] = useState<{ product_id: string; qty_missing: number; max_qty: number; name: string }[]>([]);
  const [missingNote, setMissingNote] = useState('');
  const [submittingMissing, setSubmittingMissing] = useState(false);

  const openMissingModal = () => {
    if (!order) return;
    // Pre-fill eligible items (qty > 0)
    const items = (order.OrderItems || []).map((item: unknown) => ({
      product_id: item.product_id,
      qty_missing: 0,
      max_qty: Number(item.qty),
      name: item.Product?.name || 'Produk'
    }));
    setMissingItems(items);
    setMissingNote('');
    setShowMissingModal(true);
  };

  const handleMissingQtyChange = (productId: string, qty: number) => {
    setMissingItems(prev => prev.map(p => {
      if (p.product_id === productId) {
        // Ensure within bounds
        const validQty = Math.max(0, Math.min(qty, p.max_qty));
        return { ...p, qty_missing: validQty };
      }
      return p;
    }));
  };

  const submitMissingReport = async () => {
    try {
      const itemsToReport = missingItems
        .filter(i => i.qty_missing > 0)
        .map(i => ({ product_id: i.product_id, qty_missing: i.qty_missing }));

      if (itemsToReport.length === 0) {
        alert('Pilih minimal satu barang yang kurang.');
        return;
      }

      setSubmittingMissing(true);
      await api.orders.reportMissingItem(orderId, {
        items: itemsToReport,
        note: missingNote
      });
      alert('Laporan barang kurang berhasil dikirim. Admin akan segera memverifikasi.');
      setShowMissingModal(false);
      loadOrder(); // Refresh status/issues
    } catch (error: unknown) {
      console.error('Failed to report missing item:', error);
      alert(error.response?.data?.message || 'Gagal mengirim laporan.');
    } finally {
      setSubmittingMissing(false);
    }
  };


  if (loading) {
    return <div className="p-6"><p className="text-sm text-slate-500">Memuat detail pesanan...</p></div>;
  }

  if (!order) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-slate-600">Pesanan tidak ditemukan.</p>
        <Link href="/orders" className="text-sm font-bold text-emerald-700">Kembali ke riwayat pesanan</Link>
      </div>
    );
  }

  const StatusIcon = statusView.icon;
  const orderItems = Array.isArray(order?.OrderItems) ? order.OrderItems : [];
  const itemSummaries = Array.isArray(order?.item_summaries) ? order.item_summaries : [];
  const timeline = Array.isArray(order?.timeline) ? order.timeline : [];
  const allocations = Array.isArray(order?.Allocations) ? order.Allocations : [];
  const hasAnyAllocationData = allocations.length > 0;
  const allocatedQtyByProduct = allocations.reduce((acc: Record<string, number>, allocation: unknown) => {
    const productId = String(allocation?.product_id || '');
    if (!productId) return acc;
    acc[productId] = Number(acc[productId] || 0) + Number(allocation?.allocated_qty || 0);
    return acc;
  }, {});
  const allocatedQtyByItemId = (() => {
    const result: Record<string, number> = {};
    const itemsByProduct = new Map<string, unknown[]>();
    orderItems.forEach((item: unknown) => {
      const productId = String(item?.product_id || '');
      if (!productId) return;
      const rows = itemsByProduct.get(productId) || [];
      rows.push(item);
      itemsByProduct.set(productId, rows);
    });
    itemsByProduct.forEach((rows, productId) => {
      let remaining = Number(allocatedQtyByProduct[productId] || 0);
      const sortedRows = [...rows].sort((a: unknown, b: unknown) => String(a?.id || '').localeCompare(String(b?.id || '')));
      sortedRows.forEach((row: unknown) => {
        const qty = Number(row?.qty || 0);
        const allocated = Math.max(0, Math.min(remaining, qty));
        result[String(row?.id || '')] = allocated;
        remaining -= allocated;
      });
    });
    return result;
  })();
  const summaryByOrderItemId = itemSummaries.reduce((acc: Record<string, unknown>, row: unknown) => {
    const key = String(row?.order_item_id || '');
    if (!key) return acc;
    acc[key] = row;
    return acc;
  }, {});
  const eventLabel = (eventType: string) => {
    if (eventType === 'allocation_set') return 'Alokasi diperbarui';
    if (eventType === 'invoice_issued') return 'Invoice diterbitkan';
    if (eventType === 'invoice_item_billed') return 'Item ditagihkan';
    if (eventType === 'backorder_opened') return 'Backorder terbuka';
    if (eventType === 'backorder_reallocated') return 'Backorder berkurang';
    if (eventType === 'backorder_canceled') return 'Backorder dibatalkan';
    if (eventType === 'order_status_changed') return 'Status order berubah';
    return eventType || 'Event';
  };
  const itemNameById = orderItems.reduce((acc: Record<string, string>, item: unknown) => {
    const key = String(item?.id || '');
    if (!key) return acc;
    acc[key] = String(item?.Product?.name || 'Produk');
    return acc;
  }, {});
  const paymentMethod = String(order?.Invoice?.payment_method || '');
  const paymentStatus = String(order?.Invoice?.payment_status || '');
  const normalizedOrderStatus = String(order?.status || '');
  const needsTransferProof =
    paymentMethod === 'transfer_manual' &&
    paymentStatus !== 'paid' &&
    !['canceled', 'expired'].includes(normalizedOrderStatus);
  const isWaitingFinanceVerification = paymentStatus === 'waiting_admin_verification';
  const invoiceId = String(order?.Invoice?.id || '');

  const customerPaymentStatusLabel = paymentStatus === 'cod_pending'
    ? 'Sudah Dibayar ke Driver'
    : paymentStatus || '-';

  return (
    <div className="p-6 space-y-5 pb-20">
      <button onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
        <ArrowLeft size={16} /> Kembali
      </button>

      <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-black text-slate-900">Order #{order.id}</h1>
            <p className="text-xs text-slate-500">{formatDateTime(order.createdAt)}</p>
          </div>
          <div className={`px-3 py-2 rounded-xl inline-flex items-center gap-2 ${statusView.className}`}>
            <StatusIcon size={14} />
            <span className="text-xs font-bold">{statusView.label}</span>
          </div>
        </div>

        <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
          <p className="text-xs text-slate-600">Invoice: <span className="font-bold text-slate-900">{order.Invoice?.invoice_number || '-'}</span></p>
          <p className="text-xs text-slate-600">Metode Bayar: <span className="font-bold text-slate-900">{order.Invoice?.payment_method || '-'}</span></p>
          <p className="text-xs text-slate-600">Status Bayar: <span className="font-bold text-slate-900">{customerPaymentStatusLabel}</span></p>
        </div>

        {invoiceId && (
          <div
            className={`rounded-[24px] border p-5 space-y-3 ${
              needsTransferProof
                ? isWaitingFinanceVerification
                  ? 'bg-blue-50 border-blue-200'
                  : 'bg-amber-50 border-amber-200'
                : 'bg-slate-50 border-slate-200'
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl ${
                  needsTransferProof
                    ? isWaitingFinanceVerification
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-amber-100 text-amber-700'
                    : 'bg-white text-slate-700'
                }`}
              >
                <Receipt size={18} />
              </div>
              <div className="flex-1 space-y-1">
                <p
                  className={`text-[11px] font-black uppercase tracking-[0.24em] ${
                    needsTransferProof
                      ? isWaitingFinanceVerification
                        ? 'text-blue-700'
                        : 'text-amber-700'
                      : 'text-slate-500'
                  }`}
                >
                  Pembayaran Mengikuti Invoice
                </p>
                <p className="text-sm font-bold text-slate-900">
                  {needsTransferProof
                    ? isWaitingFinanceVerification
                      ? 'Bukti transfer untuk invoice ini sedang diverifikasi admin finance.'
                      : 'Upload bukti transfer dilakukan dari halaman invoice, bukan dari detail order.'
                    : 'Status pembayaran order ini mengikuti invoice terkait.'}
                </p>
                <p className="text-xs text-slate-600">
                  {needsTransferProof
                    ? 'Karena pengiriman dan pembayaran berjalan per invoice, bukti transfer customer diunggah dari halaman invoice agar tidak terpecah per order.'
                    : 'Gunakan halaman invoice untuk melihat tagihan, status bayar, dan bukti pembayaran customer.'}
                </p>
              </div>
            </div>

            <Link
              href={
                needsTransferProof
                  ? `/invoices/${invoiceId}/upload-proof`
                  : `/invoices/${invoiceId}`
              }
              className={`inline-flex w-full items-center justify-center rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-[0.2em] ${
                needsTransferProof
                  ? isWaitingFinanceVerification
                    ? 'bg-white text-blue-700 border border-blue-200'
                    : 'bg-amber-600 text-white'
                  : 'bg-slate-900 text-white'
              }`}
            >
              {needsTransferProof
                ? isWaitingFinanceVerification
                  ? 'Buka Invoice & Lihat Status Verifikasi'
                  : 'Buka Invoice & Upload Bukti Transfer'
                : 'Buka Invoice'}
            </Link>
          </div>
        )}

        {!invoiceId && needsTransferProof && (
          <div
            className={`rounded-[24px] border p-5 space-y-3 ${
              isWaitingFinanceVerification
                ? 'bg-blue-50 border-blue-200'
                : 'bg-amber-50 border-amber-200'
            }`}
          >
            <div className="space-y-1">
              <p
                className={`text-[11px] font-black uppercase tracking-[0.24em] ${
                  isWaitingFinanceVerification ? 'text-blue-700' : 'text-amber-700'
                }`}
              >
                {isWaitingFinanceVerification ? 'Bukti Transfer Sudah Dikirim' : 'Upload Bukti Transfer'}
              </p>
              <p className="text-sm font-bold text-slate-900">
                {isWaitingFinanceVerification
                  ? 'Admin finance sedang memverifikasi bukti pembayaran Anda.'
                  : 'Pembayaran transfer manual terdeteksi untuk order ini.'}
              </p>
              <p className="text-xs text-slate-600">
                {isWaitingFinanceVerification
                  ? 'Tunggu hasil verifikasi. Jika diminta perbaikan, unggah ulang bukti transfer dari tombol di bawah.'
                  : 'Jika pembayaran dilakukan lewat transfer sesuai kesepakatan dengan kurir/admin, unggah bukti transfer di sini agar order bisa diproses.'}
              </p>
            </div>

            <Link
              href={`/orders/${order.id}/upload-proof`}
              className={`inline-flex w-full items-center justify-center rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-[0.2em] ${
                isWaitingFinanceVerification
                  ? 'bg-white text-blue-700 border border-blue-200'
                  : 'bg-amber-600 text-white'
              }`}
            >
              {isWaitingFinanceVerification ? 'Lihat / Upload Ulang Bukti Transfer' : 'Upload Bukti Transfer'}
            </Link>
          </div>
        )}

        {order.active_issue && (
          <div className={`rounded-2xl p-4 border ${order.issue_overdue ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-200'}`}>
            <p className={`text-xs font-bold ${order.issue_overdue ? 'text-rose-700' : 'text-amber-700'}`}>
              Pesanan bermasalah: {order.active_issue.note || 'Barang Kurang'}
            </p>
            <p className={`text-xs mt-1 ${order.issue_overdue ? 'text-rose-700' : 'text-amber-700'}`}>
              Target selesai: {order.active_issue?.due_at ? formatDateTime(order.active_issue.due_at) : '-'}
            </p>
          </div>
        )}

        {order.Returs && order.Returs.length > 0 && (
          <div className="bg-amber-50 border border-amber-100 rounded-[24px] p-5 space-y-3">
            <div className="flex items-center gap-2">
              <RotateCcw size={16} className="text-amber-600" />
              <h3 className="text-xs font-black uppercase tracking-widest text-amber-700">Informasi Retur</h3>
            </div>
            {order.Returs.map((retur: unknown) => (
              <div key={retur.id} className="bg-white/50 rounded-xl p-3 border border-amber-200">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-[11px] font-black text-slate-800">
                      Retur {retur.qty} unit
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">Diajukan: {formatDateTime(retur.createdAt)}</p>
                  </div>
                  <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full border ${retur.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                    retur.status === 'rejected' ? 'bg-rose-50 text-rose-700 border-rose-100' :
                      'bg-amber-100 text-amber-700 border-amber-200'
                    }`}>
                    {retur.status}
                  </span>
                </div>
                {retur.admin_response && (
                  <p className="text-[10px] text-amber-700 mt-2 italic font-medium">{retur.admin_response}</p>
                )}
              </div>
            ))}
            <Link href="/retur" className="block text-center py-2 bg-amber-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-700 transition-colors">
              Lihat Detail & Lacak Semua Retur
            </Link>
          </div>
        )}

        {/* Start: Split Order Info */}
        {order.parent_order_id && (
          <div className="bg-blue-50 border border-blue-100 rounded-[24px] p-4 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-[10px] font-black text-blue-700 uppercase tracking-wider">Pesanan Lanjutan</p>
              <p className="text-xs text-slate-600">Pesanan ini adalah bagian dari pesanan sebelumnya.</p>
            </div>
            <Link href={`/orders/${order.parent_order_id}`} className="bg-white p-2 rounded-xl border border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors">
              <ArrowLeft size={16} />
            </Link>
          </div>
        )}

        {order.Children && order.Children.length > 0 && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-[24px] p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Clock3 size={16} className="text-indigo-600" />
              <h3 className="text-xs font-black uppercase tracking-widest text-indigo-700">Backorder / Pesanan Lanjutan</h3>
            </div>
            <p className="text-xs text-slate-600">Sebagian barang dikirim kemudian karena stok habis. Sisa barang ada di pesanan berikut:</p>
            {order.Children.map((child: unknown) => (
              <Link
                key={child.id}
                href={`/orders/${child.id}`}
                className="flex items-center justify-between bg-white/80 border border-indigo-200 p-3 rounded-2xl hover:bg-white transition-colors group"
              >
                <div>
                  <p className="text-[11px] font-black text-slate-800 uppercase">Order #{child.id.slice(0, 8)}...</p>
                  <p className="text-[10px] text-slate-500">Status: <span className="font-bold">{child.status}</span></p>
                </div>
                <ArrowRight size={16} className="text-indigo-400 group-hover:text-indigo-600 transition-colors" />
              </Link>
            ))}
          </div>
        )}
        {/* End: Split Order Info */}

        <div className="space-y-2">

          <h2 className="text-sm font-bold text-slate-900">Item Pesanan</h2>
          {orderItems.map((item: unknown) => {
            const summary = summaryByOrderItemId[String(item?.id || '')] || null;
            const orderStatus = String(order.status || '').toLowerCase();
            const sentQtyRaw = Number(allocatedQtyByItemId[String(item?.id || '')] || 0);

            // Check if status implies allocation has happened
            const isAllocatedStatus = ['allocated', 'partially_fulfilled', 'waiting_invoice', 'ready_to_ship', 'processing', 'shipped', 'delivered', 'completed'].includes(orderStatus);
            const isDeliveredStatus = ['delivered', 'completed'].includes(orderStatus);
            const isShippingStatus = orderStatus === 'shipped';
            const sentQty = (isDeliveredStatus && !hasAnyAllocationData && sentQtyRaw <= 0)
              ? Number(item.qty || 0)
              : sentQtyRaw;
            const progressLabel = isDeliveredStatus ? 'Diterima' : isShippingStatus ? 'Dikirim' : 'Dialokasikan';

            const isPartial = isAllocatedStatus && sentQty < item.qty;
            const effectivePrice = isAllocatedStatus ? (Number(item.price_at_purchase || 0) * sentQty) : (Number(item.price_at_purchase || 0) * Number(item.qty || 0));
            const orderedOriginal = Number(summary?.ordered_qty_original ?? item.qty ?? 0);
            const allocatedTotal = Number(summary?.allocated_qty_total ?? sentQty ?? 0);
            const invoicedTotal = Number(summary?.invoiced_qty_total ?? 0);
            const backorderOpen = Number(summary?.backorder_open_qty ?? Math.max(0, orderedOriginal - allocatedTotal));
            const backorderCanceled = Number(summary?.backorder_canceled_qty ?? 0);

            return (
              <div key={item.id} className="bg-slate-50 rounded-2xl px-4 py-3 space-y-2">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{item.Product?.name || 'Produk'}</p>
                    <div className="flex gap-4 mt-1">
                      <p className="text-xs text-slate-500">Qty Aktif: <span className="font-bold text-slate-700">{item.qty}</span></p>
                      {isAllocatedStatus ? (
                        <p className={`text-xs ${isPartial ? 'text-amber-600 font-bold' : 'text-emerald-600 font-bold'}`}>
                          {progressLabel}: {sentQty}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-900">{formatCurrency(effectivePrice)}</p>
                    {isPartial && isAllocatedStatus && (
                      <p className="text-[10px] text-amber-600 font-bold">
                        {item.qty - sentQty} {isDeliveredStatus ? 'Belum Diterima' : isShippingStatus ? 'Belum Dikirim' : 'Belum Tersedia (Backorder)'}
                      </p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px]">
                  <div className="rounded-lg bg-white border border-slate-200 px-2 py-1">
                    <p className="text-slate-500">Pesanan Awal</p>
                    <p className="font-bold text-slate-900">{orderedOriginal}</p>
                  </div>
                  <div className="rounded-lg bg-white border border-slate-200 px-2 py-1">
                    <p className="text-slate-500">Total Alokasi</p>
                    <p className="font-bold text-slate-900">{allocatedTotal}</p>
                  </div>
                  <div className="rounded-lg bg-white border border-slate-200 px-2 py-1">
                    <p className="text-slate-500">Invoice</p>
                    <p className="font-bold text-slate-900">{invoicedTotal}</p>
                  </div>
                  <div className="rounded-lg bg-white border border-slate-200 px-2 py-1">
                    <p className="text-slate-500">Backorder Aktif</p>
                    <p className="font-bold text-amber-700">{backorderOpen}</p>
                  </div>
                  <div className="rounded-lg bg-white border border-slate-200 px-2 py-1">
                    <p className="text-slate-500">Backorder Dibatalkan</p>
                    <p className="font-bold text-rose-700">{backorderCanceled}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-bold text-slate-900">Timeline Order</h2>
          {timeline.length === 0 && (
            <div className="bg-slate-50 rounded-2xl px-4 py-3 text-xs text-slate-500">
              Belum ada histori tindakan yang tercatat.
            </div>
          )}
          {timeline.map((evt: unknown) => {
            const eventType = String(evt?.event_type || '');
            const orderItemId = String(evt?.order_item_id || '');
            const payload = evt?.payload || {};
            const delta = payload?.delta || {};
            const itemName = orderItemId ? itemNameById[orderItemId] || `Item #${orderItemId}` : null;
            return (
              <div key={evt?.id || `${eventType}-${evt?.occurred_at || ''}`} className="bg-slate-50 rounded-2xl px-4 py-3 space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">{eventLabel(eventType)}</p>
                  <p className="text-xs font-bold text-slate-800">{evt?.actor_role || '-'}</p>
                </div>
                {itemName && <p className="text-xs text-slate-600">Item: <span className="font-semibold">{itemName}</span></p>}
                {evt?.reason && <p className="text-xs text-rose-700">Alasan: <span className="font-semibold">{evt.reason}</span></p>}
                <p className="text-[11px] text-slate-500">
                  {evt?.occurred_at ? formatDateTime(evt.occurred_at) : '-'}{evt?.actor_role ? ` • oleh ${evt.actor_role}` : ''}
                </p>
                {Object.keys(delta || {}).length > 0 && (
                  <p className="text-[11px] text-slate-600">Perubahan: {JSON.stringify(delta)}</p>
                )}
              </div>
            );
          })}
        </div>

        <div className="bg-slate-900 rounded-3xl p-4 text-white flex justify-between items-center">
          <span className="text-sm">Total</span>
          <span className="text-lg font-black">{formatCurrency(Number(order.total_amount || 0))}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button onClick={loadOrder} className="py-3 bg-slate-100 text-slate-700 rounded-2xl font-bold text-sm">Refresh Status</button>
          {['delivered', 'completed'].includes(order.status) && (
            <>
              <Link href={`/orders/${order.id}/return`} className="py-3 bg-rose-100 text-rose-700 rounded-2xl font-bold text-sm inline-flex items-center justify-center gap-2 hover:bg-rose-200 transition-colors">
                <AlertCircle size={14} /> Ajukan Retur
              </Link>
              <button onClick={openMissingModal} className="py-3 bg-amber-100 text-amber-700 rounded-2xl font-bold text-sm inline-flex items-center justify-center gap-2 hover:bg-amber-200 transition-colors">
                <AlertCircle size={14} /> Lapor Barang Kurang
              </button>
            </>
          )}
        </div>
      </div>

      {/* Missing Item Modal */}
      {showMissingModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
          <div className="bg-white w-full max-w-lg rounded-3xl p-6 space-y-4 animate-in slide-in-from-bottom-10 fade-in duration-300">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-900">Lapor Barang Kurang</h3>
              <button onClick={() => setShowMissingModal(false)} className="bg-slate-100 p-2 rounded-full"><XCircle size={20} className="text-slate-500" /></button>
            </div>

            <p className="text-xs text-slate-500">
              Silakan tandai barang yang tidak Anda terima meskipun status pesanan sudah delivered.
            </p>

            <div className="max-h-[50vh] overflow-y-auto space-y-3">
              {missingItems.map((item) => (
                <div key={item.product_id} className="flex justify-between items-center bg-slate-50 p-3 rounded-xl">
                  <div>
                    <p className="text-sm font-bold text-slate-900">{item.name}</p>
                    <p className="text-xs text-slate-500">Maksimum klaim: {item.max_qty}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleMissingQtyChange(item.product_id, item.qty_missing - 1)}
                      className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-600 font-bold"
                    >-</button>
                    <span className="text-sm font-bold w-4 text-center">{item.qty_missing}</span>
                    <button
                      onClick={() => handleMissingQtyChange(item.product_id, item.qty_missing + 1)}
                      className="w-8 h-8 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center text-emerald-700 font-bold"
                    >+</button>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 mb-1 block">Catatan Tambahan (Opsional)</label>
              <textarea
                value={missingNote}
                onChange={(e) => setMissingNote(e.target.value)}
                placeholder="Contoh: Paket terbuka saat sampai, kurir sudah info..."
                className="w-full text-sm p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-emerald-500 min-h-[80px]"
              />
            </div>

            <button
              onClick={submitMissingReport}
              disabled={submittingMissing}
              className="w-full py-3 bg-emerald-600 text-white font-bold rounded-2xl hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submittingMissing ? 'Mengirim...' : 'Kirim Laporan'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
