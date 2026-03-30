'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

type LooseRecord = Record<string, unknown>;

const asRecord = (value: unknown): LooseRecord =>
  value && typeof value === "object" ? (value as LooseRecord) : {};

const normalizeStatus = (raw: unknown) => {
  const status = String(raw || '').trim();
  return status === 'waiting_payment' ? 'ready_to_ship' : status;
};

const normalizeProofImageUrl = (raw?: string | null) => {
  if (!raw) return null;
  const val = String(raw).trim();
  if (!val) return null;
  if (val.startsWith('http://') || val.startsWith('https://')) return val;
  if (val.startsWith('/uploads/')) return val;
  if (val.startsWith('uploads/')) return `/${val}`;
  const normalizedSlash = val.replace(/\\/g, '/');
  if (normalizedSlash.startsWith('uploads/')) return `/${normalizedSlash}`;
  const uploadsIndex = normalizedSlash.indexOf('/uploads/');
  if (uploadsIndex >= 0) return normalizedSlash.slice(uploadsIndex);
  return val;
};

const formatOrderEventLabel = (eventTypeRaw: unknown) => {
  const eventType = String(eventTypeRaw || '').trim();
  if (!eventType) return '-';
  if (eventType === 'driver_assigned') return 'Driver ditugaskan';
  if (eventType === 'warehouse_checked') return 'Checker gudang selesai';
  if (eventType === 'warehouse_handed_over') return 'Serah-terima ke driver';
  if (eventType === 'invoice_issued') return 'Invoice diterbitkan';
  if (eventType === 'allocation_set') return 'Alokasi diset';
  if (eventType === 'order_status_changed') return 'Status pesanan berubah';
  if (eventType === 'backorder_opened') return 'Backorder dibuka';
  if (eventType === 'backorder_reallocated') return 'Backorder dialokasikan ulang';
  if (eventType === 'backorder_canceled') return 'Backorder dibatalkan';
  return eventType;
};

const collectOrderIdsFromInvoice = (invoiceData: unknown): string[] => {
  const invoiceRow = asRecord(invoiceData);
  const ids = new Set<string>();
  const rows = Array.isArray(invoiceRow.Orders) ? invoiceRow.Orders : [];
  rows.forEach((row: unknown) => {
    const rowData = asRecord(row);
    const orderRef = asRecord(rowData.Order);
    const id = String(rowData.id || rowData.order_id || orderRef.id || '').trim();
    if (id) ids.add(id);
  });
  const items = Array.isArray(invoiceRow.InvoiceItems) ? invoiceRow.InvoiceItems : [];
  items.forEach((item: unknown) => {
    const itemData = asRecord(item);
    const orderItemRef = asRecord(itemData.OrderItem);
    const orderRef = asRecord(itemData.Order);
    const id = String(orderItemRef.order_id || itemData.order_id || orderRef.id || '').trim();
    if (id) ids.add(id);
  });
  return Array.from(ids);
};

const getInvoiceRefFromOrder = (orderData: unknown): string => {
  const orderRow = asRecord(orderData);
  const invoiceRow = asRecord(orderRow.Invoice);
  const invoiceId = String(orderRow.invoice_id || invoiceRow.id || '').trim();
  if (invoiceId) return invoiceId;
  return '';
};

export default function AdminDeliveryHistoryPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'checker_gudang', 'admin_finance', 'kasir']);
  const { user } = useAuthStore();
  const params = useParams();
  const router = useRouter();
  const routeRefId = String(params?.id || '').trim();

  const [invoice, setInvoice] = useState<LooseRecord | null>(null);
  const [orders, setOrders] = useState<LooseRecord[]>([]);
  const [resolvedInvoiceId, setResolvedInvoiceId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    if (!routeRefId) {
      setInvoice(null);
      setOrders([]);
      setResolvedInvoiceId('');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError('');

      let invoiceData: LooseRecord | null = null;
      let invoiceId = '';
      let fallbackOrderData: LooseRecord | null = null;

      try {
        const invoiceRes = await api.invoices.getById(routeRefId);
        invoiceData = invoiceRes.data && typeof invoiceRes.data === 'object' ? (invoiceRes.data as LooseRecord) : null;
        invoiceId = String(asRecord(invoiceData).id || routeRefId).trim();
      } catch {
        const orderRes = await api.orders.getOrderById(routeRefId);
        fallbackOrderData = orderRes.data && typeof orderRes.data === 'object' ? (orderRes.data as LooseRecord) : null;
        invoiceId = getInvoiceRefFromOrder(fallbackOrderData);
        if (!invoiceId) throw new Error('Invoice tidak ditemukan dari order ini.');
        const invoiceRes = await api.invoices.getById(invoiceId);
        invoiceData = invoiceRes.data && typeof invoiceRes.data === 'object' ? (invoiceRes.data as LooseRecord) : null;
      }

      const orderIds = new Set<string>(collectOrderIdsFromInvoice(invoiceData));
      const orderDetailsResults = await Promise.allSettled(
        Array.from(orderIds).map((id) => api.orders.getOrderById(id))
      );
      const orderRows: LooseRecord[] = orderDetailsResults
        .map((result) => (result.status === 'fulfilled' ? result.value.data : null))
        .filter((row): row is LooseRecord => Boolean(row && typeof row === 'object'));

      setInvoice(invoiceData);
      setOrders(orderRows);
      setResolvedInvoiceId(invoiceId);
    } catch (e: any) {
      setInvoice(null);
      setOrders([]);
      setResolvedInvoiceId('');
      setError(String(e?.response?.data?.message || e?.message || 'Gagal memuat data pengiriman.'));
    } finally {
      setLoading(false);
    }
  }, [routeRefId]);

  useEffect(() => {
    if (!allowed) return;
    void loadData();
  }, [allowed, loadData]);

  const invoiceRow = useMemo(() => asRecord(invoice), [invoice]);
  const normalizedRole = String(user?.role || '').trim();
  const isAdminRole = ['super_admin', 'admin_gudang', 'checker_gudang', 'admin_finance', 'kasir'].includes(normalizedRole);

  const invoiceNumber = String(invoiceRow.invoice_number || '-');
  const deliveryProofImageUrl = normalizeProofImageUrl(
    typeof invoiceRow.delivery_proof_url === 'string' ? invoiceRow.delivery_proof_url : null
  );

  const warehouseHandoverHistoryRows = Array.isArray(invoiceRow.warehouse_handover_history)
    ? (invoiceRow.warehouse_handover_history as unknown[]).map((row) => asRecord(row))
    : [];

  const statusTimeline = useMemo(() => {
    const rows: Array<{
      key: string;
      occurredAtMs: number;
      occurredAt: string | null;
      orderId: string;
      eventType: string;
      label: string;
      actorRole: string | null;
      reason: string | null;
      beforeStatus: string | null;
      afterStatus: string | null;
    }> = [];

    orders.forEach((order) => {
      const orderRow = asRecord(order);
      const orderId = String(orderRow.id || '').trim();
      const timeline = Array.isArray(orderRow.timeline) ? (orderRow.timeline as unknown[]) : [];
      timeline.forEach((raw) => {
        const evt = asRecord(raw);
        const occurredAt = evt.occurred_at ? String(evt.occurred_at) : (evt.createdAt ? String(evt.createdAt) : null);
        const occurredAtMs = occurredAt ? Date.parse(occurredAt) : 0;
        const payload = asRecord(evt.payload);
        const before = asRecord(payload.before);
        const after = asRecord(payload.after);
        const beforeStatus = before.status ? String(before.status).trim() : '';
        const afterStatus = after.status ? String(after.status).trim() : '';
        const normalizedBefore = beforeStatus ? normalizeStatus(beforeStatus) : '';
        const normalizedAfter = afterStatus ? normalizeStatus(afterStatus) : '';

        rows.push({
          key: String(evt.id || `${orderId}:${evt.event_type}:${occurredAt || ''}:${Math.random()}`),
          occurredAtMs: Number.isFinite(occurredAtMs) ? occurredAtMs : 0,
          occurredAt,
          orderId,
          eventType: String(evt.event_type || ''),
          label: formatOrderEventLabel(evt.event_type),
          actorRole: evt.actor_role ? String(evt.actor_role) : null,
          reason: evt.reason ? String(evt.reason) : null,
          beforeStatus: normalizedBefore || null,
          afterStatus: normalizedAfter || null,
        });
      });
    });

    return rows
      .filter((row) => row.eventType)
      .sort((a, b) => a.occurredAtMs - b.occurredAtMs);
  }, [orders]);

  const deliveryRetursRaw = Array.isArray(invoiceRow.delivery_returs) ? invoiceRow.delivery_returs : [];

  if (!allowed) return null;
  if (!isAdminRole) return null;

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-sm text-slate-500">Memuat riwayat pengiriman...</p>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-rose-600">{error || 'Invoice tidak ditemukan.'}</p>
        <Link href="/admin/orders" className="text-sm font-bold text-emerald-700">
          Kembali
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <button data-no-3d="true" onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
          <ArrowLeft size={16} /> Kembali
        </button>
        <button
          type="button"
          onClick={() => void loadData()}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase text-slate-700"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-[28px] p-6 shadow-sm space-y-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Riwayat Pengiriman</p>
        <p className="text-lg font-black text-slate-900">{invoiceNumber}</p>
        <p className="text-xs text-slate-500">Invoice ID: {resolvedInvoiceId || '-'}</p>
        {resolvedInvoiceId && (
          <Link
            href={`/admin/orders/${encodeURIComponent(resolvedInvoiceId)}`}
            className="inline-flex items-center rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"
          >
            Buka Detail Invoice
          </Link>
        )}
      </div>

      {deliveryProofImageUrl && (
        <div className="rounded-[24px] border border-slate-200 bg-white p-5 space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Bukti Pengiriman (Driver)</p>
          <Image
            src={deliveryProofImageUrl}
            alt="Bukti pengiriman"
            width={960}
            height={540}
            className="w-full max-h-[420px] object-contain rounded-lg bg-white border border-slate-200"
          />
        </div>
      )}

      {warehouseHandoverHistoryRows.length > 0 && (
        <div className="rounded-[24px] border border-slate-200 bg-white p-5 space-y-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Riwayat Checker Gudang</p>
            <p className="text-xs font-bold text-slate-700 mt-1">
              Menampilkan {warehouseHandoverHistoryRows.length} aktivitas checker terbaru pada invoice ini.
            </p>
          </div>
          <div className="space-y-3">
            {warehouseHandoverHistoryRows.map((row) => {
              const id = String(row.id || '');
              const status = String(row.status || '-');
              const checkedAt = row.checked_at ? String(row.checked_at) : null;
              const handedOverAt = row.handed_over_at ? String(row.handed_over_at) : null;
              const note = typeof row.note === 'string' && row.note.trim() ? row.note.trim() : null;
              const driverName = String(asRecord(row.Driver).name || '').trim();
              const checkerName = String(asRecord(row.Checker).name || '').trim();
              const evidenceUrl = normalizeProofImageUrl(typeof row.evidence_url === 'string' ? row.evidence_url : null);
              const items = Array.isArray(row.Items) ? (row.Items as unknown[]).map((it) => asRecord(it)) : [];
              const itemEvidences = items
                .map((it) => ({
                  id: String(it.id || ''),
                  productName: String(asRecord(asRecord(it.Product)).name || '').trim(),
                  evidenceUrl: normalizeProofImageUrl(typeof it.evidence_url === 'string' ? it.evidence_url : null),
                }))
                .filter((it) => Boolean(it.evidenceUrl));

              return (
                <div key={id || `${status}:${checkedAt || ''}`} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-black text-slate-900">
                        {status.replace(/_/g, ' ')}
                      </p>
                      <p className="text-[11px] text-slate-600">
                        Checked: {checkedAt ? formatDateTime(checkedAt) : '-'}
                        {handedOverAt ? ` • Handover: ${formatDateTime(handedOverAt)}` : ''}
                      </p>
                      <p className="text-[11px] text-slate-600">
                        Checker: <span className="font-bold text-slate-900">{checkerName || '-'}</span> • Driver: <span className="font-bold text-slate-900">{driverName || '-'}</span>
                      </p>
                      {note && <p className="text-[11px] text-amber-700 font-semibold mt-1">Catatan: {note}</p>}
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                      #{id || '-'}
                    </span>
                  </div>

                  {evidenceUrl && (
                    <div className="pt-1">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Bukti Checker</p>
                      <Image
                        src={evidenceUrl}
                        alt="Bukti checker gudang"
                        width={960}
                        height={540}
                        className="w-full max-h-64 object-contain rounded-lg bg-white border border-slate-200"
                      />
                    </div>
                  )}

                  {itemEvidences.length > 0 && (
                    <div className="pt-1">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Bukti Item ({itemEvidences.length})</p>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {itemEvidences.map((it) => (
                          <div key={it.id || String(it.evidenceUrl)} className="rounded-xl border border-slate-200 bg-white p-2">
                            <p className="text-[10px] font-bold text-slate-700 truncate">
                              {it.productName || 'Item'}
                            </p>
                            {it.evidenceUrl ? (
                              <Image
                                src={it.evidenceUrl}
                                alt="Bukti item checker"
                                width={640}
                                height={360}
                                className="mt-1 w-full max-h-32 object-contain rounded-lg bg-slate-50 border border-slate-100"
                              />
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {deliveryRetursRaw.length > 0 && (
        <div className="rounded-[24px] border border-rose-200 bg-rose-50/60 p-5 space-y-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-700">Retur Saat Pengiriman</p>
            <p className="text-xs font-bold text-slate-700 mt-1">
              Ada retur item pada invoice ini.
            </p>
          </div>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {(deliveryRetursRaw as unknown[]).map((raw) => {
              const r = asRecord(raw);
              const product = asRecord(r.Product);
              const returType = String(r.retur_type || '');
              const returTypeLabel = returType === 'delivery_damage' ? 'Barang rusak' : 'Tidak jadi beli';
              return (
                <div key={String(r.id || Math.random())} className="rounded-2xl border border-rose-200/60 bg-white px-4 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-black text-slate-900 truncate">{String(product.name || 'Produk')}</p>
                    <p className="text-[10px] text-slate-500 truncate">
                      {returTypeLabel} · Status {String(r.status || '-')} · {String(r.reason || '').trim() ? String(r.reason) : '-'}
                    </p>
                  </div>
                  <span className="text-xs font-black text-rose-700">Qty {Number(r.qty || 0)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {statusTimeline.length > 0 && (
        <div className="rounded-[24px] border border-slate-200 bg-white p-5 space-y-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Timeline Perubahan Status</p>
            <p className="text-xs font-bold text-slate-700 mt-1">
              Riwayat event pesanan (gabungan dari semua order dalam invoice).
            </p>
          </div>
          <div className="max-h-96 overflow-y-auto space-y-2">
            {statusTimeline.map((evt) => {
              const statusDelta = evt.beforeStatus && evt.afterStatus
                ? `${evt.beforeStatus} → ${evt.afterStatus}`
                : null;
              return (
                <div key={evt.key} className="rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-black text-slate-900 truncate">
                        {evt.label}{statusDelta ? ` • ${statusDelta}` : ''}
                      </p>
                      <p className="text-[11px] text-slate-600">
                        {evt.occurredAt ? formatDateTime(evt.occurredAt) : '-'} • Order #{evt.orderId ? evt.orderId.slice(-8).toUpperCase() : '-'}
                      </p>
                      {(evt.actorRole || evt.reason) && (
                        <p className="text-[11px] text-slate-500">
                          {evt.actorRole ? `Role: ${evt.actorRole}` : ''}
                          {evt.actorRole && evt.reason ? ' • ' : ''}
                          {evt.reason ? `Reason: ${evt.reason}` : ''}
                        </p>
                      )}
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      {String(evt.eventType || '').replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

