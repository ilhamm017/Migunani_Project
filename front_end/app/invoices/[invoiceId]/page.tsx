'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Printer, Receipt, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';

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

type InvoiceDetail = {
  id: string;
  invoice_number: string;
  payment_status: string;
  payment_method: string;
  payment_proof_url?: string | null;
  amount_paid?: number | null;
  subtotal?: number;
  discount_amount?: number;
  shipping_fee_total?: number;
  tax_amount?: number;
  total?: number;
  createdAt?: string;
  shipping_method_name?: string | null;
  customer?: {
    id?: string;
    name?: string | null;
    email?: string | null;
    whatsapp_number?: string | null;
  } | null;
  InvoiceItems?: InvoiceItem[];
  delivery_returs?: Array<{
    id: string;
    retur_type?: string;
    status?: string;
    qty?: number;
    reason?: string | null;
    Product?: { name?: string | null; sku?: string | null; unit?: string | null } | null;
  }>;
  delivery_return_summary?: {
    net_total?: number;
    return_total?: number;
    new_items_subtotal?: number;
    new_discount_amount?: number;
    shipping_fee_total?: number;
    tax_amount?: number;
  } | null;
};

const paymentMethodLabel = (method?: string) => {
  if (!String(method || '').trim() || method === 'pending') return 'Menunggu Driver';
  if (method === 'transfer_manual') return 'Transfer Manual';
  if (method === 'cod') return 'COD';
  if (method === 'cash_store') return 'Tunai Toko';
  return method || '-';
};

const paymentStatusLabel = (status?: string) => {
  if (status === 'draft') return 'Belum Ditentukan';
  if (status === 'unpaid') return 'Belum Lunas';
  if (status === 'cod_pending') return 'Sudah Dibayar ke Driver';
  if (status === 'paid') return 'Lunas';
  return status || '-';
};

const paymentInstructionLabel = (method?: string) => {
  if (!String(method || '').trim() || method === 'pending') {
    return 'Metode pembayaran belum dipilih. Customer akan menentukan pembayaran bersama driver saat proses pengiriman.';
  }
  if (method === 'cod') {
    return 'Pembayaran COD dilakukan tunai ke driver saat barang diterima. Status akan diperbarui setelah driver mencatat penerimaan COD.';
  }
  if (method === 'transfer_manual') {
    return 'Untuk transfer manual, pembayaran diverifikasi finance setelah bukti transfer diterima.';
  }
  return 'Ikuti metode pembayaran yang tercantum pada invoice ini.';
};

const needsTransferProof = (detail: InvoiceDetail | null) => {
  const paymentMethod = String(detail?.payment_method || '');
  const paymentStatus = String(detail?.payment_status || '');
  const proofUploaded = Boolean(String(detail?.payment_proof_url || '').trim());
  return paymentMethod === 'transfer_manual' && paymentStatus !== 'paid' && !proofUploaded;
};

