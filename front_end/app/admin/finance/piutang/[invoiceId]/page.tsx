'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { ArRow, paymentMethodLabel, paymentStatusLabel, sourceLabel } from '../arShared';

export default function FinanceARDetailPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_finance']);
  const params = useParams();
  const invoiceId = String(params?.invoiceId || '');

  const [row, setRow] = useState<ArRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError('');
        const res = await api.admin.finance.getARById(invoiceId);
        setRow((res.data || null) as ArRow | null);
      } catch (e: any) {
        setRow(null);
        setError(e?.response?.data?.message || 'Gagal memuat detail piutang');
      } finally {
        setLoading(false);
      }
    };

    if (allowed && invoiceId) load();
  }, [allowed, invoiceId]);

  if (!allowed) return null;

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-sm text-slate-500">Memuat detail piutang...</p>
      </div>
    );
  }

  if (!row) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-rose-600">{error || 'Data piutang tidak ditemukan.'}</p>
        <Link href="/admin/finance/piutang" className="text-sm font-bold text-emerald-700">
          Kembali ke daftar piutang
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <Link href="/admin/finance/piutang" className="inline-flex text-sm font-bold text-emerald-700">
        ← Kembali ke daftar piutang
      </Link>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
        <h1 className="text-sm font-black text-slate-900">Detail Piutang</h1>

        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
          <div>
            <p className="text-sm font-black text-slate-900">{row.invoice_number}</p>
            <p className="text-xs text-slate-600 mt-1">
              Order: {row.order?.id || '-'} • Source: <span className="font-bold">{sourceLabel(row.order?.source)}</span>
            </p>
            <p className="text-xs text-slate-600">
              Dibuat: {row.order?.createdAt ? formatDateTime(row.order.createdAt) : '-'} • Umur Piutang: <span className="font-bold">{row.aging_days} hari</span>
            </p>
            <p className="text-xs text-slate-600">
              Status Order: <span className="font-bold text-slate-900">{row.order?.status || '-'}</span>
            </p>
          </div>
          <div className="text-left md:text-right">
            <p className="text-[11px] text-slate-500">Sisa Piutang</p>
            <p className="text-base font-black text-rose-700">{formatCurrency(Number(row.amount_due || 0))}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1.5">
            <p className="text-xs text-slate-600">
              Customer: <span className="font-bold text-slate-900">{row.order?.customer_name || '-'}</span>
            </p>
            <p className="text-xs text-slate-600">
              WhatsApp: <span className="font-bold text-slate-900">{row.order?.customer?.whatsapp_number || '-'}</span>
            </p>
            <p className="text-xs text-slate-600">
              Email: <span className="font-bold text-slate-900">{row.order?.customer?.email || '-'}</span>
            </p>
            <p className="text-xs text-slate-600">
              Kurir: <span className="font-bold text-slate-900">{row.order?.courier?.name || '-'}</span>
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1.5">
            <p className="text-xs text-slate-600">
              Metode Bayar: <span className="font-bold text-slate-900">{paymentMethodLabel(row.payment_method)}</span>
            </p>
            <p className="text-xs text-slate-600">
              Status Bayar: <span className="font-bold text-slate-900">{paymentStatusLabel(row.payment_status)}</span>
            </p>
            <p className="text-xs text-slate-600">
              Invoice Dibuat: <span className="font-bold text-slate-900">{row.createdAt ? formatDateTime(row.createdAt) : '-'}</span>
            </p>
            <p className="text-xs text-slate-600">
              Total Order: <span className="font-bold text-slate-900">{formatCurrency(Number(row.order?.total_amount || 0))}</span>
            </p>
            <p className="text-xs text-slate-600">
              Sudah Dibayar: <span className="font-bold text-slate-900">{formatCurrency(Number(row.amount_paid || 0))}</span>
            </p>
            <p className="text-xs text-slate-600">
              Jatuh Tempo: <span className="font-bold text-slate-900">{row.order?.expiry_date ? formatDateTime(row.order.expiry_date) : '-'}</span>
            </p>
          </div>
        </div>

        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
            <p className="text-xs font-bold text-slate-700">Item yang Dibeli</p>
          </div>
          {(row.order?.items || []).length === 0 ? (
            <p className="p-3 text-xs text-slate-500">Tidak ada detail item.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {(row.order?.items || []).map((item) => (
                <div key={item.id} className="p-3 grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-2 text-xs">
                  <div>
                    <p className="font-bold text-slate-900">{item.product?.name || 'Produk'}</p>
                    <p className="text-slate-500">SKU: {item.product?.sku || '-'}</p>
                  </div>
                  <p className="text-slate-700 md:text-right">Qty: {Number(item.qty || 0)}</p>
                  <p className="text-slate-700 md:text-right">{formatCurrency(Number(item.price_at_purchase || 0))}</p>
                  <p className="font-bold text-slate-900 md:text-right">{formatCurrency(Number(item.subtotal || 0))}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
