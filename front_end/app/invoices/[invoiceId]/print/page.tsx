'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { formatCurrency, formatDateTime } from '@/lib/utils';

type InvoiceItem = {
  id?: string;
  qty?: number;
  ordered_qty?: number;
  invoice_qty?: number;
  allocated_qty?: number;
  remaining_qty?: number;
  previously_allocated_qty?: number;
  unit_price?: number;
  line_total?: number;
  baseline_unit_price?: number;
  final_unit_price?: number;
  price_diff_per_unit?: number;
  price_diff_total?: number;
  override_reason_item?: string | null;
  override_reason_order?: string | null;
  OrderItem?: {
    id?: string;
    order_id?: string;
    ordered_qty_original?: number;
    qty?: number;
    qty_canceled_backorder?: number;
    Product?: {
      name?: string | null;
      sku?: string | null;
      unit?: string | null;
    } | null;
  } | null;
};

type InvoiceCustomer = {
  id: string;
  name?: string | null;
  email?: string | null;
  whatsapp_number?: string | null;
};

type InvoiceDetail = {
  id: string;
  invoice_number: string;
  payment_status: string;
  payment_method: string;
  subtotal?: number;
  discount_amount?: number;
  shipping_fee_total?: number;
  tax_amount?: number;
  total?: number;
  createdAt?: string;
  shipping_method_name?: string | null;
  order_ids?: string[];
  customer?: InvoiceCustomer | null;
  InvoiceItems?: InvoiceItem[];
};

const paymentMethodLabel = (method?: string) => {
  if (method === 'transfer_manual') return 'Transfer Manual';
  if (method === 'cod') return 'COD';
  if (method === 'cash_store') return 'Tunai Toko';
  return method || '-';
};

const paymentStatusLabel = (status?: string) => {
  if (status === 'unpaid') return 'Belum Lunas';
  if (status === 'cod_pending') return 'Sudah Dibayar ke Driver';
  if (status === 'paid') return 'Lunas';
  return status || '-';
};

const paymentInstructionLabel = (method?: string) => {
  if (method === 'cod') {
    return 'Jika customer sudah membayar COD ke driver, invoice ini dianggap selesai dari sisi customer. Proses setoran ke admin finance ditangani internal.';
  }
  if (method === 'transfer_manual') {
    return 'Untuk transfer manual, pembayaran diverifikasi finance setelah bukti transfer diterima.';
  }
  return 'Ikuti metode pembayaran yang tercantum pada invoice ini.';
};