export default function CustomerInvoiceDetailPage() {
  const { invoiceId } = useParams();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const deliverySummary = detail?.delivery_return_summary || null;
  const deliveryReturs = Array.isArray(detail?.delivery_returs) ? (detail?.delivery_returs || []) : [];
  const hasDeliveryRetur = deliveryReturs.length > 0;
  const deliveryReturnTotal = hasDeliveryRetur ? Number(deliverySummary?.return_total || 0) : 0;
  const deliveryNetTotal = hasDeliveryRetur ? Number(deliverySummary?.net_total) : Number.NaN;
  const payableTotal = hasDeliveryRetur && Number.isFinite(deliveryNetTotal) && deliveryNetTotal >= 0
    ? deliveryNetTotal
    : Number(detail?.total || 0);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!isAuthenticated || !invoiceId) {
      setDetail(null);
      if (!silent) setLoading(false);
      return;
    }
    try {
      if (!silent) setLoading(true);
      const res = await api.invoices.getById(String(invoiceId));
      const invoice = res.data || {};
      const deliveryReturnSummaryRaw = invoice['delivery_return_summary'];
      const deliveryReturnSummary = deliveryReturnSummaryRaw && typeof deliveryReturnSummaryRaw === 'object'
        ? (deliveryReturnSummaryRaw as InvoiceDetail['delivery_return_summary'])
        : null;
      const deliveryRetursRaw = invoice['delivery_returs'];
      const deliveryReturs = Array.isArray(deliveryRetursRaw)
        ? (deliveryRetursRaw as NonNullable<InvoiceDetail['delivery_returs']>)
        : [];
      const amountPaidRaw = invoice['amount_paid'];
      setDetail({
        id: String(invoice?.id || invoiceId),
        invoice_number: String(invoice?.invoice_number || invoiceId),
        payment_status: String(invoice?.payment_status || ''),
        payment_method: String(invoice?.payment_method || ''),
        payment_proof_url: invoice?.payment_proof_url ? String(invoice.payment_proof_url) : null,
        amount_paid: Number(amountPaidRaw ?? 0),
        subtotal: Number(invoice?.subtotal || 0),
        discount_amount: Number(invoice?.discount_amount || 0),
        shipping_fee_total: Number(invoice?.shipping_fee_total || 0),
        tax_amount: Number(invoice?.tax_amount || 0),
        total: Number(invoice?.total || 0),
        createdAt: invoice?.createdAt,
        shipping_method_name: invoice?.shipping_method_name || null,
        customer: invoice?.customer || null,
        InvoiceItems: Array.isArray(invoice?.InvoiceItems) ? invoice.InvoiceItems : [],
        delivery_returs: deliveryReturs,
        delivery_return_summary: deliveryReturnSummary,
      });
    } catch (error) {
      console.error('Failed to load invoice detail:', error);
      setDetail(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [invoiceId, isAuthenticated]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeRefresh({
    enabled: isAuthenticated,
    onRefresh: () => load({ silent: true }),
    domains: ['order', 'retur', 'admin'],
    pollIntervalMs: 20000,
  });

  const items = useMemo(() => {
    return Array.isArray(detail?.InvoiceItems) ? detail?.InvoiceItems || [] : [];
  }, [detail]);

  const itemsSubtotal = useMemo(() => {
    if (items.length === 0) return Number.NaN;
    return items.reduce((sum, item) => {
      const qty = Number(item.invoice_qty ?? item.qty ?? 0);
      const unitPrice = Number(item.unit_price ?? 0);
      const lineTotal = Number(item.line_total);
      const line = Number.isFinite(lineTotal) ? lineTotal : unitPrice * qty;
      return sum + (Number.isFinite(line) ? line : 0);
    }, 0);
  }, [items]);

  const displaySubtotal = useMemo(() => {
    if (hasDeliveryRetur) {
      const computed = Number(deliverySummary?.new_items_subtotal);
      return Number.isFinite(computed) ? computed : 0;
    }
    if (Number.isFinite(itemsSubtotal)) return Number(itemsSubtotal);
    const subtotalBase = Number(detail?.subtotal || 0);
    const discount = Number(detail?.discount_amount || 0);
    const shipping = Number(detail?.shipping_fee_total || 0);
    return Math.max(0, subtotalBase + discount - shipping);
  }, [deliverySummary?.new_items_subtotal, detail?.discount_amount, detail?.shipping_fee_total, detail?.subtotal, hasDeliveryRetur, itemsSubtotal]);

  const displayDiscount = useMemo(() => {
    if (hasDeliveryRetur) {
      const computed = Number(deliverySummary?.new_discount_amount);
      return Number.isFinite(computed) ? computed : Number(detail?.discount_amount || 0);
    }
    return Number(detail?.discount_amount || 0);
  }, [deliverySummary?.new_discount_amount, detail?.discount_amount, hasDeliveryRetur]);

  const displayShipping = useMemo(() => {
    if (hasDeliveryRetur) {
      const computed = Number(deliverySummary?.shipping_fee_total);
      return Number.isFinite(computed) ? computed : Number(detail?.shipping_fee_total || 0);
    }
    return Number(detail?.shipping_fee_total || 0);
  }, [deliverySummary?.shipping_fee_total, detail?.shipping_fee_total, hasDeliveryRetur]);

  const displayTax = useMemo(() => {
    if (hasDeliveryRetur) {
      const computed = Number(deliverySummary?.tax_amount);
      return Number.isFinite(computed) ? computed : Number(detail?.tax_amount || 0);
    }
    return Number(detail?.tax_amount || 0);
  }, [deliverySummary?.tax_amount, detail?.tax_amount, hasDeliveryRetur]);

  const orderIds = useMemo(() => {
    const ids = new Set<string>();
    items.forEach((item) => {
      const orderId = String(item.OrderItem?.order_id || '').trim();
      if (orderId) ids.add(orderId);
    });
    return Array.from(ids);
  }, [items]);
  const transferProofNeeded = needsTransferProof(detail);
  const waitingFinanceVerification = Boolean(String(detail?.payment_proof_url || '').trim()) || String(detail?.payment_status || '') === 'waiting_admin_verification';
  const paymentMethodUndecided = !String(detail?.payment_method || '').trim() || String(detail?.payment_method || '') === 'pending';
  const displayPaymentStatusLabel = useMemo(() => {
    if (!detail) return '-';
    const method = String(detail.payment_method || '');
    const status = String(detail.payment_status || '');
    const amountPaid = Number(detail.amount_paid || 0);
    const codCollected = Number.isFinite(amountPaid) && amountPaid > 0;
    if (method === 'cod' && status === 'cod_pending' && !codCollected) return 'Belum Lunas';
    return paymentStatusLabel(status);
  }, [detail]);

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6">
          <Receipt size={40} className="text-slate-300" />
        </div>
        <h2 className="text-xl font-black text-slate-800 mb-2">Login Diperlukan</h2>
        <p className="text-slate-500 mb-6 max-w-xs">Silakan login untuk melihat detail invoice.</p>
        <Link href="/auth/login" className="w-full max-w-xs bg-emerald-600 text-white py-4 rounded-2xl font-black text-sm uppercase tracking-wider shadow-lg shadow-emerald-100">
          Login Sekarang
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 pb-24">
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
            margin: 4mm;
          }

          body {
            background: #ffffff !important;
            color: #0f172a !important;
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
        }
      `}</style>
      <div className="p-6 space-y-5">
        <div className="flex items-center gap-3">
          <Link href="/invoices" className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-slate-600">
            <ChevronLeft size={20} />
          </Link>
          <div>
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Detail Invoice</h3>
            <h1 className="text-xl font-black text-slate-900">{detail?.invoice_number || '-'}</h1>
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 text-white px-3 py-2 text-[10px] font-bold shadow-lg shadow-slate-200"
          >
            <Printer size={14} />
            Cetak
          </button>
        </div>

        {loading && <div className="text-sm text-slate-500">Memuat detail invoice...</div>}
        {!loading && !detail && <div className="text-sm text-slate-500">Invoice tidak ditemukan.</div>}

        {!loading && detail && (
          <>
            <div
              className="screen-only bg-white border border-slate-200 rounded-[28px] shadow-xl overflow-hidden"
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
                      {displayPaymentStatusLabel}
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
                    <p className="text-xs text-slate-600 mt-2">
                      Metode bayar: <span className="font-bold text-slate-900">{paymentMethodLabel(detail.payment_method)}</span>
                    </p>
                    <p className="text-xs text-slate-600">
                      Pengiriman: <span className="font-bold text-slate-900">{detail.shipping_method_name || '-'}</span>
                    </p>
                    <div className="text-xs text-slate-600 mt-2">
                      Order ID:
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {orderIds.length === 0 && <span className="text-slate-400">-</span>}
                        {orderIds.map((orderId) => (
                          <Link
                            key={orderId}
                            href={`/orders/${orderId}`}
                            className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-emerald-700"
                          >
                            {orderId}
                          </Link>
                        ))}
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2">Klik order untuk melihat detail pesanan.</p>
                  </div>
                </div>

                {paymentMethodUndecided && (
                  <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-500">
                      Status Pembayaran
                    </p>
                    <p className="mt-2 text-sm font-bold text-slate-900">
                      Pembayaran akan ditentukan nanti bersama driver.
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      Invoice ini belum memiliki metode pembayaran. Customer tidak perlu memilih atau mengunggah bukti pembayaran sebelum driver menentukan metode yang dipakai saat pengiriman.
                    </p>
                  </div>
                )}

                {!paymentMethodUndecided && transferProofNeeded && (
                  <div className={`mt-6 rounded-2xl border p-4 ${waitingFinanceVerification ? 'bg-blue-50 border-blue-200' : 'bg-amber-50 border-amber-200'}`}>
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="space-y-1">
                        <p className={`text-[10px] font-semibold uppercase tracking-[0.28em] ${waitingFinanceVerification ? 'text-blue-700' : 'text-amber-700'}`}>
                          Pembayaran Transfer Invoice
                        </p>
                        <p className="text-sm font-bold text-slate-900">
                          {waitingFinanceVerification
                            ? 'Bukti transfer untuk invoice ini sedang diverifikasi admin finance.'
                            : 'Customer perlu mengunggah bukti transfer dari halaman invoice ini.'}
                        </p>
                        <p className="text-xs text-slate-600">
                          {waitingFinanceVerification
                            ? 'Jika admin meminta perbaikan, buka halaman upload bukti transfer untuk mengirim ulang file.'
                            : 'Karena pembayaran berjalan per invoice, bukti transfer dikirim dari invoice ini agar semua order terkait tetap konsisten.'}
                        </p>
                      </div>
                      <Link
                        href={`/invoices/${detail.id}/upload-proof`}
                        className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-[0.2em] ${waitingFinanceVerification ? 'bg-white text-blue-700 border border-blue-200' : 'bg-amber-600 text-white'}`}
                      >
                        <Upload size={14} />
                        {waitingFinanceVerification ? 'Lihat Status Verifikasi' : 'Upload Bukti Transfer'}
                      </Link>
                    </div>
                  </div>
                )}

                <div className="mt-6 border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="bg-slate-900 text-white px-4 py-3">
                    <p className="text-xs font-bold uppercase tracking-[0.2em]">Rincian Barang</p>
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

                <div className="mt-6 grid grid-cols-1 md:grid-cols-[1.2fr_0.8fr] gap-4">
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-400">Catatan</p>
                    <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                      {paymentInstructionLabel(detail.payment_method)}
                      Simpan invoice ini sebagai bukti transaksi dan rujukan layanan purna jual.
                    </p>
                    {deliveryReturs.length > 0 && (
                      <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.28em] text-rose-700">Retur Saat Pengiriman</p>
                        <p className="text-xs font-bold text-slate-700 mt-1">
                          Ada retur item sehingga total tagihan menyesuaikan.
                        </p>
                        <div className="mt-3 space-y-2 max-h-44 overflow-y-auto">
                          {deliveryReturs.map((r) => (
                            <div key={String(r.id)} className="flex items-start justify-between gap-3 rounded-xl border border-rose-200/60 bg-white px-3 py-2">
                              <div className="min-w-0">
                                <p className="text-xs font-black text-slate-900 truncate">{String(r.Product?.name || 'Produk')}</p>
                                <p className="text-[10px] text-slate-500 truncate">
                                  {String(r.retur_type || '') === 'delivery_damage' ? 'Barang rusak' : 'Tidak jadi beli'}
                                  {r.reason ? ` · ${String(r.reason)}` : ''}
                                </p>
                              </div>
                              <span className="text-xs font-black text-rose-700">Qty {Number(r.qty || 0)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="rounded-2xl bg-slate-900 text-white p-4">
                    <div className="flex items-center justify-between text-xs">
                      <span>Subtotal</span>
                      <span>{formatCurrency(Number(displaySubtotal || 0))}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs mt-2">
                      <span>Diskon</span>
                      <span>-{formatCurrency(Number(displayDiscount || 0))}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs mt-2">
                      <span>Ongkir</span>
                      <span>{formatCurrency(Number(displayShipping || 0))}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs mt-2">
                      <span>Pajak</span>
                      <span>{formatCurrency(Number(displayTax || 0))}</span>
                    </div>
                    {hasDeliveryRetur && deliveryReturnTotal > 0 && (
                      <div className="flex items-center justify-between text-xs mt-2 text-rose-200">
                        <span>Potongan Retur</span>
                        <span>-{formatCurrency(deliveryReturnTotal)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-sm font-bold border-t border-white/20 mt-3 pt-3">
                      <span>Total Tagihan</span>
                      <span>{formatCurrency(Number(payableTotal || 0))}</span>
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
              className="print-only print-sheet bg-white border border-slate-200 rounded-2xl shadow-lg p-4 mt-4"
              style={{ fontFamily: '"Space Mono", monospace' }}
            >
              <div className="text-center">
                <p className="text-xs font-bold uppercase tracking-[0.35em] text-slate-900">Migunani Motor</p>
                <p className="text-[10px] text-slate-500">Suku cadang motor terpercaya</p>
              </div>

              <div className="border-t border-dashed border-slate-300 my-3" />

              <div className="text-[11px] space-y-1">
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
                  <span className="font-bold">{displayPaymentStatusLabel}</span>
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

              <div className="border-t border-dashed border-slate-300 my-3" />

              <div className="text-[11px] space-y-1">
                <p className="font-bold text-slate-900">Customer</p>
                <p>{detail.customer?.name || 'Customer'}</p>
                <p className="text-slate-600">WA: {detail.customer?.whatsapp_number || '-'}</p>
                <p className="text-slate-600">Email: {detail.customer?.email || '-'}</p>
              </div>

              <div className="text-[10px] text-slate-500 mt-2">
                Order: {orderIds.length > 0 ? orderIds.join(', ') : '-'}
              </div>

              <div className="border-t border-dashed border-slate-300 my-3" />

              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Item</div>
              <div className="mt-2 space-y-3">
                {items.length === 0 && (
                  <p className="text-[11px] text-slate-500">Tidak ada item di invoice ini.</p>
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
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-slate-900 truncate">{product.name || 'Produk'}</p>
                          <p className="text-[10px] text-slate-500">SKU: {product.sku || '-'}</p>
                          <p className="text-[10px] text-slate-500">Order: {orderId}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[11px] font-bold text-slate-900">{formatCurrency(Number(item.line_total || 0))}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-600">
                        <span>{orderedQty} x {formatCurrency(Number(item.unit_price || 0))}</span>
                        <span>Inv {invoiceQty} | Total {allocatedQty} | Sisa {remainingQty}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-dashed border-slate-300 my-3" />

              <div className="text-[11px] space-y-1">
                <div className="flex items-center justify-between">
                  <span>Subtotal</span>
                  <span>{formatCurrency(Number(displaySubtotal || 0))}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Diskon</span>
                  <span>-{formatCurrency(Number(displayDiscount || 0))}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Ongkir</span>
                  <span>{formatCurrency(Number(displayShipping || 0))}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Pajak</span>
                  <span>{formatCurrency(Number(displayTax || 0))}</span>
                </div>
                {hasDeliveryRetur && deliveryReturnTotal > 0 && (
                  <div className="flex items-center justify-between">
                    <span>Potongan Retur</span>
                    <span>-{formatCurrency(deliveryReturnTotal)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm font-bold border-t border-dashed border-slate-300 pt-2 mt-2">
                  <span>Total Tagihan</span>
                  <span>{formatCurrency(Number(payableTotal || 0))}</span>
                </div>
              </div>

              <div className="border-t border-dashed border-slate-300 my-3" />

              <p className="text-[10px] text-slate-500 text-center">
                {paymentInstructionLabel(detail.payment_method)}
              </p>
              <p className="text-[10px] text-slate-400 text-center mt-1">Terima kasih telah berbelanja.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
