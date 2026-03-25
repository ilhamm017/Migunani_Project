'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, ShoppingBag } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';

type CustomerOrderItem = {
  id?: string;
  qty?: number | string;
  ordered_qty_original?: number | string;
  qty_canceled_backorder?: number | string;
  Product?: {
    id?: string;
    name?: string;
    sku?: string;
  };
  Backorder?: {
    id?: string | number;
    qty_pending?: number | string;
    status?: string;
  } | null;
  InvoiceItems?: Array<{
    id?: string;
    qty?: number | string;
    line_total?: number | string;
    createdAt?: string;
    Invoice?: {
      id?: string;
      invoice_number?: string;
      payment_status?: string;
      payment_method?: string;
      createdAt?: string;
    } | null;
  }>;
};

type CustomerOrderRow = {
  id: string;
  status?: string;
  total_amount?: number | string;
  createdAt?: string;
  OrderItems?: CustomerOrderItem[];
  item_summaries?: Array<{
    order_item_id?: string;
    ordered_qty_original?: number | string;
    allocated_qty_total?: number | string;
    invoiced_qty_total?: number | string;
    backorder_open_qty?: number | string;
    backorder_canceled_qty?: number | string;
  }>;
  Invoice?: {
    id?: string;
    invoice_number?: string;
    payment_status?: string;
    payment_method?: string;
    createdAt?: string;
  };
  Invoices?: Array<{
    id?: string;
    invoice_number?: string;
    payment_status?: string;
    payment_method?: string;
    createdAt?: string;
    total?: number | string;
    collectible_total?: number | string;
    delivery_return_summary?: {
      net_total?: number | string;
      return_total?: number | string;
    };
  }>;
};

type AggregatedProduct = {
  key: string;
  name: string;
  sku: string;
  orderedQty: number;
  suppliedQty: number;
  backorderQty: number;
  orderCount: number;
  lastBoughtAt: string;
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    suppliedQty: number;
  }>;
};

type AggregatedInvoice = {
  id: string;
  invoiceNumber: string;
  paymentStatus: string;
  paymentMethod: string;
  createdAt: string;
  suppliedQty: number;
  productCount: number;
  totalValue: number;
  returnTotal: number;
  products: Array<{
    key: string;
    name: string;
    sku: string;
    suppliedQty: number;
  }>;
};

const todayInput = () => new Date().toISOString().slice(0, 10);
const monthStartInput = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
};

const extractOrderInvoices = (order: CustomerOrderRow) => {
  const rows = Array.isArray(order.Invoices) ? order.Invoices : [];
  if (rows.length > 0) {
    return rows
      .map((invoice) => ({
        id: String(invoice?.id || '').trim(),
        invoiceNumber: String(invoice?.invoice_number || '-'),
        paymentStatus: String(invoice?.payment_status || '-'),
        paymentMethod: String(invoice?.payment_method || '-'),
        createdAt: String(invoice?.createdAt || ''),
        totalValue: Number(invoice?.collectible_total ?? invoice?.delivery_return_summary?.net_total ?? invoice?.total ?? 0),
        returnTotal: Number(invoice?.delivery_return_summary?.return_total ?? 0),
      }))
      .filter((invoice) => invoice.id);
  }

  if (order.Invoice?.id || order.Invoice?.invoice_number) {
    return [{
      id: String(order.Invoice?.id || order.Invoice?.invoice_number || '').trim(),
      invoiceNumber: String(order.Invoice?.invoice_number || '-'),
      paymentStatus: String(order.Invoice?.payment_status || '-'),
      paymentMethod: String(order.Invoice?.payment_method || '-'),
      createdAt: String(order.Invoice?.createdAt || order.createdAt || ''),
      totalValue: Number(order.total_amount || 0),
      returnTotal: 0,
    }].filter((invoice) => invoice.id);
  }

  return [];
};

