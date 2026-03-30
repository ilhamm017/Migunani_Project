'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';

type LooseRecord = Record<string, unknown>;

type HistoryRow = {
  groupKey: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  orderIds: string[];
  shipmentStatus: string;
  driverName: string;
  latestTs: number;
  shippedAt?: string | null;
  deliveredAt?: string | null;
};

const asRecord = (value: unknown): LooseRecord =>
  value && typeof value === 'object' ? (value as LooseRecord) : {};

const normalizeInvoiceRef = (raw: unknown) => String(raw || '').trim();

const shipmentStatusLabel = (raw: unknown) => {
  const status = String(raw || '').trim().toLowerCase();
  if (status === 'ready_to_ship') return 'Siap Kirim';
  if (status === 'shipped') return 'Dikirim';
  if (status === 'delivered') return 'Terkirim';
  if (status === 'canceled') return 'Dibatalkan';
  if (status === 'hold') return 'Ditahan';
  return status || '-';
};

const shipmentStatusBadge = (raw: unknown) => {
  const status = String(raw || '').trim().toLowerCase();
  if (status === 'delivered') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (status === 'shipped') return 'bg-blue-100 text-blue-700 border-blue-200';
  if (status === 'ready_to_ship') return 'bg-indigo-100 text-indigo-700 border-indigo-200';
  if (status === 'canceled') return 'bg-rose-100 text-rose-700 border-rose-200';
  if (status === 'hold') return 'bg-violet-100 text-violet-700 border-violet-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
};

const formatInvoiceReference = (invoiceId: string, invoiceNumber: string) => {
  if (invoiceNumber) return invoiceNumber;
  if (invoiceId) return `INV-${invoiceId.slice(-8).toUpperCase()}`;
  return 'Invoice tanpa nomor';
};

export default function AdminRiwayatPengirimanPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'checker_gudang', 'admin_finance', 'kasir']);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const loadRows = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!allowed) return;
    try {
      if (!silent) setLoading(true);
      const res = await api.admin.orderManagement.getAll({ page: 1, limit: 200, status: 'all' });
      const allOrders = Array.isArray(res.data?.orders) ? res.data.orders : [];
      const groups = new Map<string, HistoryRow>();

      allOrders.forEach((order: unknown) => {
        const orderRow = asRecord(order);
        const invoiceRow = asRecord(orderRow.Invoice);
        const customerRow = asRecord(orderRow.Customer);
        const invoiceId = normalizeInvoiceRef(orderRow.invoice_id || invoiceRow.id);
        const invoiceNumber = normalizeInvoiceRef(orderRow.invoice_number || invoiceRow.invoice_number);
        const shipmentStatus = String(invoiceRow.shipment_status || '').trim().toLowerCase();
        if (!invoiceId && !invoiceNumber) return;
        if (!['shipped', 'delivered'].includes(shipmentStatus)) return;

        const groupKey = invoiceId ? `id:${invoiceId}` : `num:${invoiceNumber.toLowerCase()}`;
        const orderId = String(orderRow.id || '').trim();
        const customerName = String(orderRow.customer_name || customerRow.name || 'Customer');
        const driverName = String(
          (orderRow as any).courier_display_name ||
          asRecord(orderRow.Courier).name ||
          asRecord(invoiceRow.Courier).name ||
          ''
        ).trim();

        const shippedAt = invoiceRow.shipped_at ? String(invoiceRow.shipped_at) : null;
        const deliveredAt = invoiceRow.delivered_at ? String(invoiceRow.delivered_at) : null;
        const latestIso = deliveredAt || shippedAt || String(orderRow.updatedAt || orderRow.createdAt || '');
        const latestTs = Date.parse(latestIso);

        const existing = groups.get(groupKey) || {
          groupKey,
          invoiceId,
          invoiceNumber,
          customerName,
          orderIds: [],
          shipmentStatus,
          driverName,
          latestTs: Number.isFinite(latestTs) ? latestTs : 0,
          shippedAt,
          deliveredAt,
        };

        if (orderId && !existing.orderIds.includes(orderId)) existing.orderIds.push(orderId);
        existing.latestTs = Math.max(existing.latestTs, Number.isFinite(latestTs) ? latestTs : 0);
        if (!existing.driverName && driverName) existing.driverName = driverName;
        if (existing.shipmentStatus !== shipmentStatus) {
          existing.shipmentStatus = existing.shipmentStatus === 'delivered' || shipmentStatus === 'delivered'
            ? 'delivered'
            : 'shipped';
        }
        if (!existing.shippedAt && shippedAt) existing.shippedAt = shippedAt;
        if (!existing.deliveredAt && deliveredAt) existing.deliveredAt = deliveredAt;

        groups.set(groupKey, existing);
      });

      setRows(Array.from(groups.values()).sort((a, b) => b.latestTs - a.latestTs));
    } catch (error) {
      console.error('Failed to load delivery history rows:', error);
      setRows([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [allowed]);

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
      const invoiceNumber = String(row.invoiceNumber || '').toLowerCase();
      const customerName = String(row.customerName || '').toLowerCase();
      const invoiceId = String(row.invoiceId || '').toLowerCase();
      const driverName = String(row.driverName || '').toLowerCase();
      const orderIds = row.orderIds.map((id) => String(id).toLowerCase()).join(' ');
      return (
        invoiceNumber.includes(term)
        || customerName.includes(term)
        || invoiceId.includes(term)
        || driverName.includes(term)
        || orderIds.includes(term)
      );
    });
  }, [rows, query]);

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2">
        <h1 className="text-xl font-black text-slate-900">Riwayat Pengiriman</h1>
        <p className="text-xs text-slate-600">
          Daftar invoice yang status pengirimannya sudah <span className="font-bold">Dikirim</span> atau <span className="font-bold">Terkirim</span>.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari invoice, order, customer, driver"
            className="w-full sm:w-80 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
          />
          <button
            type="button"
            onClick={() => void loadRows()}
            className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-[11px] font-black uppercase text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-black text-slate-900">Daftar Pengiriman</h2>
          <p className="text-xs text-slate-500">{filteredRows.length} invoice</p>
        </div>
        {loading && <p className="text-sm text-slate-500">Memuat data...</p>}
        {!loading && filteredRows.length === 0 && (
          <p className="text-sm text-slate-500">Belum ada invoice dikirim/terkirim pada data yang termuat.</p>
        )}
        {!loading && filteredRows.length > 0 && (
          <div className="space-y-2">
            {filteredRows.map((row) => {
              const invoiceRef = formatInvoiceReference(row.invoiceId, row.invoiceNumber);
              const deliveredAt = row.deliveredAt ? formatDateTime(row.deliveredAt) : '-';
              const shippedAt = row.shippedAt ? formatDateTime(row.shippedAt) : '-';
              return (
                <div
                  key={row.groupKey}
                  className="border rounded-xl p-4 transition-colors bg-slate-50 border-slate-200 hover:bg-slate-100"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-900 truncate">{row.customerName || '-'}</p>
                      <p className="text-xs text-slate-600 truncate">
                        {invoiceRef}
                        {row.driverName ? ` • Driver ${row.driverName}` : ''}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        Shipped: {shippedAt} • Delivered: {deliveredAt} • Order: {row.orderIds.length}
                      </p>
                    </div>
                    <div className="shrink-0 flex items-start gap-2">
                      <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-black uppercase ${shipmentStatusBadge(row.shipmentStatus)}`}>
                        {shipmentStatusLabel(row.shipmentStatus)}
                      </span>
                      <div className="flex gap-2">
                        {row.invoiceId && (
                          <Link
                            href={`/admin/orders/${encodeURIComponent(row.invoiceId)}/delivery-history`}
                            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1 text-[10px] font-black text-slate-700 hover:bg-slate-50"
                          >
                            Riwayat
                          </Link>
                        )}
                        {row.invoiceId && (
                          <Link
                            href={`/admin/orders/${encodeURIComponent(row.invoiceId)}`}
                            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1 text-[10px] font-black text-slate-700 hover:bg-slate-50"
                          >
                            Detail
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

