'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Printer, ShieldAlert, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { PosSaleRow } from '@/lib/apiTypes';

export default function PosSaleDetailPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir']);
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = String(params?.id || '').trim();

  const [sale, setSale] = useState<PosSaleRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [voiding, setVoiding] = useState(false);

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
  const status = useMemo(() => String(sale?.status || '').trim().toLowerCase(), [sale]);

  const handleVoid = async () => {
    if (!sale?.id) return;
    const reason = window.prompt('Alasan void (opsional):') || '';
    const ok = window.confirm(`Void transaksi ${receipt}? Ini akan mengembalikan stok.`);
    if (!ok) return;

    try {
      setVoiding(true);
      setError('');
      await api.admin.pos.voidSale(String(sale.id), { reason: reason.trim() || undefined });
      await load();
    } catch (e: unknown) {
      const message = typeof e === 'object' && e && 'response' in e
        ? String((e as any).response?.data?.message || '')
        : '';
      setError(message || 'Gagal void transaksi.');
    } finally {
      setVoiding(false);
    }
  };

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/pos" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
            <ArrowLeft size={16} />
            Kembali
          </Link>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">POS</p>
            <h1 className="text-xl font-black text-slate-900">{receipt}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/admin/pos/${encodeURIComponent(id)}/print`}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black uppercase tracking-wide text-white"
          >
            <Printer size={14} />
            Print Struk
          </Link>
          <button
            type="button"
            onClick={handleVoid}
            disabled={voiding || status !== 'paid'}
            className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-black uppercase tracking-wide text-rose-700 disabled:opacity-60"
            title={status !== 'paid' ? 'Hanya transaksi paid yang bisa di-void' : ''}
          >
            <Trash2 size={14} />
            {voiding ? 'Voiding...' : 'Void'}
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
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Kembalian</span>
                <span className="font-black text-emerald-700">{formatCurrency(Number(sale.change_amount || 0))}</span>
              </div>
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
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-700"
            >
              Buat Transaksi Baru
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
