'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';

type HistoryRow = {
  groupKey: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  orderIds: string[];
  totalAmount: number;
  paymentStatus: string;
  shipmentStatus: string;
  latestTs: number;
};

type LooseRecord = Record<string, unknown>;

const COMPLETED_STATUSES = new Set(['completed', 'canceled', 'expired']);

const normalizeInvoiceRef = (raw: unknown) => String(raw || '').trim();
const asRecord = (value: unknown): LooseRecord =>
  value && typeof value === 'object' ? (value as LooseRecord) : {};

const normalizeOrderStatus = (raw: unknown) => {
  const status = String(raw || '').trim();
  return status === 'waiting_payment' ? 'ready_to_ship' : status;
};

const paymentStatusLabel = (raw: unknown) => {
  const status = String(raw || '').trim().toLowerCase();
  if (status === 'mixed') return 'Gabungan';
  if (status === 'draft') return 'Draft';
  if (status === 'unpaid') return 'Belum Bayar';
  if (status === 'cod_pending') return 'COD Pending';
  if (status === 'paid') return 'Lunas';
  return '-';
};

const paymentStatusBadge = (raw: unknown) => {
  const status = String(raw || '').trim().toLowerCase();
  if (status === 'mixed') return 'bg-violet-100 text-violet-700 border-violet-200';
  if (status === 'paid') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (status === 'cod_pending') return 'bg-amber-100 text-amber-700 border-amber-200';
  if (status === 'unpaid' || status === 'draft') return 'bg-slate-100 text-slate-700 border-slate-200';
  return 'bg-slate-100 text-slate-500 border-slate-200';
};

const shipmentStatusLabel = (raw: unknown) => {
  const status = String(raw || '').trim().toLowerCase();
  if (status === 'mixed') return 'Gabungan';
  if (status === 'ready_to_ship') return 'Siap Kirim';
  if (status === 'shipped') return 'Dikirim';
  if (status === 'delivered') return 'Terkirim';
  if (status === 'canceled') return 'Dibatalkan';
  if (status === 'hold') return 'Ditahan';
  return '-';
};

const shipmentStatusBadge = (raw: unknown) => {
  const status = String(raw || '').trim().toLowerCase();
  if (status === 'mixed') return 'bg-violet-100 text-violet-700 border-violet-200';
  if (status === 'delivered' || status === 'completed') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (status === 'shipped') return 'bg-blue-100 text-blue-700 border-blue-200';
  if (status === 'ready_to_ship') return 'bg-indigo-100 text-indigo-700 border-indigo-200';
  if (status === 'canceled') return 'bg-rose-100 text-rose-700 border-rose-200';
  if (status === 'hold') return 'bg-violet-100 text-violet-700 border-violet-200';
  return 'bg-slate-100 text-slate-500 border-slate-200';
};

const formatInvoiceReference = (invoiceId: string, invoiceNumber: string) => {
  if (invoiceNumber) return invoiceNumber;
  if (invoiceId) return `INV-${invoiceId.slice(-8).toUpperCase()}`;
  return 'Invoice tanpa nomor';
};

