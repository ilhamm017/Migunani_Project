'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { OrderDetailResponse } from '@/lib/apiTypes';

type LooseRecord = Record<string, unknown>;
const asRecord = (value: unknown): LooseRecord => (value && typeof value === 'object' ? (value as LooseRecord) : {});

const toObjectOrEmpty = (value: unknown): LooseRecord => {
  if (!value) return {};
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as LooseRecord;
      return {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) return value as LooseRecord;
  return {};
};

const clampPercentage = (value: number): number => Math.min(100, Math.max(0, value));

const formatPctBadge = (value: number): string => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return '';
  const rounded = Math.round(parsed);
  if (Math.abs(parsed - rounded) <= 0.05) return String(rounded);
  return parsed.toFixed(1).replace(/\.0$/, '');
};

const resolvePctFromPrices = (base: number, final: number): number => {
  const b = Number(base || 0);
  const f = Number(final || 0);
  if (!(b > 0) || !Number.isFinite(b) || !Number.isFinite(f)) return 0;
  return clampPercentage(Math.round((((b - f) / b) * 100) * 100) / 100);
};

export default function AdminOrderDetailPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'checker_gudang', 'admin_finance', 'kasir']);
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const orderId = String(params?.id || '').trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [order, setOrder] = useState<OrderDetailResponse | null>(null);

  const load = async () => {
    if (!orderId) return;
    try {
      setLoading(true);
      setError('');
      const res = await api.orders.getOrderById(orderId);
      setOrder((res.data || null) as OrderDetailResponse | null);
    } catch (e: unknown) {
      console.error(e);
      const statusCode = Number((e as { response?: { status?: unknown } })?.response?.status || 0);
      const message = typeof e === 'object' && e && 'response' in e
        ? String((e as { response?: { data?: { message?: string } } }).response?.data?.message || '')
        : '';
      setOrder(null);
      setError(statusCode === 404 ? 'Order tidak ditemukan.' : (message || 'Gagal memuat detail order.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!allowed) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, orderId]);

	  const items = useMemo(() => {
	    const raw = Array.isArray(order?.OrderItems) ? order!.OrderItems! : [];
	    return raw
	      .map((row) => {
	        const rec = asRecord(row);
	        const product = asRecord(rec.Product);
	        const productId = String(rec.product_id || product.id || '').trim();
	        const qty = Math.max(0, Math.trunc(Number(rec.qty || 0)));
          const unitPrice = Number(rec.price_at_purchase ?? rec.unit_price ?? 0);
          const lineTotal = Number.isFinite(unitPrice) ? unitPrice * qty : 0;
          const pricingSnapshot = toObjectOrEmpty(rec.pricing_snapshot);
          const clearancePromo = toObjectOrEmpty(pricingSnapshot.clearance_promo);
          const override = toObjectOrEmpty(pricingSnapshot.override);
          const computedUnit = Number(pricingSnapshot.computed_unit_price ?? 0);
          const finalUnit = Number(pricingSnapshot.final_unit_price ?? unitPrice ?? 0);
          const snapshotDiscountPct = Number(pricingSnapshot.discount_pct ?? 0);
          const discountSource = String(pricingSnapshot.discount_source || '').trim();
          const hasPromo = Object.keys(clearancePromo).length > 0 || Boolean(rec.clearance_promo_id);
          const hasOverride = Object.keys(override).length > 0;

          const discountBadge = (() => {
            if (hasPromo) {
              const promoMode = String(clearancePromo.pricing_mode || '').trim();
              const pctFromPromo = Number(clearancePromo.discount_pct ?? 0);
              const pct = promoMode === 'percent_off' && Number.isFinite(pctFromPromo) && pctFromPromo > 0
                ? clampPercentage(pctFromPromo)
                : resolvePctFromPrices(Number.isFinite(computedUnit) && computedUnit > 0 ? computedUnit : unitPrice, finalUnit);
              return { label: 'Promo', pct, className: 'bg-emerald-100 text-emerald-800 border border-emerald-200' };
            }

            if (hasOverride) {
              const pct = resolvePctFromPrices(Number.isFinite(computedUnit) && computedUnit > 0 ? computedUnit : unitPrice, finalUnit);
              return { label: 'Custom', pct, className: 'bg-rose-100 text-rose-800 border border-rose-200' };
            }

            if (discountSource === 'category') {
              const pct = Number.isFinite(snapshotDiscountPct) && snapshotDiscountPct > 0 ? clampPercentage(snapshotDiscountPct) : 0;
              return { label: 'Kategori', pct, className: 'bg-sky-100 text-sky-800 border border-sky-200' };
            }

            if (discountSource === 'tier_fallback') {
              const pct = Number.isFinite(snapshotDiscountPct) && snapshotDiscountPct > 0 ? clampPercentage(snapshotDiscountPct) : 0;
              return { label: 'Per-SKU', pct, className: 'bg-amber-100 text-amber-800 border border-amber-200' };
            }

            return { label: 'Normal', pct: 0, className: 'bg-slate-100 text-slate-700 border border-slate-200' };
          })();
	        return {
	          id: String(rec.id || '').trim() || productId,
	          productId,
	          sku: String(product.sku || productId || '-'),
	          name: String(product.name || rec.name || '-'),
	          qty,
	          unitPrice,
	          lineTotal,
            discountBadge,
	        };
	      })
	      .filter((row) => row.productId && row.qty > 0);
	  }, [order]);

  if (!allowed) return null;

  const invoiceId = String(order?.invoice_id || '').trim();
  const invoiceNumber = String(order?.invoice_number || '').trim();
  const customerName = String(order?.customer_name || asRecord(order?.Customer).name || '-');
  const orderStatus = String(order?.status || '-');
  const totalAmount = Number(order?.total_amount || 0);

  return (
    <div className="container mx-auto max-w-5xl p-3 sm:p-4 py-4 sm:py-6 lg:py-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" onClick={() => router.back()} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Kembali
        </Button>
        <Button variant="ghost" onClick={() => void load()} disabled={loading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-slate-900">Detail Order</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
              {error}
            </div>
          ) : null}

          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm">
            <div className="flex flex-col gap-1">
              <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Order ID</div>
              <div className="font-black text-slate-900 break-all">{orderId || '-'}</div>
              {order?.createdAt ? (
                <div className="text-xs text-slate-500">Dibuat: {formatDateTime(order.createdAt)}</div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Customer</p>
              <p className="mt-1 font-black text-slate-900">{customerName}</p>
              {order?.customer_id ? (
                <p className="text-xs text-slate-500 mt-1 break-all">ID: {String(order.customer_id)}</p>
              ) : null}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Status</p>
              <p className="mt-1 font-black text-slate-900">{orderStatus}</p>
              <p className="text-xs text-slate-500 mt-1">Total: {formatCurrency(totalAmount)}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Invoice</p>
            {invoiceId ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-sm font-black text-slate-900">
                  {invoiceNumber ? `#${invoiceNumber}` : invoiceId}
                </span>
                <Link
                  href={`/admin/orders/${encodeURIComponent(invoiceId)}`}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-100"
                  title="Buka halaman invoice/warehouse"
                >
                  Buka <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
            ) : (
              <p className="mt-1 text-sm text-slate-600">Belum ada invoice untuk order ini.</p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Items</p>
            {loading ? (
              <p className="mt-2 text-sm text-slate-500">Memuat...</p>
            ) : items.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">Tidak ada item.</p>
            ) : (
              <div className="mt-2 overflow-x-auto rounded-2xl border border-slate-200">
                <table className="min-w-full text-left text-xs">
	                  <thead className="bg-slate-50">
	                    <tr className="text-[10px] uppercase tracking-widest text-slate-500">
	                      <th className="px-4 py-3 font-black">SKU</th>
	                      <th className="px-4 py-3 font-black">Nama</th>
                        <th className="px-4 py-3 font-black">Diskon</th>
	                      <th className="px-4 py-3 font-black">Qty</th>
	                      <th className="px-4 py-3 font-black">Harga</th>
	                      <th className="px-4 py-3 font-black">Total</th>
	                    </tr>
	                  </thead>
	                  <tbody className="bg-white">
	                    {items.map((row) => (
	                      <tr key={row.id} className="border-t">
	                        <td className="px-4 py-3 font-black text-slate-900 whitespace-nowrap">{row.sku}</td>
	                        <td className="px-4 py-3 text-slate-800">{row.name}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wide ${row.discountBadge.className}`}>
                              {row.discountBadge.label}
                              {row.discountBadge.pct > 0 ? ` ${formatPctBadge(row.discountBadge.pct)}%` : ''}
                            </span>
                          </td>
	                        <td className="px-4 py-3 font-black">{row.qty}</td>
	                        <td className="px-4 py-3">{formatCurrency(row.unitPrice)}</td>
	                        <td className="px-4 py-3 font-black">{formatCurrency(row.lineTotal)}</td>
	                      </tr>
	                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
