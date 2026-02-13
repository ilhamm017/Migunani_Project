'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Download, Upload, Truck, Clock3, CheckCircle2, AlertCircle, PauseCircle, XCircle } from 'lucide-react';
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

    if (status === 'waiting_payment') {
      return {
        icon: Clock3,
        label: 'Menunggu Verifikasi Pembayaran',
        className: 'text-amber-700 bg-amber-50'
      };
    }
    if (status === 'debt_pending') {
      return {
        icon: Clock3,
        label: 'Utang Belum Lunas',
        className: 'text-amber-700 bg-amber-50'
      };
    }
    if (status === 'pending') {
      return {
        icon: AlertCircle,
        label: 'Menunggu Pembayaran',
        className: 'text-orange-700 bg-orange-50'
      };
    }
    if (status === 'processing') {
      return {
        icon: Clock3,
        label: 'Sedang Diproses Gudang',
        className: 'text-blue-700 bg-blue-50'
      };
    }
    if (['completed', 'delivered'].includes(status)) {
      return { icon: CheckCircle2, label: 'Pesanan Selesai', className: 'text-emerald-600 bg-emerald-50' };
    }
    if (status === 'shipped') {
      return { icon: Truck, label: 'Sedang Dikirim', className: 'text-blue-600 bg-blue-50' };
    }
    if (status === 'hold') {
      return { icon: PauseCircle, label: 'Pesanan Bermasalah (Barang Kurang)', className: 'text-violet-700 bg-violet-50' };
    }
    if (status === 'canceled' || status === 'expired') {
      return { icon: XCircle, label: 'Pesanan Dibatalkan', className: 'text-rose-700 bg-rose-50' };
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

        <div className="space-y-2">
          <h2 className="text-sm font-bold text-slate-900">Item Pesanan</h2>
          {(order.OrderItems || []).map((item: any) => (
            <div key={item.id} className="flex justify-between items-center bg-slate-50 rounded-2xl px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">{item.Product?.name || 'Produk'}</p>
                <p className="text-xs text-slate-500">Qty: {item.qty}</p>
              </div>
              <p className="text-sm font-bold text-slate-900">{formatCurrency(Number(item.price_at_purchase || 0) * Number(item.qty || 0))}</p>
            </div>
          ))}
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
          <Link href={`/orders/${order.id}/upload-proof`} className="py-3 bg-emerald-600 text-white rounded-2xl font-bold text-sm inline-flex items-center justify-center gap-2">
            <Upload size={14} /> Upload Bukti
          </Link>
        </div>
      </div>
    </div>
  );
}
