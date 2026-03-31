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
        return {
          id: String(rec.id || '').trim() || productId,
          productId,
          sku: String(product.sku || productId || '-'),
          name: String(product.name || rec.name || '-'),
          qty,
          unitPrice: Number(rec.unit_price || 0),
          lineTotal: Number(rec.line_total || 0),
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

