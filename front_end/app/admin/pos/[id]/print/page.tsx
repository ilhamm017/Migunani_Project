'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { PosSaleRow } from '@/lib/apiTypes';

const RECEIPT_WIDTH_MM = 58;

export default function PosSalePrintPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir']);
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = String(params?.id || '').trim();
  const autoPrint = (searchParams?.get('autoPrint') || '') === '1';
  const closeAfterPrint = (searchParams?.get('closeAfterPrint') || '') === '1';
  const hasPrintedRef = useRef(false);

  const [sale, setSale] = useState<PosSaleRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const changeAmount = useMemo(() => Number(sale?.change_amount || 0), [sale]);
  const isUnderpay = changeAmount < 0;

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
      setError(message || 'Gagal memuat data struk.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!allowed) return;
    void load();
  }, [allowed, load]);

  useEffect(() => {
    if (!allowed) return;
    if (!autoPrint) return;
    if (loading || error || !sale) return;
    if (hasPrintedRef.current) return;
    hasPrintedRef.current = true;
    window.setTimeout(() => {
      try {
        window.focus();
      } catch { }
      window.print();
    }, 350);
  }, [allowed, autoPrint, error, loading, sale]);

  useEffect(() => {
    if (!allowed) return;
    if (!closeAfterPrint) return;
    const onAfterPrint = () => {
      try {
        window.close();
      } catch { }
    };
    window.addEventListener('afterprint', onAfterPrint);
    return () => window.removeEventListener('afterprint', onAfterPrint);
  }, [allowed, closeAfterPrint]);

  const receipt = useMemo(() => String(sale?.receipt_number || '').trim() || '-', [sale]);
  const invoiceNumber = useMemo(() => String((sale as any)?.invoice_number || '').trim() || '', [sale]);
  const paidAt = useMemo(() => (sale as any)?.paid_at || (sale as any)?.paidAt || sale?.createdAt, [sale]);

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-4 print:p-0 print:space-y-0">
      <style>{`
        @media print {
          @page { size: ${RECEIPT_WIDTH_MM}mm auto; margin: 0; }
          html, body { background: #fff !important; }
          body { margin: 0 !important; padding: 0 !important; }
          .receipt-wrap { max-width: none !important; width: ${RECEIPT_WIDTH_MM}mm !important; margin: 0 !important; }
          .receipt {
            border: 0 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            padding: 2.5mm !important;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important;
            font-variant-numeric: tabular-nums;
          }
          .receipt, .receipt * { font-size: 12px !important; line-height: 1.25 !important; }
          .receipt .receipt-title { font-size: 13px !important; font-weight: 800 !important; }
          .receipt .receipt-subtitle { font-size: 12px !important; font-weight: 700 !important; }
        }
      `}</style>
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href={`/admin/pos/${encodeURIComponent(id)}`} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
          <ArrowLeft size={16} />
          Kembali
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black uppercase tracking-wide text-white"
        >
          <Printer size={14} />
          Print
        </button>
      </div>
      <p className="text-[12px] text-slate-500 print:hidden">
        Catatan: hasil struk sangat dipengaruhi setting dialog print. Rekomendasi: pilih ukuran kertas 58mm, margin = none, scale = 100% (jangan “fit to page”), matikan header/footer.
      </p>

      {error ? <p className="text-sm text-rose-700 print:hidden">{error}</p> : null}
      {loading || !sale ? (
        <p className="text-sm text-slate-500 print:hidden">{loading ? 'Memuat...' : 'Tidak ada data.'}</p>
      ) : (
        <div className="receipt-wrap mx-auto max-w-md">
          <div className="receipt rounded-2xl border border-slate-200 bg-white p-5 shadow-sm print:border-0 print:shadow-none">
            <div className="text-center">
              <p className="receipt-title text-sm font-black text-slate-900">MIGUNANI MOTOR</p>
              <p className="receipt-subtitle text-[11px] text-slate-500">STRUK POS</p>
            </div>

	            <div className="mt-4 text-[12px]">
	              <div className="flex justify-between">
	                <span className="text-slate-500">No Struk</span>
	                <span className="font-bold text-slate-900">{receipt}</span>
	              </div>
	              {invoiceNumber ? (
	                <div className="flex justify-between">
	                  <span className="text-slate-500">No Invoice</span>
	                  <span className="font-bold text-slate-900">{invoiceNumber}</span>
	                </div>
	              ) : null}
	              <div className="flex justify-between">
	                <span className="text-slate-500">Waktu</span>
	                <span className="font-bold text-slate-900">{formatDateTime(paidAt)}</span>
	              </div>
              {sale.customer_name ? (
                <div className="flex justify-between">
                  <span className="text-slate-500">Customer</span>
                  <span className="font-bold text-slate-900">{String(sale.customer_name)}</span>
                </div>
              ) : null}
            </div>

            <div className="my-4 border-t border-dashed border-slate-300" />

            <div className="space-y-2 text-[12px]">
              {(sale.Items || []).map((it) => (
                <div key={String(it.id || Math.random())}>
                  <div className="flex justify-between gap-3">
                    <span className="font-bold text-slate-900">{String(it.name_snapshot || 'Produk')}</span>
                    <span className="font-bold text-slate-900">{formatCurrency(Number(it.line_total || 0))}</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>
                      {Number(it.qty || 0)} x {formatCurrency(Number(it.unit_price || 0))}
                    </span>
                    <span>{String(it.sku_snapshot || '-')}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="my-4 border-t border-dashed border-slate-300" />

            <div className="space-y-1 text-[12px]">
              <div className="flex justify-between">
                <span className="text-slate-500">Subtotal</span>
                <span className="font-bold text-slate-900">{formatCurrency(Number(sale.subtotal || 0))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Diskon</span>
                <span className="font-bold text-slate-900">
                  {formatCurrency(Number(sale.discount_amount || 0))}
                  {Number(sale.discount_percent || 0) > 0 ? ` (${Number(sale.discount_percent || 0)}%)` : ''}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Pajak</span>
                <span className="font-bold text-slate-900">{formatCurrency(Number(sale.tax_amount || 0))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Total</span>
                <span className="font-black text-slate-900">{formatCurrency(Number(sale.total || 0))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Diterima</span>
                <span className="font-bold text-slate-900">{formatCurrency(Number(sale.amount_received || 0))}</span>
              </div>
              {isUnderpay ? (
                <div className="flex justify-between">
                  <span className="text-slate-500">Hutang (kekurangan)</span>
                  <span className="font-bold text-slate-900">{formatCurrency(Math.abs(changeAmount))}</span>
                </div>
              ) : (
                <div className="flex justify-between">
                  <span className="text-slate-500">Kembalian</span>
                  <span className="font-bold text-slate-900">{formatCurrency(Math.max(0, changeAmount))}</span>
                </div>
              )}
            </div>

            {sale.note ? (
              <>
                <div className="my-4 border-t border-dashed border-slate-300" />
                <p className="text-[11px] text-slate-600 whitespace-pre-wrap">{String(sale.note)}</p>
              </>
            ) : null}

            <div className="mt-6 text-center text-[11px] text-slate-500">
              Terima kasih.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