export default function CustomerPurchaseHistoryPanel({
  customerId,
  customerName,
  compact = false,
}: {
  customerId?: string;
  customerName?: string;
  compact?: boolean;
}) {
  const PAGE_SIZE = 10;
  const [startDate, setStartDate] = useState(monthStartInput());
  const [endDate, setEndDate] = useState(todayInput());
  const [orders, setOrders] = useState<CustomerOrderRow[]>([]);
  const [totalOrdersFound, setTotalOrdersFound] = useState(0);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [productPage, setProductPage] = useState(1);
  const [invoicePage, setInvoicePage] = useState(1);

  const enrichOrdersWithDetails = useCallback(async (rows: CustomerOrderRow[]) => {
    const needsDetailIds = rows
      .filter((row) => !Array.isArray(row.OrderItems) || row.OrderItems.length === 0)
      .map((row) => String(row.id || '').trim())
      .filter(Boolean);

    if (needsDetailIds.length === 0) {
      return rows;
    }

    const detailEntries: PromiseSettledResult<readonly [string, CustomerOrderRow]>[] = [];
    const batchSize = 8;
    for (let index = 0; index < needsDetailIds.length; index += batchSize) {
      const batch = needsDetailIds.slice(index, index + batchSize);
      const batchEntries = await Promise.allSettled(
        batch.map(async (orderId) => {
          const res = await api.orders.getOrderById(orderId);
          return [orderId, res.data as CustomerOrderRow] as const;
        })
      );
      detailEntries.push(...batchEntries);
    }

    const detailMap = new Map<string, CustomerOrderRow>();
    detailEntries.forEach((entry) => {
      if (entry.status !== 'fulfilled') return;
      const [orderId, data] = entry.value;
      detailMap.set(orderId, data);
    });

    return rows.map((row) => {
      const detail = detailMap.get(String(row.id || '').trim());
      if (!detail) return row;
      return {
        ...row,
        OrderItems: Array.isArray(detail.OrderItems) ? detail.OrderItems : row.OrderItems,
        item_summaries: Array.isArray(detail.item_summaries) ? detail.item_summaries : row.item_summaries,
        Invoice: detail.Invoice || row.Invoice,
      };
    });
  }, []);

  const loadOrders = useCallback(async () => {
    if (!customerId) {
      setOrders([]);
      setTotalOrdersFound(0);
      return;
    }
    try {
      setLoadingOrders(true);
      setSearchError('');
      const res = await api.admin.customers.getOrders(customerId, {
        page: 1,
        limit: 100,
        scope: 'all',
        startDate,
        endDate,
        include_collectible_total: true,
      });
      const rows = Array.isArray(res.data?.orders) ? res.data.orders as CustomerOrderRow[] : [];
      const enrichedRows = await enrichOrdersWithDetails(rows);
      setOrders(enrichedRows);
      setTotalOrdersFound(Number(res.data?.total || enrichedRows.length || 0));
      setProductPage(1);
      setInvoicePage(1);
    } catch (error: unknown) {
      console.error('Failed to load customer purchase orders:', error);
      const responseMessage = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setSearchError(responseMessage || 'Gagal memuat histori pembelian customer.');
      setOrders([]);
      setTotalOrdersFound(0);
    } finally {
      setLoadingOrders(false);
    }
  }, [customerId, endDate, startDate, enrichOrdersWithDetails]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const productSummary = useMemo<AggregatedProduct[]>(() => {
    const bucket = new Map<string, AggregatedProduct>();
    orders.forEach((order) => {
      const orderItems = Array.isArray(order.OrderItems) ? order.OrderItems : [];
      orderItems.forEach((item) => {
        const key = String(item?.Product?.id || item?.Product?.sku || item?.Product?.name || item?.id || '').trim();
        if (!key) return;
        const itemSummary = Array.isArray(order.item_summaries)
          ? order.item_summaries.find((entry) => String(entry?.order_item_id || '') === String(item?.id || ''))
          : null;
        const orderedQty = Math.max(
          Number(itemSummary?.ordered_qty_original || 0),
          Number(item?.ordered_qty_original || 0),
          Number(item?.qty || 0)
        );
        const backorderStatus = String(item?.Backorder?.status || '').toLowerCase();
        const backorderQty = Math.max(
          Number(itemSummary?.backorder_open_qty || 0),
          backorderStatus && backorderStatus !== 'fulfilled' && backorderStatus !== 'canceled'
            ? Number(item?.Backorder?.qty_pending || 0)
            : 0
        );
        const invoiceItems = Array.isArray(item?.InvoiceItems) ? item.InvoiceItems : [];
        const suppliedQty = Math.max(
          Number(itemSummary?.invoiced_qty_total || 0),
          invoiceItems.reduce((sum, invoiceItem) => sum + Number(invoiceItem?.qty || 0), 0)
        );
        const prev = bucket.get(key) || {
          key,
          name: String(item?.Product?.name || 'Produk'),
          sku: String(item?.Product?.sku || '-'),
          orderedQty: 0,
          suppliedQty: 0,
          backorderQty: 0,
          orderCount: 0,
          lastBoughtAt: '',
          invoices: [],
        };
        prev.orderedQty += orderedQty;
        prev.suppliedQty += suppliedQty;
        prev.backorderQty += backorderQty;
        prev.orderCount += 1;
        const currentTs = Date.parse(String(order.createdAt || ''));
        const prevTs = Date.parse(String(prev.lastBoughtAt || ''));
        if ((Number.isFinite(currentTs) ? currentTs : 0) >= (Number.isFinite(prevTs) ? prevTs : 0)) {
          prev.lastBoughtAt = String(order.createdAt || '');
        }
        invoiceItems.forEach((invoiceItem) => {
          const invoiceId = String(invoiceItem?.Invoice?.id || '').trim();
          if (!invoiceId) return;
          const existing = prev.invoices.find((entry) => entry.id === invoiceId);
          if (existing) {
            existing.suppliedQty += Number(invoiceItem?.qty || 0);
            return;
          }
          prev.invoices.push({
            id: invoiceId,
            invoiceNumber: String(invoiceItem?.Invoice?.invoice_number || '-'),
            suppliedQty: Number(invoiceItem?.qty || 0),
          });
        });
        if (invoiceItems.length === 0 && suppliedQty > 0) {
          const fallbackInvoices = extractOrderInvoices(order);
          const distributedQty = fallbackInvoices.length > 0 ? suppliedQty / fallbackInvoices.length : suppliedQty;
          fallbackInvoices.forEach((invoice) => {
            const existing = prev.invoices.find((entry) => entry.id === invoice.id);
            if (existing) {
              existing.suppliedQty += distributedQty;
              return;
            }
            prev.invoices.push({
              id: invoice.id,
              invoiceNumber: invoice.invoiceNumber,
              suppliedQty: distributedQty,
            });
          });
        }
        bucket.set(key, prev);
      });
    });
    return Array.from(bucket.values()).sort((a, b) => b.orderedQty - a.orderedQty);
  }, [orders]);

  const invoiceSummary = useMemo<AggregatedInvoice[]>(() => {
    const invoiceMetaById = new Map<string, { totalValue: number; returnTotal: number }>();
    orders.forEach((order) => {
      extractOrderInvoices(order).forEach((inv) => {
        if (!inv?.id) return;
        invoiceMetaById.set(inv.id, { totalValue: Number(inv.totalValue || 0), returnTotal: Number(inv.returnTotal || 0) });
      });
    });

    const invoiceBucket = new Map<string, AggregatedInvoice>();
    orders.forEach((order) => {
      const orderItems = Array.isArray(order.OrderItems) ? order.OrderItems : [];
      const fallbackInvoices = extractOrderInvoices(order);
      orderItems.forEach((item) => {
        const productKey = String(item?.Product?.id || item?.Product?.sku || item?.Product?.name || item?.id || '').trim();
        const productName = String(item?.Product?.name || 'Produk');
        const sku = String(item?.Product?.sku || '-');
        const invoiceItems = Array.isArray(item?.InvoiceItems) ? item.InvoiceItems : [];
        invoiceItems.forEach((invoiceItem) => {
          const invoiceId = String(invoiceItem?.Invoice?.id || '').trim();
          if (!invoiceId) return;
          const suppliedQty = Number(invoiceItem?.qty || 0);
          const invoiceMeta = invoiceMetaById.get(invoiceId);
          const invoice = invoiceBucket.get(invoiceId) || {
            id: invoiceId,
            invoiceNumber: String(invoiceItem?.Invoice?.invoice_number || '-'),
            paymentStatus: String(invoiceItem?.Invoice?.payment_status || '-'),
            paymentMethod: String(invoiceItem?.Invoice?.payment_method || '-'),
            createdAt: String(invoiceItem?.Invoice?.createdAt || invoiceItem?.createdAt || ''),
            suppliedQty: 0,
            productCount: 0,
            totalValue: invoiceMeta ? Number(invoiceMeta.totalValue || 0) : 0,
            returnTotal: invoiceMeta ? Number(invoiceMeta.returnTotal || 0) : 0,
            products: [],
          };
          invoice.suppliedQty += suppliedQty;
          if (!invoiceMeta) {
            invoice.totalValue += Number(invoiceItem?.line_total || 0);
          }
          const productExisting = invoice.products.find((entry) => entry.key === productKey);
          if (productExisting) {
            productExisting.suppliedQty += suppliedQty;
          } else {
            invoice.products.push({
              key: productKey,
              name: productName,
              sku,
              suppliedQty,
            });
          }
          invoice.productCount = invoice.products.length;
          invoiceBucket.set(invoiceId, invoice);
        });
        if (invoiceItems.length === 0) {
          const itemSummary = Array.isArray(order.item_summaries)
            ? order.item_summaries.find((entry) => String(entry?.order_item_id || '') === String(item?.id || ''))
            : null;
          const suppliedQty = Number(itemSummary?.invoiced_qty_total || 0);
          if (suppliedQty <= 0) return;
          const distributedQty = fallbackInvoices.length > 0 ? suppliedQty / fallbackInvoices.length : suppliedQty;
          fallbackInvoices.forEach((invoiceMeta) => {
            const meta = invoiceMetaById.get(invoiceMeta.id);
            const invoice = invoiceBucket.get(invoiceMeta.id) || {
              id: invoiceMeta.id,
              invoiceNumber: invoiceMeta.invoiceNumber,
              paymentStatus: invoiceMeta.paymentStatus,
              paymentMethod: invoiceMeta.paymentMethod,
              createdAt: invoiceMeta.createdAt,
              suppliedQty: 0,
              productCount: 0,
              totalValue: Number(meta?.totalValue ?? invoiceMeta.totalValue ?? 0),
              returnTotal: Number(meta?.returnTotal ?? invoiceMeta.returnTotal ?? 0),
              products: [],
            };
            invoice.suppliedQty += distributedQty;
            const productExisting = invoice.products.find((entry) => entry.key === productKey);
            if (productExisting) {
              productExisting.suppliedQty += distributedQty;
            } else {
              invoice.products.push({
                key: productKey,
                name: productName,
                sku,
                suppliedQty: distributedQty,
              });
            }
            invoice.productCount = invoice.products.length;
            invoiceBucket.set(invoiceMeta.id, invoice);
          });
        }
      });
    });
    return Array.from(invoiceBucket.values()).sort((a, b) => {
      const aTs = Date.parse(a.createdAt || '');
      const bTs = Date.parse(b.createdAt || '');
      return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
    });
  }, [orders]);

  const totalValue = useMemo(
    () => invoiceSummary.reduce((sum, invoice) => sum + Number(invoice.totalValue || 0), 0),
    [invoiceSummary]
  );
  const totalQty = useMemo(
    () => productSummary.reduce((sum, item) => sum + item.orderedQty, 0),
    [productSummary]
  );
  const totalSuppliedQty = useMemo(
    () => productSummary.reduce((sum, item) => sum + item.suppliedQty, 0),
    [productSummary]
  );
  const totalBackorderQty = useMemo(
    () => productSummary.reduce((sum, item) => sum + item.backorderQty, 0),
    [productSummary]
  );
  const productPageCount = Math.max(1, Math.ceil(productSummary.length / PAGE_SIZE));
  const invoicePageCount = Math.max(1, Math.ceil(invoiceSummary.length / PAGE_SIZE));
  const paginatedProducts = useMemo(
    () => productSummary.slice((productPage - 1) * PAGE_SIZE, productPage * PAGE_SIZE),
    [productSummary, productPage]
  );
  const paginatedInvoices = useMemo(
    () => invoiceSummary.slice((invoicePage - 1) * PAGE_SIZE, invoicePage * PAGE_SIZE),
    [invoiceSummary, invoicePage]
  );

  return (
    <div className="space-y-5">
      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Histori Belanja</p>
            <h3 className="mt-1 text-lg font-black text-slate-900">{customerName || 'Customer'}</h3>
            <p className="mt-2 text-xs text-slate-500">Lihat barang yang dibeli customer ini dalam rentang waktu tertentu.</p>
          </div>
        </div>

        <div className={`mt-4 grid ${compact ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-3'} gap-3`}>
          <label className="space-y-1">
            <span className="text-[11px] font-bold text-slate-600">Tanggal Mulai</span>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 outline-none focus:border-emerald-300 focus:bg-white"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] font-bold text-slate-600">Tanggal Akhir</span>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 outline-none focus:border-emerald-300 focus:bg-white"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void loadOrders()}
              disabled={!customerId || loadingOrders}
              className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-[11px] font-black uppercase tracking-wide text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {loadingOrders ? 'Memuat...' : 'Refresh Histori'}
            </button>
          </div>
        </div>
      </div>

      {searchError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          {searchError}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Order</p>
          <p className="mt-2 text-2xl font-black text-slate-900">{totalOrdersFound}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Produk Unik</p>
          <p className="mt-2 text-2xl font-black text-slate-900">{productSummary.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Qty Order</p>
          <p className="mt-2 text-2xl font-black text-slate-900">{totalQty}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Nilai Order</p>
          <p className="mt-2 text-xl font-black text-emerald-700">{formatCurrency(totalValue)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Qty Tersuplai</p>
          <p className="mt-2 text-2xl font-black text-emerald-900">{totalSuppliedQty}</p>
        </div>
        <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-orange-700">Qty Backorder</p>
          <p className="mt-2 text-2xl font-black text-orange-900">{totalBackorderQty}</p>
        </div>
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Invoice Sumber</p>
          <p className="mt-2 text-2xl font-black text-blue-900">{invoiceSummary.length}</p>
        </div>
      </div>

      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Produk Dibeli</p>
            <h3 className="mt-1 text-lg font-black text-slate-900">Daftar Barang Customer</h3>
          </div>
          <div className="inline-flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600 border border-slate-200">
            <Package size={14} /> {productSummary.length} produk
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {!loadingOrders && totalOrdersFound > 0 && productSummary.length === 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
              <p className="text-sm font-black text-amber-900">Order ditemukan, tetapi detail barang belum terbaca penuh.</p>
              <p className="mt-1 text-xs text-amber-800">
                Ada {totalOrdersFound} order dalam rentang tanggal ini. Coba refresh halaman. Jika tetap sama, backend yang sedang aktif belum memuat payload histori barang terbaru.
              </p>
            </div>
          )}
          {customerId && !loadingOrders && totalOrdersFound === 0 && productSummary.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
              <p className="text-sm font-bold text-slate-500">Belum ada pembelian pada periode ini.</p>
            </div>
          )}
          {!customerId && (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
              <p className="text-sm font-bold text-slate-500">Pilih customer untuk melihat daftar barang yang dibeli.</p>
            </div>
          )}
          {paginatedProducts.map((item) => (
            <div key={item.key} className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-slate-900">{item.name}</p>
                  <p className="text-[11px] text-slate-500 mt-1">Serial / SKU: {item.sku}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Muncul di Order</p>
                  <p className="text-lg font-black text-slate-900">{item.orderCount}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                <div className="rounded-xl bg-white border border-slate-200 px-3 py-2">
                  <p className="font-black text-slate-400 uppercase text-[10px] tracking-wide">Order</p>
                  <p className="mt-1 font-bold text-slate-800">{item.orderedQty}</p>
                </div>
                <div className="rounded-xl bg-white border border-slate-200 px-3 py-2">
                  <p className="font-black text-slate-400 uppercase text-[10px] tracking-wide">Tersuplai</p>
                  <p className="mt-1 font-bold text-emerald-700">{item.suppliedQty}</p>
                </div>
                <div className="rounded-xl bg-white border border-slate-200 px-3 py-2">
                  <p className="font-black text-slate-400 uppercase text-[10px] tracking-wide">Backorder</p>
                  <p className="mt-1 font-bold text-orange-700">{item.backorderQty}</p>
                </div>
                <div className="rounded-xl bg-white border border-slate-200 px-3 py-2">
                  <p className="font-black text-slate-400 uppercase text-[10px] tracking-wide">Terakhir Order</p>
                  <p className="mt-1 font-bold text-slate-800">{item.lastBoughtAt ? formatDateTime(item.lastBoughtAt) : '-'}</p>
                </div>
              </div>
            </div>
          ))}
          {productSummary.length > PAGE_SIZE && (
            <div className="flex items-center justify-between gap-3 pt-2">
              <p className="text-xs text-slate-500">
                Halaman {productPage} dari {productPageCount}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={productPage <= 1}
                  onClick={() => setProductPage((page) => Math.max(1, page - 1))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 disabled:opacity-50"
                >
                  Sebelumnya
                </button>
                <button
                  type="button"
                  disabled={productPage >= productPageCount}
                  onClick={() => setProductPage((page) => Math.min(productPageCount, page + 1))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 disabled:opacity-50"
                >
                  Berikutnya
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Invoice Sumber</p>
            <h3 className="mt-1 text-lg font-black text-slate-900">Sumber Invoice Barang Dalam Periode</h3>
          </div>
          <div className="inline-flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600 border border-slate-200">
            <ShoppingBag size={14} /> {invoiceSummary.length} invoice
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {!loadingOrders && totalOrdersFound > 0 && invoiceSummary.length === 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
              <p className="text-sm font-black text-amber-900">Order ditemukan, tetapi invoice sumber belum terbaca penuh.</p>
              <p className="mt-1 text-xs text-amber-800">
                Data order untuk rentang tanggal ini ada, namun invoice item belum ikut termuat di instance backend yang sedang aktif.
              </p>
            </div>
          )}
          {!loadingOrders && totalOrdersFound === 0 && invoiceSummary.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
              <p className="text-sm font-bold text-slate-500">Belum ada invoice sumber pada periode ini.</p>
            </div>
          )}
          {paginatedInvoices.map((invoice) => (
            <div key={invoice.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Link
                    href={`/admin/orders/${invoice.id}`}
                    className="text-sm font-black text-slate-900 hover:text-emerald-700"
                  >
                    {invoice.invoiceNumber}
                  </Link>
                  <p className="text-[11px] text-slate-500 mt-1">{invoice.createdAt ? formatDateTime(invoice.createdAt) : '-'}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Nilai Invoice</p>
                  <p className="text-sm font-black text-emerald-700">{formatCurrency(invoice.totalValue)}</p>
                  {invoice.returnTotal > 0 && (
                    <p className="mt-1 text-[11px] font-bold text-rose-700">
                      Retur: -{formatCurrency(invoice.returnTotal)}
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full bg-white border border-slate-200 px-2.5 py-1 text-[10px] font-black uppercase text-slate-600">
                  {invoice.paymentStatus}
                </span>
                <span className="rounded-full bg-white border border-slate-200 px-2.5 py-1 text-[10px] font-bold text-slate-600">
                  {invoice.paymentMethod}
                </span>
                <span className="rounded-full bg-blue-50 border border-blue-200 px-2.5 py-1 text-[10px] font-bold text-blue-700">
                  {invoice.suppliedQty} qty tersuplai
                </span>
              </div>
              <div className="mt-3 space-y-1.5">
                {invoice.products.map((product) => (
                  <div key={`${invoice.id}-${product.key}`} className="flex items-center justify-between gap-3 text-[11px]">
                    <div className="inline-flex items-center gap-2 text-slate-700">
                      <Package size={12} className="text-slate-400" />
                      <span className="font-semibold">{product.name}</span>
                      <span className="text-slate-400">({product.sku})</span>
                    </div>
                    <span className="font-black text-slate-900">{product.suppliedQty} qty</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {invoiceSummary.length > PAGE_SIZE && (
            <div className="flex items-center justify-between gap-3 pt-2">
              <p className="text-xs text-slate-500">
                Halaman {invoicePage} dari {invoicePageCount}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={invoicePage <= 1}
                  onClick={() => setInvoicePage((page) => Math.max(1, page - 1))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 disabled:opacity-50"
                >
                  Sebelumnya
                </button>
                <button
                  type="button"
                  disabled={invoicePage >= invoicePageCount}
                  onClick={() => setInvoicePage((page) => Math.min(invoicePageCount, page + 1))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 disabled:opacity-50"
                >
                  Berikutnya
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
