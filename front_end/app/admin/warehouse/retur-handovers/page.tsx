'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatDateTime } from '@/lib/utils';
import { PackageCheck, RefreshCw, Warehouse, User } from 'lucide-react';

type HandoverProduct = {
  id?: string;
  name?: string;
  sku?: string;
  unit?: string;
};

type HandoverRetur = {
  id: string;
  qty: number;
  qty_received?: number | null;
  status: string;
  Product?: HandoverProduct | null;
};

type HandoverItem = {
  id: number;
  retur_id: string;
  Retur?: HandoverRetur | null;
};

type HandoverUser = {
  id: string;
  name?: string;
  whatsapp_number?: string;
};

type ReturHandoverRow = {
  id: number;
  invoice_id: string;
  driver_id: string;
  status: 'submitted' | 'received';
  submitted_at?: string | null;
  received_at?: string | null;
  received_by?: string | null;
  note?: string | null;
  Driver?: HandoverUser | null;
  Receiver?: HandoverUser | null;
  Items?: HandoverItem[] | null;
};

type ApiErrorWithMessage = {
  response?: { data?: { message?: string } };
};

export default function WarehouseReturHandoversPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir', 'admin_gudang'], '/admin');
  const [loading, setLoading] = useState(true);
  const [handovers, setHandovers] = useState<ReturHandoverRow[]>([]);
  const [draftQty, setDraftQty] = useState<Record<string, Record<string, string>>>({});
  const [draftNote, setDraftNote] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    try {
      if (!silent) setLoading(true);
      const res = await api.retur.getHandovers({ status: 'submitted' });
      const rows = Array.isArray(res.data) ? (res.data as ReturHandoverRow[]) : [];
      setHandovers(rows);
    } catch (error) {
      console.error('Failed to load retur handovers:', error);
      if (!silent) setHandovers([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void load();
  }, [allowed, load]);

  useEffect(() => {
    if (!allowed) return;
    setDraftQty((prev) => {
      const next = { ...prev };
      handovers.forEach((handover) => {
        const key = String(handover.id);
        if (next[key]) return;
        const items = Array.isArray(handover.Items) ? handover.Items : [];
        const itemDraft: Record<string, string> = {};
        items.forEach((it) => {
          const retur = it.Retur;
          const qty = Math.max(0, Math.trunc(Number(retur?.qty || 0)));
          itemDraft[String(it.retur_id)] = String(qty);
        });
        next[key] = itemDraft;
      });
      return next;
    });
  }, [allowed, handovers]);

  const pendingCount = handovers.length;

  const handleReceive = async (handover: ReturHandoverRow) => {
    const idKey = String(handover.id);
    const items = Array.isArray(handover.Items) ? handover.Items : [];
    if (items.length === 0) {
      alert('Handover tidak memiliki item retur.');
      return;
    }

    const qtyDraft = draftQty[idKey] || {};
    const payloadItems = items.map((it) => {
      const returId = String(it.retur_id);
      const claimed = Math.max(0, Math.trunc(Number(it.Retur?.qty || 0)));
      const received = Math.trunc(Number(qtyDraft[returId] ?? claimed));
      return { retur_id: returId, qty_received: received };
    });

    for (const row of payloadItems) {
      const claimed = Math.max(0, Math.trunc(Number(items.find((it) => String(it.retur_id) === String(row.retur_id))?.Retur?.qty || 0)));
      if (!Number.isFinite(row.qty_received) || row.qty_received < 0 || row.qty_received > claimed) {
        alert('Qty received tidak valid. Pastikan 0..qty retur.');
        return;
      }
    }

    try {
      setSubmitting((prev) => ({ ...prev, [idKey]: true }));
      await api.retur.receiveHandover(handover.id, {
        items: payloadItems,
        note: typeof draftNote[idKey] === 'string' ? draftNote[idKey] : undefined,
      });
      alert('Handover diterima. Retur akan berstatus received dan bisa dilanjut completed sesuai kebutuhan stok.');
      await load({ silent: true });
    } catch (error: unknown) {
      const apiError = error as ApiErrorWithMessage;
      alert('Gagal menerima handover: ' + (apiError.response?.data?.message || 'Error unknown'));
    } finally {
      setSubmitting((prev) => ({ ...prev, [idKey]: false }));
    }
  };

  const sortedHandovers = useMemo(() => {
    return [...handovers].sort((a, b) => {
      const bt = Date.parse(String(b.submitted_at || ''));
      const at = Date.parse(String(a.submitted_at || ''));
      return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
    });
  }, [handovers]);

  if (!allowed) return null;

  return (
    <div className="warehouse-page space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-700">Queue Gudang</p>
          <h1 className="text-2xl font-black text-slate-900">Serah-Terima Retur (Per Invoice)</h1>
          <p className="text-xs text-slate-500 mt-1">
            Driver submit handover → gudang/kasir menerima qty → sistem lanjutkan verifikasi retur.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/warehouse/retur"
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase text-slate-700 hover:bg-slate-50"
          >
            <Warehouse size={16} />
            Retur Lama
          </Link>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase text-slate-700 hover:bg-slate-50"
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-700">
          <PackageCheck size={18} className="text-violet-700" />
          <span className="text-xs font-black uppercase tracking-widest text-slate-500">Menunggu Diterima</span>
        </div>
        <span className="text-lg font-black text-slate-900">{pendingCount}</span>
      </div>

      {loading && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm font-bold text-slate-600">
          Memuat data handover...
        </div>
      )}

      {!loading && sortedHandovers.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm font-bold text-slate-600">
          Tidak ada handover retur yang menunggu diterima.
        </div>
      )}

      {!loading && sortedHandovers.length > 0 && (
        <div className="space-y-4">
          {sortedHandovers.map((handover) => {
            const idKey = String(handover.id);
            const items = Array.isArray(handover.Items) ? handover.Items : [];
            const driverName = String(handover.Driver?.name || '-');
            const driverPhone = String(handover.Driver?.whatsapp_number || '');
            const note = String(draftNote[idKey] ?? handover.note ?? '');
            const isBusy = Boolean(submitting[idKey]);
            return (
              <div key={handover.id} className="rounded-[28px] border border-slate-200 bg-white p-5 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-700">Handover #{handover.id}</p>
                    <p className="text-sm font-black text-slate-900 truncate">
                      Invoice: <span className="font-black">{String(handover.invoice_id || '').slice(-8).toUpperCase()}</span>
                    </p>
                    <p className="text-[11px] text-slate-600 mt-1">
                      Submit: <span className="font-bold">{formatDateTime(handover.submitted_at || '')}</span> · Items: <span className="font-bold">{items.length}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <User size={16} className="text-slate-500" />
                    <div className="min-w-0">
                      <p className="text-xs font-black text-slate-900 truncate">{driverName}</p>
                      <p className="text-[10px] text-slate-500 truncate">{driverPhone || '-'}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 space-y-2">
                  {items.map((it) => {
                    const retur = it.Retur;
                    const product = retur?.Product || {};
                    const claimed = Math.max(0, Math.trunc(Number(retur?.qty || 0)));
                    const current = draftQty[idKey]?.[String(it.retur_id)] ?? String(claimed);
                    return (
                      <div key={String(it.retur_id)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-black text-slate-900 truncate">{String(product?.name || 'Produk')}</p>
                          <p className="text-[10px] text-slate-500 truncate">
                            Retur ID: {String(retur?.id || it.retur_id).slice(-8).toUpperCase()} · SKU: {String(product?.sku || '-')}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            Qty klaim driver: <span className="font-black">{claimed}</span> {String(product?.unit || '')}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Qty Diterima</label>
                          <input
                            type="number"
                            min="0"
                            max={claimed}
                            value={current}
                            onChange={(e) => {
                              const val = e.target.value;
                              setDraftQty((prev) => ({
                                ...prev,
                                [idKey]: {
                                  ...(prev[idKey] || {}),
                                  [String(it.retur_id)]: val,
                                },
                              }));
                            }}
                            className="mt-1 w-28 rounded-xl border border-slate-200 px-3 py-2 text-sm font-black text-slate-800"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Catatan Penerimaan (Opsional)</label>
                  <input
                    value={note}
                    onChange={(e) => setDraftNote((prev) => ({ ...prev, [idKey]: e.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-800"
                    placeholder="Contoh: Barang lengkap / ada selisih 1 pcs"
                  />
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => void handleReceive(handover)}
                    disabled={isBusy}
                    className="inline-flex items-center gap-2 rounded-2xl bg-violet-700 px-4 py-3 text-xs font-black uppercase text-white disabled:opacity-60"
                  >
                    <PackageCheck size={16} />
                    {isBusy ? 'Memproses...' : 'Terima Handover'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