function InvoicePrintPageContent() {
  const { invoiceId } = useParams();
  const searchParams = useSearchParams();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const user = useAuthStore((state) => state.user);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdminDiff, setShowAdminDiff] = useState(false);

  const isAdminRole = useMemo(() => {
    const role = String(user?.role || '').trim();
    return ['super_admin', 'kasir', 'admin_finance', 'admin_gudang'].includes(role);
  }, [user?.role]);

  const load = useCallback(async () => {
    if (!isAuthenticated || !invoiceId) {
      setDetail(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const res = await api.invoices.getById(String(invoiceId));
      const invoice = res.data || {};
      setDetail({
        id: String(invoice?.id || invoiceId),
        invoice_number: String(invoice?.invoice_number || invoiceId),
        payment_status: String(invoice?.payment_status || ''),
        payment_method: String(invoice?.payment_method || ''),
        subtotal: Number(invoice?.subtotal || 0),
        discount_amount: Number(invoice?.discount_amount || 0),
        shipping_fee_total: Number(invoice?.shipping_fee_total || 0),
        tax_amount: Number(invoice?.tax_amount || 0),
        total: Number(invoice?.total || 0),
        createdAt: invoice?.createdAt,
        shipping_method_name: invoice?.shipping_method_name || null,
        order_ids: Array.isArray(invoice?.order_ids) ? invoice.order_ids : [],
        customer: invoice?.customer || null,
        InvoiceItems: Array.isArray(invoice?.InvoiceItems) ? invoice.InvoiceItems : [],
      });
    } catch (error) {
      console.error('Failed to load invoice detail:', error);
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [invoiceId, isAuthenticated]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = useMemo(() => {
    return Array.isArray(detail?.InvoiceItems) ? detail?.InvoiceItems || [] : [];
  }, [detail]);

  const pricelistSubtotal = useMemo(() => {
    return items.reduce((sum, item) => {
      const qty = Number(item.invoice_qty ?? item.qty ?? 0);
      const baseline = Number(item.baseline_unit_price ?? item.unit_price ?? 0);
      const line = Math.round(baseline * qty * 100) / 100;
      return sum + (Number.isFinite(line) ? line : 0);
    }, 0);
  }, [items]);

  const displayedSubtotal = useMemo(() => {
    if (items.length > 0) return pricelistSubtotal;
    return Number(detail?.subtotal || 0);
  }, [detail?.subtotal, items.length, pricelistSubtotal]);

  const orderIds = useMemo(() => {
    if (detail?.order_ids && detail.order_ids.length > 0) return detail.order_ids;
    const ids = new Set<string>();
    items.forEach((item) => {
      const orderId = String(item.OrderItem?.order_id || '').trim();
      if (orderId) ids.add(orderId);
    });
    return Array.from(ids);
  }, [detail, items]);

  const backHref = useMemo(() => {
    const raw = String(searchParams.get('back') || '').trim();
    if (raw.startsWith('/admin/')) return raw;
    if (raw.startsWith('/invoices/')) return raw;
    return `/invoices/${String(invoiceId || '')}`;
  }, [invoiceId, searchParams]);

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
        <h2 className="text-xl font-black text-slate-800 mb-2">Login Diperlukan</h2>
        <p className="text-slate-500 mb-6 max-w-xs">Silakan login untuk melihat dan mencetak invoice.</p>
        <Link href="/auth/login" className="w-full max-w-xs bg-emerald-600 text-white py-4 rounded-2xl font-black text-sm uppercase tracking-wider shadow-lg shadow-emerald-100">
          Login Sekarang
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 py-6 print:py-0">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@600;700&family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');

        .screen-only {
          display: block;
        }

        .print-only {
          display: none;
        }

        @media print {
          @page {
            size: 80mm auto;
            margin: 2mm;
          }

          body {
            background: #ffffff !important;
            color: #000000 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          header,
          nav,
          footer,
          .print-hidden {
            display: none !important;
          }

          .screen-only {
            display: none !important;
          }

          .print-only {
            display: block !important;
          }

          .print-sheet {
            box-shadow: none !important;
            border-radius: 0 !important;
            border: none !important;
          }

          .thermal-print {
            color: #000000 !important;
            font-size: 12px !important;
            line-height: 1.25 !important;
          }

          .thermal-print * {
            color: #000000 !important;
          }

          .thermal-divider {
            border-top: 1px dashed #000000 !important;
          }
        }
      `}</style>

      <div className="max-w-5xl mx-auto px-4 print:px-0 print:max-w-none">
        <div className="flex flex-wrap items-center gap-3 mb-4 print:hidden">
          <Link href={backHref} className="inline-flex items-center gap-2 text-xs font-bold text-slate-600">
            <ChevronLeft size={16} />
            Kembali ke detail
          </Link>
          <div className="flex-1" />
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 text-white px-4 py-2 text-xs font-bold shadow-lg shadow-slate-200"
          >
            <Printer size={16} />
            Cetak Invoice
          </button>
        </div>

        {loading && <div className="text-sm text-slate-500">Menyiapkan invoice...</div>}
        {!loading && !detail && <div className="text-sm text-slate-500">Invoice tidak ditemukan.</div>}

        {!loading && detail && (
          <>
            <div
              className="screen-only print-sheet bg-white border border-slate-200 rounded-[28px] shadow-xl overflow-hidden"
              style={{ fontFamily: '"Space Grotesk", sans-serif' }}
            >
              <div className="h-2 bg-emerald-500" />
              <div className="p-6 md:p-8">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-slate-400">Migunani Motor</p>
                    <h1 className="text-3xl md:text-4xl font-semibold text-slate-900 mt-2" style={{ fontFamily: 'Fraunces, serif' }}>
                      Invoice
                    </h1>
                    <p className="text-xs text-slate-500 mt-1">Suku cadang motor terpercaya - Dokumen tagihan resmi</p>
                  </div>
                  <div className="text-left md:text-right">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">No. Invoice</p>
                    <p className="text-lg font-bold text-slate-900">{detail.invoice_number}</p>
                    <p className="text-xs text-slate-500 mt-1">Tanggal: {detail.createdAt ? formatDateTime(detail.createdAt) : '-'}</p>
                    <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                      {paymentStatusLabel(detail.payment_status)}
                    </div>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-400">Ditagihkan Ke</p>
                    <p className="text-sm font-bold text-slate-900 mt-2">{detail.customer?.name || 'Customer'}</p>
                    <p className="text-xs text-slate-600">WhatsApp: {detail.customer?.whatsapp_number || '-'}</p>
                    <p className="text-xs text-slate-600">Email: {detail.customer?.email || '-'}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-400">Info Invoice</p>
                    <p className="text-xs text-slate-600 mt-2">Metode bayar: <span className="font-bold text-slate-900">{paymentMethodLabel(detail.payment_method)}</span></p>
                    <p className="text-xs text-slate-600">Pengiriman: <span className="font-bold text-slate-900">{detail.shipping_method_name || '-'}</span></p>
                    <div className="text-xs text-slate-600 mt-2">
                      Order ID:
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {orderIds.length === 0 && <span className="text-slate-400">-</span>}
                        {orderIds.map((orderId) => (
                          <span key={orderId} className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                            {orderId}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-6 border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="bg-slate-900 text-white px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs font-bold uppercase tracking-[0.2em]">Rincian Barang</p>
                      {isAdminRole ? (
                        <label className="inline-flex items-center gap-2 text-[10px] font-bold text-white/80">
                          <input
                            type="checkbox"
                            checked={showAdminDiff}
                            onChange={(e) => setShowAdminDiff(e.target.checked)}
                            className="h-4 w-4 accent-emerald-500"
                          />
                          Tampilkan selisih harga (Admin)
                        </label>
                      ) : null}
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px]">
                        <tr>
                          <th className="px-4 py-3 text-left">Produk</th>
                          <th className="px-4 py-3 text-left">Order</th>
                          <th className="px-4 py-3 text-right">Dipesan</th>
                          <th className="px-4 py-3 text-right">Invoice Ini</th>
                          <th className="px-4 py-3 text-right">Total Alokasi</th>
                          <th className="px-4 py-3 text-right">Sisa Backorder</th>
                          <th className="px-4 py-3 text-right">Harga</th>
                          <th className="px-4 py-3 text-right">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.length === 0 && (
                          <tr>
                            <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                              Tidak ada item di invoice ini.
                            </td>
                          </tr>
                        )}
                        {items.map((item, idx: number) => {
                          const product = item.OrderItem?.Product || {};
                          const orderId = String(item.OrderItem?.order_id || '-');
                          const orderedQty = Number(
                            item.OrderItem?.ordered_qty_original
                            ?? item.ordered_qty
                            ?? item.OrderItem?.qty
                            ?? item.qty
                            ?? 0
                          );
                          const invoiceQty = Number(item.invoice_qty ?? item.qty ?? 0);
                          const allocatedQty = Number(item.allocated_qty ?? invoiceQty);
                          const canceledBackorderQty = Number(item.OrderItem?.qty_canceled_backorder || 0);
                          const remainingQty = Number(
                            item.remaining_qty
                            ?? Math.max(0, orderedQty - allocatedQty - canceledBackorderQty)
                          );
                          return (
                            <tr key={String(item.id || item.OrderItem?.id || idx)} className="border-t border-slate-100">
                              <td className="px-4 py-3">
                                <p className="font-semibold text-slate-900">{product.name || 'Produk'}</p>
                                <p className="text-[10px] text-slate-500">SKU: {product.sku || '-'}</p>
                                <p className="text-[10px] text-slate-500">Unit: {product.unit || '-'}</p>
                              </td>
                              <td className="px-4 py-3 text-slate-600">{orderId}</td>
                              <td className="px-4 py-3 text-right text-slate-700">{orderedQty}</td>
                              <td className="px-4 py-3 text-right text-slate-700">{invoiceQty}</td>
                              <td className="px-4 py-3 text-right text-slate-700">{allocatedQty}</td>
                              <td className="px-4 py-3 text-right text-slate-700">{remainingQty}</td>
                              <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(Number(item.unit_price || 0))}</td>
                              <td className="px-4 py-3 text-right font-semibold text-slate-900">{formatCurrency(Number(item.line_total || 0))}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {isAdminRole && showAdminDiff ? (
                  <div className="mt-4 border border-emerald-200 rounded-2xl overflow-hidden">
                    <div className="bg-emerald-50 px-4 py-3">
                      <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-800">Selisih Harga (Admin)</p>
                      <p className="text-[11px] text-emerald-700 mt-1">
                        Selisih dihitung dari baseline (harga normal saat order dibuat) dikurangi harga final invoice.
                      </p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead className="bg-white text-emerald-800 uppercase tracking-wider text-[10px]">
                          <tr>
                            <th className="px-4 py-3 text-left">Produk</th>
                            <th className="px-4 py-3 text-right">Qty</th>
                            <th className="px-4 py-3 text-right">Baseline</th>
                            <th className="px-4 py-3 text-right">Final</th>
                            <th className="px-4 py-3 text-right">Selisih/Unit</th>
                            <th className="px-4 py-3 text-right">Selisih Total</th>
                            <th className="px-4 py-3 text-left">Keterangan</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="px-4 py-6 text-center text-emerald-700/70">
                                Tidak ada item di invoice ini.
                              </td>
                            </tr>
                          ) : (
                            items.map((item, idx: number) => {
                              const product = item.OrderItem?.Product || {};
                              const qty = Number(item.invoice_qty ?? item.qty ?? 0);
                              const baseline = Number(item.baseline_unit_price ?? item.final_unit_price ?? item.unit_price ?? 0);
                              const finalPrice = Number(item.final_unit_price ?? item.unit_price ?? 0);
                              const diffPer = Number(item.price_diff_per_unit ?? (baseline - finalPrice));
                              const diffTotal = Number(item.price_diff_total ?? (diffPer * qty));
                              const reason = String(item.override_reason_item || item.override_reason_order || '').trim() || '-';
                              return (
                                <tr key={`diff-${String(item.id || item.OrderItem?.id || idx)}`} className="border-t border-emerald-100 bg-white">
                                  <td className="px-4 py-3">
                                    <p className="font-semibold text-slate-900">{String(product.name || 'Produk')}</p>
                                    <p className="text-[10px] text-slate-500">SKU: {String(product.sku || '-')}</p>
                                  </td>
                                  <td className="px-4 py-3 text-right text-slate-700">{qty}</td>
                                  <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(baseline)}</td>
                                  <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(finalPrice)}</td>
                                  <td className="px-4 py-3 text-right font-semibold text-emerald-800">{formatCurrency(diffPer)}</td>
                                  <td className="px-4 py-3 text-right font-black text-emerald-900">{formatCurrency(diffTotal)}</td>
                                  <td className="px-4 py-3 text-slate-700">{reason}</td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                <div className="mt-6 grid grid-cols-1 md:grid-cols-[1.2fr_0.8fr] gap-4">
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-400">Catatan</p>
                    <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                      {paymentInstructionLabel(detail.payment_method)}
                      Simpan invoice ini sebagai bukti transaksi dan rujukan layanan purna jual.
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-900 text-white p-4">
                    <div className="flex items-center justify-between text-xs">
                      <span>Subtotal</span>
                      <span>{formatCurrency(displayedSubtotal)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs mt-2">
                      <span>Diskon</span>
                      <span>-{formatCurrency(Number(detail.discount_amount || 0))}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs mt-2">
                      <span>Ongkir</span>
                      <span>{formatCurrency(Number(detail.shipping_fee_total || 0))}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs mt-2">
                      <span>Pajak</span>
                      <span>{formatCurrency(Number(detail.tax_amount || 0))}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm font-bold border-t border-white/20 mt-3 pt-3">
                      <span>Total</span>
                      <span>{formatCurrency(Number(detail.total || 0))}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 border-t border-slate-200 pt-4 text-[10px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
                  <p>Invoice ini diterbitkan oleh Migunani Motor - Terima kasih telah berbelanja.</p>
                  <p className="font-semibold text-slate-400">{detail.invoice_number}</p>
                </div>
              </div>
            </div>

            <div
              className="print-only print-sheet thermal-print bg-white border border-slate-200 rounded-2xl shadow-lg p-4 mt-4 max-w-[76mm] mx-auto"
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace' }}
            >
              <div className="text-center">
                <p className="text-[13px] font-bold uppercase tracking-[0.25em] text-black">Migunani Motor</p>
                <p className="text-[11px] text-black">Suku cadang motor terpercaya</p>
              </div>

              <div className="thermal-divider border-t border-dashed border-slate-300 my-3" />

              <div className="text-[12px] space-y-1">
                <div className="flex items-center justify-between">
                  <span>No. Invoice</span>
                  <span className="font-bold">{detail.invoice_number}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Tanggal</span>
                  <span>{detail.createdAt ? formatDateTime(detail.createdAt) : '-'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Status</span>
                  <span className="font-bold">{paymentStatusLabel(detail.payment_status)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Metode</span>
                  <span className="font-bold">{paymentMethodLabel(detail.payment_method)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Pengiriman</span>
                  <span className="font-bold">{detail.shipping_method_name || '-'}</span>
                </div>
              </div>

              <div className="thermal-divider border-t border-dashed border-slate-300 my-3" />

              <div className="text-[12px] space-y-1">
                <p className="font-bold text-black">Customer</p>
                <p>{detail.customer?.name || 'Customer'}</p>
                <p className="text-black">WA: {detail.customer?.whatsapp_number || '-'}</p>
                <p className="text-black">Email: {detail.customer?.email || '-'}</p>
              </div>

              <div className="text-[11px] text-black mt-2">
                Order: {orderIds.length > 0 ? orderIds.join(', ') : '-'}
              </div>

              <div className="thermal-divider border-t border-dashed border-slate-300 my-3" />

              <div className="text-[12px] font-bold uppercase tracking-wider text-black">Item</div>
              <div className="mt-2 space-y-3">
                {items.length === 0 && (
                  <p className="text-[12px] text-black">Tidak ada item di invoice ini.</p>
                )}
                {items.map((item, idx: number) => {
                  const product = item.OrderItem?.Product || {};
                  const orderId = String(item.OrderItem?.order_id || '-');
                  const orderedQty = Number(
                    item.OrderItem?.ordered_qty_original
                    ?? item.ordered_qty
                    ?? item.OrderItem?.qty
                    ?? item.qty
                    ?? 0
                  );
                  const invoiceQty = Number(item.invoice_qty ?? item.qty ?? 0);
                  const allocatedQty = Number(item.allocated_qty ?? invoiceQty);
                  const canceledBackorderQty = Number(item.OrderItem?.qty_canceled_backorder || 0);
                  const remainingQty = Number(
                    item.remaining_qty
                    ?? Math.max(0, orderedQty - allocatedQty - canceledBackorderQty)
                  );
                  return (
                    <div key={String(item.id || item.OrderItem?.id || idx)} className="space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-bold text-black break-words">{product.name || 'Produk'}</p>
                          <p className="text-[11px] text-black">SKU: {product.sku || '-'}</p>
                          <p className="text-[11px] text-black">Order: {orderId}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[12px] font-bold text-black">{formatCurrency(Number(item.line_total || 0))}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-black">
                        <span>{orderedQty} x {formatCurrency(Number(item.unit_price || 0))}</span>
                        <span>Inv {invoiceQty} | Total {allocatedQty} | Sisa {remainingQty}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="thermal-divider border-t border-dashed border-slate-300 my-3" />

              <div className="text-[12px] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold">Subtotal</span>
                  <span className="font-bold">{formatCurrency(displayedSubtotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Diskon</span>
                  <span>-{formatCurrency(Number(detail.discount_amount || 0))}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Ongkir</span>
                  <span>{formatCurrency(Number(detail.shipping_fee_total || 0))}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Pajak</span>
                  <span>{formatCurrency(Number(detail.tax_amount || 0))}</span>
                </div>
                <div className="flex items-center justify-between text-[14px] font-black border-t border-dashed border-slate-300 pt-2 mt-2">
                  <span>Total</span>
                  <span>{formatCurrency(Number(detail.total || 0))}</span>
                </div>
              </div>

              <div className="thermal-divider border-t border-dashed border-slate-300 my-3" />

              <p className="text-[11px] text-black text-center">
                {paymentInstructionLabel(detail.payment_method)}
              </p>
              <p className="text-[11px] text-black text-center mt-1">Terima kasih telah berbelanja.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function InvoicePrintPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Memuat invoice...</div>}>
      <InvoicePrintPageContent />
    </Suspense>
  );
}
