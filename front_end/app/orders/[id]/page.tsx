'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Download, Upload, Truck, Clock3, CheckCircle2, AlertCircle, PauseCircle, XCircle, RotateCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = String(params?.id || '');

  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadOrder = async () => {
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
  };

  useEffect(() => {
    if (orderId) loadOrder();
  }, [orderId]);

  const statusView = useMemo(() => {
    const status = order?.status || 'pending';

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
        label: 'partially_fulfilled (Stok Tersedia Sebagian)',
        className: 'text-amber-700 bg-amber-50'
      };
    }
    if (status === 'waiting_payment') {
      const hasProof = !!order?.Invoice?.payment_proof_url;
      return {
        icon: Clock3,
        label: hasProof ? 'waiting_payment (Bukti Terkirim — Menunggu Verifikasi)' : 'waiting_payment (Invoice Terbit — Menunggu Pembayaran)',
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
    if (status === 'processing') {
      return {
        icon: Clock3,
        label: 'processing (Sedang Diproses Gudang)',
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
    if (status === 'canceled' || status === 'expired') {
      return { icon: XCircle, label: 'canceled / expired (Pesanan Dibatalkan)', className: 'text-rose-700 bg-rose-50' };
    }
    return { icon: Clock3, label: 'Status Pesanan', className: 'text-slate-700 bg-slate-100' };
  }, [order?.status]);

  const handleDownloadInvoice = () => {
    if (!order) return;
    const html = `
      <html>
        <head><title>Invoice ${order.Invoice?.invoice_number || order.id}</title></head>
        <body style="font-family: Arial, sans-serif; padding: 24px;">
          <h2>Invoice ${order.Invoice?.invoice_number || '-'}</h2>
          <p>Order ID: ${order.id}</p>
          <p>Tanggal: ${formatDateTime(order.createdAt)}</p>
          <p>Status: ${order.status}</p>
          <hr />
          <p><strong>Total: ${formatCurrency(Number(order.total_amount || 0))}</strong></p>
        </body>
      </html>
    `;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
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

  return (
    <div className="p-6 space-y-5">
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
          <p className="text-xs text-slate-600">Status Bayar: <span className="font-bold text-slate-900">{order.Invoice?.payment_status || '-'}</span></p>
        </div>

        {order.active_issue && (
          <div className={`rounded-2xl p-4 border ${order.issue_overdue ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-200'}`}>
            <p className={`text-xs font-bold ${order.issue_overdue ? 'text-rose-700' : 'text-amber-700'}`}>
              Pesanan bermasalah: barang kurang
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
            {order.Returs.map((retur: any) => (
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
                  <p className="text-[10px] text-amber-700 mt-2 italic font-medium">"{retur.admin_response}"</p>
                )}
              </div>
            ))}
            <Link href="/retur" className="block text-center py-2 bg-amber-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-700 transition-colors">
              Lihat Detail & Lacak Semua Retur
            </Link>
          </div>
        )}

        <div className="space-y-2">

          <h2 className="text-sm font-bold text-slate-900">Item Pesanan</h2>
          {(order.OrderItems || []).map((item: any) => {
            const allocation = order.Allocations?.find((a: any) => a.product_id === item.product_id);
            const sentQty = allocation ? Number(allocation.allocated_qty || 0) : 0;

            // Check if status implies allocation has happened
            const isAllocatedStatus = ['allocated', 'partially_fulfilled', 'waiting_invoice', 'waiting_payment', 'ready_to_ship', 'processing', 'shipped', 'delivered', 'completed'].includes(order.status);

            const isPartial = isAllocatedStatus && sentQty < item.qty;
            const effectivePrice = isAllocatedStatus ? (Number(item.price_at_purchase || 0) * sentQty) : (Number(item.price_at_purchase || 0) * Number(item.qty || 0));

            return (
              <div key={item.id} className="flex justify-between items-center bg-slate-50 rounded-2xl px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{item.Product?.name || 'Produk'}</p>
                  <div className="flex gap-4 mt-1">
                    <p className="text-xs text-slate-500">Dipesan: <span className="font-bold text-slate-700">{item.qty}</span></p>
                    {isAllocatedStatus ? (
                      <p className={`text-xs ${isPartial ? 'text-amber-600 font-bold' : 'text-emerald-600 font-bold'}`}>
                        Dialokasikan: {sentQty}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-slate-900">{formatCurrency(effectivePrice)}</p>
                  {isPartial && isAllocatedStatus && (
                    <p className="text-[10px] text-amber-600 font-bold">
                      {item.qty - sentQty} Belum Tersedia (Backorder)
                    </p>
                  )}
                </div>
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
          <button onClick={handleDownloadInvoice} className="py-3 bg-slate-100 text-slate-700 rounded-2xl font-bold text-sm inline-flex items-center justify-center gap-2">
            <Download size={14} /> Invoice PDF
          </button>
          {order.status === 'waiting_payment' && !order.Invoice?.payment_proof_url && (
            <Link href={`/orders/${order.id}/upload-proof`} className="py-3 bg-emerald-600 text-white rounded-2xl font-bold text-sm inline-flex items-center justify-center gap-2">
              <Upload size={14} /> Upload Bukti
            </Link>
          )}
          {['delivered', 'completed'].includes(order.status) && (
            <Link href={`/orders/${order.id}/return`} className="py-3 bg-rose-100 text-rose-700 rounded-2xl font-bold text-sm inline-flex items-center justify-center gap-2 hover:bg-rose-200 transition-colors">
              <AlertCircle size={14} /> Ajukan Retur
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