function AdminCompletedInvoiceHistoryPageContent() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'admin_finance', 'kasir']);
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const scopedCustomerId = String(searchParams.get('customerId') || '').trim();
  const scopedCustomerName = String(searchParams.get('customerName') || '').trim();

  const loadRows = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!allowed) return;
    try {
      if (!silent) setLoading(true);
      const res = await api.admin.orderManagement.getAll({ page: 1, limit: 200, status: 'all' });
      const allOrders = Array.isArray(res.data?.orders) ? res.data.orders : [];
      const groups = new Map<string, HistoryRow & { paymentStatuses: Set<string>; shipmentStatuses: Set<string> }>();

      allOrders.forEach((order: unknown) => {
        const orderRow = asRecord(order);
        const invoiceRow = asRecord(orderRow.Invoice);
        const customerRow = asRecord(orderRow.Customer);
        const rawStatus = String(orderRow.status || '').trim();
        if (!COMPLETED_STATUSES.has(rawStatus)) return;
        if (scopedCustomerId && String(orderRow.customer_id || '').trim() !== scopedCustomerId) return;
        const invoiceId = normalizeInvoiceRef(orderRow.invoice_id || invoiceRow.id);
        const invoiceNumber = normalizeInvoiceRef(orderRow.invoice_number || invoiceRow.invoice_number);
        if (!invoiceId && !invoiceNumber) return;

        const groupKey = invoiceId ? `id:${invoiceId}` : `num:${invoiceNumber.toLowerCase()}`;
        const paymentStatus = String(invoiceRow.payment_status || '').trim().toLowerCase();
        const shipmentStatus = normalizeOrderStatus(invoiceRow.shipment_status || rawStatus);
        const latestTs = Date.parse(String(orderRow.updatedAt || orderRow.createdAt || ''));
        const row = groups.get(groupKey) || {
          groupKey,
          invoiceId,
          invoiceNumber,
          customerName: String(orderRow.customer_name || customerRow.name || 'Customer'),
          orderIds: [],
          totalAmount: 0,
          paymentStatus: '',
          shipmentStatus: '',
          latestTs: 0,
          paymentStatuses: new Set<string>(),
          shipmentStatuses: new Set<string>(),
        };

        row.orderIds.push(String(orderRow.id || ''));
        row.totalAmount += Number(orderRow.total_amount || 0);
        row.customerName = row.customerName || String(orderRow.customer_name || customerRow.name || 'Customer');
        if (paymentStatus) row.paymentStatuses.add(paymentStatus);
        if (shipmentStatus) row.shipmentStatuses.add(shipmentStatus);
        if (Number.isFinite(latestTs)) row.latestTs = Math.max(row.latestTs, latestTs);
        groups.set(groupKey, row);
      });

      const nextRows = Array.from(groups.values())
        .map((row) => ({
          groupKey: row.groupKey,
          invoiceId: row.invoiceId,
          invoiceNumber: row.invoiceNumber,
          customerName: row.customerName,
          orderIds: row.orderIds,
          totalAmount: row.totalAmount,
          paymentStatus:
            row.paymentStatuses.size === 1 ? Array.from(row.paymentStatuses)[0] : row.paymentStatuses.size > 1 ? 'mixed' : '',
          shipmentStatus:
            row.shipmentStatuses.size === 1 ? Array.from(row.shipmentStatuses)[0] : row.shipmentStatuses.size > 1 ? 'mixed' : '',
          latestTs: row.latestTs,
        }))
        .sort((a, b) => b.latestTs - a.latestTs);

      setRows(nextRows);
    } catch (error) {
      console.error('Failed to load completed invoice history:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [allowed, scopedCustomerId]);

  useEffect(() => {
    if (allowed) void loadRows();
  }, [allowed, loadRows]);

  useRealtimeRefresh({
    enabled: allowed,
    onRefresh: () => loadRows({ silent: true }),
    domains: ['order', 'retur', 'cod', 'admin'],
    pollIntervalMs: 30000,
  });

  const filteredRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => {
      const invoiceRef = formatInvoiceReference(row.invoiceId, row.invoiceNumber).toLowerCase();
      const customerName = String(row.customerName || '').toLowerCase();
      const orderIds = row.orderIds.join(' ').toLowerCase();
      return invoiceRef.includes(term) || customerName.includes(term) || orderIds.includes(term);
    });
  }, [query, rows]);

  const totalValue = filteredRows.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0);

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Admin Orders</p>
            <h1 className="text-xl font-black text-slate-900">Riwayat Invoice Selesai</h1>
            <p className="text-xs text-slate-600">
              {scopedCustomerId
                ? `Arsip invoice selesai untuk ${scopedCustomerName || 'customer terpilih'}. Dipisahkan dari monitor order aktif agar halaman utama tetap ringkas.`
                : 'Arsip invoice yang berasal dari order dengan status selesai. Dipisahkan dari monitor order aktif agar halaman utama tetap ringkas.'}
            </p>
          </div>
          <Link
            href="/admin/orders"
            className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
          >
            Kembali ke Monitor Order
          </Link>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] font-bold uppercase text-slate-600">Invoice Selesai</p>
            <p className="text-lg font-black text-slate-900">{filteredRows.length}</p>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3">
            <p className="text-[11px] font-bold uppercase text-emerald-700">Nilai Riwayat</p>
            <p className="text-lg font-black text-emerald-800">{formatCurrency(totalValue)}</p>
          </div>
        </div>
        {scopedCustomerId && (
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
            <p className="text-[11px] font-bold uppercase text-blue-700">Scope Customer</p>
            <p className="text-sm font-black text-blue-900">{scopedCustomerName || scopedCustomerId}</p>
            <p className="text-[11px] text-blue-700">{scopedCustomerId}</p>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-black text-slate-900">Daftar Riwayat</h2>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari invoice, customer, order"
            className="w-full sm:w-72 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
          />
        </div>

        {loading && <p className="text-sm text-slate-500">Memuat riwayat invoice...</p>}
        {!loading && filteredRows.length === 0 && (
          <p className="text-sm text-slate-500">Belum ada invoice selesai pada data yang tampil.</p>
        )}

        {!loading && filteredRows.length > 0 && (
          <div className="space-y-2">
            {filteredRows.map((row) => (
              <div key={row.groupKey} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900">{formatInvoiceReference(row.invoiceId, row.invoiceNumber)}</p>
                    <p className="text-[11px] text-slate-500">
                      {row.customerName} • {row.orderIds.length} order
                    </p>
                    <p className="text-[10px] text-slate-500">
                      Update terakhir {row.latestTs ? formatDateTime(new Date(row.latestTs)) : '-'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-slate-500">Nilai</p>
                    <p className="text-sm font-black text-slate-900">{formatCurrency(row.totalAmount)}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className={`px-2 py-1 rounded-full border text-[10px] font-bold ${paymentStatusBadge(row.paymentStatus)}`}>
                    Bayar: {paymentStatusLabel(row.paymentStatus)}
                  </span>
                  <span className={`px-2 py-1 rounded-full border text-[10px] font-bold ${shipmentStatusBadge(row.shipmentStatus)}`}>
                    Kirim: {shipmentStatusLabel(row.shipmentStatus)}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-[10px] font-bold">
                  {row.invoiceId ? (
                    <Link href={`/admin/orders/${row.invoiceId}`} className="text-emerald-700 hover:text-emerald-800">
                      Lihat Detail Invoice
                    </Link>
                  ) : null}
                  <span className="text-slate-500">Order: {row.orderIds.slice(0, 3).map((id) => `#${id.slice(-8).toUpperCase()}`).join(', ')}{row.orderIds.length > 3 ? ` +${row.orderIds.length - 3}` : ''}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminCompletedInvoiceHistoryPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Memuat riwayat invoice...</div>}>
      <AdminCompletedInvoiceHistoryPageContent />
    </Suspense>
  );
}
