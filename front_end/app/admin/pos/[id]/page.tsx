'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Printer, RotateCcw, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { PosSaleRow } from '@/lib/apiTypes';

export default function PosSaleDetailPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir']);
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = String(params?.id || '').trim();

  const btn3dBase = 'btn-3d disabled:opacity-60';
  const btn3dPrimary = `${btn3dBase} bg-emerald-600 hover:bg-emerald-700 text-white`;
  const btn3dNeutral = `${btn3dBase} bg-white border border-slate-200 text-slate-700 hover:bg-slate-50`;
  const btn3dDanger = `${btn3dBase} bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100`;

  const [sale, setSale] = useState<PosSaleRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refunding, setRefunding] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError('');
      const res = await api.admin.pos.getSaleById(id);
      setSale((res.data || null) as PosSaleRow | null);
    } catch (e: unknown) {
      const message = typeof e === 'object' && e && 'response' in e
        ? String((e as any).response?.data?.message || '')
        : '';
      setError(message || 'Gagal memuat transaksi POS.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!allowed) return;
    void load();
  }, [allowed, load]);

  const receipt = useMemo(() => String(sale?.receipt_number || '').trim() || '-', [sale]);
  const invoiceNumber = useMemo(() => String((sale as any)?.invoice_number || '').trim() || '', [sale]);
  const status = useMemo(() => {
    const raw = String(sale?.status || '').trim().toLowerCase();
    return raw === 'voided' ? 'refunded' : raw;
  }, [sale]);
  const changeAmount = useMemo(() => Number(sale?.change_amount || 0), [sale]);
  const isUnderpay = changeAmount < 0;

  const handleRefund = async () => {
    if (!sale?.id) return;
    const reason = window.prompt('Alasan refund (opsional):') || '';
    const ok = window.confirm(`Refund transaksi ${receipt}? Ini akan mengembalikan stok.`);
    if (!ok) return;

    try {
      setRefunding(true);
      setError('');
      await api.admin.pos.refundSale(String(sale.id), { reason: reason.trim() || undefined });
      await load();
    } catch (e: unknown) {
      const message = typeof e === 'object' && e && 'response' in e
        ? String((e as any).response?.data?.message || '')
        : '';
      setError(message || 'Gagal refund transaksi.');
    } finally {
      setRefunding(false);
    }
  };

  if (!allowed) return null;

  return (
	    <div className="p-6 space-y-5">
	      <div className="flex items-center justify-between gap-3">
	        <div className="flex items-center gap-3">
	          <Link
	            href="/admin/pos"
	            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wide ${btn3dNeutral}`}
	          >
	            <ArrowLeft size={16} />
	            Kembali
	          </Link>
	          <Link
	            href="/admin/pos/history"
	            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wide ${btn3dNeutral}`}
	          >
	            Riwayat
	          </Link>
	          <div>
	            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">POS</p>
	            <h1 className="text-xl font-black text-slate-900">{receipt}</h1>
	            {invoiceNumber ? (
	              <p className="text-[11px] font-bold text-slate-500">Invoice: {invoiceNumber}</p>
	            ) : null}
	          </div>
	        </div>
	        <div className="flex items-center gap-2">
	          <Link
	            href={`/admin/pos/${encodeURIComponent(id)}/print`}
	            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wide ${btn3dPrimary}`}
	          >
	            <Printer size={14} />
	            Print Struk
	          </Link>
	          <button
	            type="button"
	            onClick={handleRefund}
	            disabled={refunding || status !== 'paid'}
	            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wide ${btn3dDanger}`}
	            title={status !== 'paid' ? 'Hanya transaksi paid yang bisa direfund' : ''}
	          >
	            <RotateCcw size={14} />
	            {refunding ? 'Refunding...' : 'Refund'}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 flex items-start gap-2">
          <ShieldAlert size={18} className="mt-0.5" />
          <div className="whitespace-pre-wrap">{error}</div>
        </div>
      ) : null}

      {loading || !sale ? (
        <div className="text-sm text-slate-500">{loading ? 'Memuat...' : 'Tidak ada data.'}</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">
            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
              <p className="text-xs font-black uppercase tracking-widest text-slate-500">Items</p>
              <div className="mt-4 divide-y divide-slate-100 rounded-2xl border border-slate-200 overflow-hidden">
                {(sale.Items || []).map((it) => (
                  <div key={String(it.id || Math.random())} className="px-4 py-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-slate-900">{String(it.name_snapshot || 'Produk')}</p>
                      <p className="text-[11px] text-slate-500">
                        {String(it.sku_snapshot || '-')} • Qty {Number(it.qty || 0)} {String(it.unit_snapshot || '')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-slate-900">{formatCurrency(Number(it.line_total || 0))}</p>
                      <p className="text-[11px] text-slate-500">{formatCurrency(Number(it.unit_price || 0))} / unit</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-5">
	            <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-2">
	              <p className="text-xs font-black uppercase tracking-widest text-slate-500">Ringkasan</p>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Status</span>
                <span className={`font-black ${status === 'paid' ? 'text-emerald-700' : 'text-rose-700'}`}>{status || '-'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Waktu</span>
                <span className="font-bold text-slate-900">{formatDateTime((sale as any).paid_at || (sale as any).paidAt || sale.createdAt)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Customer</span>
                <span className="font-bold text-slate-900">{String(sale.customer_name || '-') || '-'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Subtotal</span>
                <span className="font-black text-slate-900">{formatCurrency(Number(sale.subtotal || 0))}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Diskon</span>
                <span className="font-black text-slate-900">
                  {formatCurrency(Number(sale.discount_amount || 0))}
                  {Number(sale.discount_percent || 0) > 0 ? ` (${Number(sale.discount_percent || 0)}%)` : ''}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Pajak</span>
                <span className="font-black text-slate-900">{formatCurrency(Number(sale.tax_amount || 0))}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Total</span>
                <span className="font-black text-slate-900">{formatCurrency(Number(sale.total || 0))}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Diterima</span>
                <span className="font-black text-slate-900">{formatCurrency(Number(sale.amount_received || 0))}</span>
              </div>
              {isUnderpay ? (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Hutang (kekurangan)</span>
                  <span className="font-black text-rose-700">{formatCurrency(Math.abs(changeAmount))}</span>
                </div>
              ) : (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Kembalian</span>
                  <span className="font-black text-emerald-700">{formatCurrency(Math.max(0, changeAmount))}</span>
                </div>
              )}
	              <div className="flex justify-between text-sm">
	                <span className="text-slate-500">Journal</span>
	                <span className={`font-black ${String((sale as any).journal_status || '') === 'posted' ? 'text-emerald-700' : 'text-rose-700'}`}>
	                  {String((sale as any).journal_status || '-') || '-'}
	                </span>
	              </div>
	              {(sale as any).journal_error ? (
	                <div className="pt-2">
	                  <p className="text-[10px] font-black uppercase tracking-widest text-rose-500">Journal Error</p>
	                  <p className="text-[11px] text-rose-700 whitespace-pre-wrap">{String((sale as any).journal_error)}</p>
	                </div>
	              ) : null}
	              {sale.note ? (
	                <div className="pt-3 border-t border-slate-100">
	                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Catatan</p>
	                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{String(sale.note)}</p>
                </div>
              ) : null}
            </div>

	            <button
	              type="button"
	              onClick={() => router.push('/admin/pos')}
	              className={`w-full rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-wide ${btn3dNeutral}`}
	            >
	              Buat Transaksi Baru
	            </button>
	          </div>
	        </div>
      )}
    </div>
  );
}
