'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { RefreshCw, ChevronDown, ChevronUp, Wallet, PackageCheck } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

type DriverOption = { id: string; name: string; whatsapp_number?: string | null };

type HistoryCodInvoiceRow = {
  invoice_id: string;
  invoice_number: string;
  customer: { id: string; name: string } | null;
};

type HistoryCodSettlementRow = {
  id: number;
  settled_at: string | null;
  driver: DriverOption | null;
  receiver: { id: string; name: string; whatsapp_number?: string | null } | null;
  total_expected: number;
  amount_received: number;
  diff_amount: number;
  driver_debt_before: number;
  driver_debt_after: number;
  invoices: HistoryCodInvoiceRow[];
};

type HistoryHandoverItemRow = {
  retur_id: string;
  qty: number;
  qty_received: number | null;
  product: { id: string; name: string; sku: string; unit: string } | null;
};

type HistoryReturHandoverRow = {
  id: number;
  invoice_id: string;
  status: 'submitted' | 'received' | string;
  submitted_at: string | null;
  received_at: string | null;
  driver: DriverOption | null;
  receiver: { id: string; name: string; whatsapp_number?: string | null } | null;
  note: string | null;
  driver_debt_before: number;
  driver_debt_after: number;
  items: HistoryHandoverItemRow[];
};

const formatRp = (value: number) => new Intl.NumberFormat('id-ID').format(Number(value || 0));

const formatDateTime = (iso: string | null) => {
  if (!iso) return '-';
  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return '-';
  return dt.toLocaleString('id-ID');
};

const toIsoStart = (yyyyMmDd: string) => new Date(`${yyyyMmDd}T00:00:00`).toISOString();
const toIsoEnd = (yyyyMmDd: string) => new Date(`${yyyyMmDd}T23:59:59.999`).toISOString();

export default function AdminRiwayatSetoranDriverPage() {
  const allowed = useRequireRoles(['kasir', 'super_admin'], '/admin');
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [driverId, setDriverId] = useState<string>('');

  const today = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => {
    const d = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }, [today]);
  const defaultTo = useMemo(() => {
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }, [today]);

  const [fromDate, setFromDate] = useState<string>(defaultFrom);
  const [toDate, setToDate] = useState<string>(defaultTo);
  const [includeUnreceived, setIncludeUnreceived] = useState(true);

  const [activeTab, setActiveTab] = useState<'cod' | 'retur'>('cod');
  const [codRows, setCodRows] = useState<HistoryCodSettlementRow[]>([]);
  const [handoverRows, setHandoverRows] = useState<HistoryReturHandoverRow[]>([]);

  const [expandedCod, setExpandedCod] = useState<Record<string, boolean>>({});
  const [expandedHandover, setExpandedHandover] = useState<Record<string, boolean>>({});

  const bumpLastSeenFromHistoryData = useCallback((data: any) => {
    try {
      const userId = String(user?.id || '').trim();
      if (!userId) return;

      const storageKey = `migunani:last_seen:driver_deposit_history:${userId}`;
      const parseIsoMs = (iso: string) => {
        const ms = Date.parse(iso);
        return Number.isFinite(ms) ? ms : 0;
      };

      const latestCodIso = Array.isArray(data?.cod_settlements) && data.cod_settlements[0]?.settled_at
        ? String(data.cod_settlements[0].settled_at)
        : '';
      const latestHandoverIso = Array.isArray(data?.retur_handovers)
        ? String(data.retur_handovers[0]?.received_at || data.retur_handovers[0]?.submitted_at || '')
        : '';

      const latestCodMs = latestCodIso ? parseIsoMs(latestCodIso) : 0;
      const latestHandoverMs = latestHandoverIso ? parseIsoMs(latestHandoverIso) : 0;
      const latestMs = Math.max(latestCodMs, latestHandoverMs);
      if (!Number.isFinite(latestMs) || latestMs <= 0) return;

      const prev = window?.localStorage?.getItem(storageKey);
      const prevMs = prev ? parseIsoMs(prev) : 0;
      if (latestMs <= prevMs) return;

      const latestIso = latestMs === latestCodMs ? latestCodIso : latestHandoverIso;
      if (!latestIso) return;
      window?.localStorage?.setItem(storageKey, latestIso);
    } catch { }
  }, [user?.id]);

  const loadDrivers = useCallback(async () => {
    try {
      const res = await api.admin.driverDeposit.getList();
      const list = Array.isArray(res.data) ? (res.data as any[]) : [];
      const opts: DriverOption[] = list
        .map((row) => row?.driver)
        .filter(Boolean)
        .map((d) => ({
          id: String(d.id || ''),
          name: String(d.name || 'Driver'),
          whatsapp_number: d.whatsapp_number ? String(d.whatsapp_number) : null,
        }))
        .filter((d) => d.id);
      // unique by id
      const map = new Map<string, DriverOption>();
      opts.forEach((d) => { if (!map.has(d.id)) map.set(d.id, d); });
      setDrivers(Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err: any) {
      const message = String(err?.response?.data?.message || err?.message || 'Gagal memuat driver.');
      setErrorMsg(message);
      setDrivers([]);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const params = {
        driver_id: driverId || undefined,
        from: fromDate ? toIsoStart(fromDate) : undefined,
        to: toDate ? toIsoEnd(toDate) : undefined,
        include_status: includeUnreceived ? 'all' : 'received',
        limit: 100,
        offset: 0,
      } as const;
      const res = await api.admin.driverDeposit.getHistory(params);
      const data = (res.data || {}) as any;
      setCodRows(Array.isArray(data.cod_settlements) ? (data.cod_settlements as HistoryCodSettlementRow[]) : []);
      setHandoverRows(Array.isArray(data.retur_handovers) ? (data.retur_handovers as HistoryReturHandoverRow[]) : []);
      setExpandedCod({});
      setExpandedHandover({});
      bumpLastSeenFromHistoryData(data);
    } catch (err: any) {
      const message = String(err?.response?.data?.message || err?.message || 'Gagal memuat riwayat.');
      setErrorMsg(message);
      setCodRows([]);
      setHandoverRows([]);
    } finally {
      setLoading(false);
    }
  }, [bumpLastSeenFromHistoryData, driverId, fromDate, toDate, includeUnreceived]);

  useEffect(() => {
    if (!allowed) return;
    void loadDrivers();
  }, [allowed, loadDrivers]);

  useEffect(() => {
    if (!allowed) return;
    void loadHistory();
  }, [allowed, loadHistory]);

  useEffect(() => {
    if (!allowed) return;
    void (async () => {
      try {
        const res = await api.admin.driverDeposit.getHistory({
          from: '2000-01-01T00:00:00.000Z',
          to: new Date().toISOString(),
          include_status: 'all',
          limit: 1,
          offset: 0,
        });
        bumpLastSeenFromHistoryData((res as any)?.data || {});
      } catch { }
    })();
  }, [allowed, bumpLastSeenFromHistoryData]);

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Riwayat Setoran Driver</h1>
          <p className="text-xs text-slate-500 mt-1">Lacak penyerahan uang COD & barang retur (handover) beserta snapshot hutang driver.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadHistory()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase text-slate-700 disabled:opacity-60"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {errorMsg && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">
          {errorMsg}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Driver (Opsional)</label>
            <select
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900"
            >
              <option value="">Semua driver</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Dari</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900"
            />
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Sampai</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900"
            />
          </div>
        </div>

        <label className="flex items-center gap-3 text-sm font-bold text-slate-700">
          <input
            type="checkbox"
            checked={includeUnreceived}
            onChange={(e) => setIncludeUnreceived(e.target.checked)}
          />
          Tampilkan handover yang belum diterima (submitted)
        </label>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setActiveTab('cod')}
            className={`rounded-2xl border px-4 py-3 text-left transition ${activeTab === 'cod' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50'}`}
          >
            <div className="flex items-center gap-2">
              <Wallet size={16} className={activeTab === 'cod' ? 'text-white' : 'text-amber-700'} />
              <span className="text-xs font-black uppercase">Riwayat COD</span>
            </div>
            <p className={`text-[11px] mt-1 ${activeTab === 'cod' ? 'text-white/70' : 'text-slate-500'}`}>{codRows.length} settlement</p>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('retur')}
            className={`rounded-2xl border px-4 py-3 text-left transition ${activeTab === 'retur' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50'}`}
          >
            <div className="flex items-center gap-2">
              <PackageCheck size={16} className={activeTab === 'retur' ? 'text-white' : 'text-violet-700'} />
              <span className="text-xs font-black uppercase">Riwayat Retur</span>
            </div>
            <p className={`text-[11px] mt-1 ${activeTab === 'retur' ? 'text-white/70' : 'text-slate-500'}`}>{handoverRows.length} handover</p>
          </button>
        </div>
      </div>

      {loading && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm font-bold text-slate-600">
          Memuat riwayat...
        </div>
      )}

      {!loading && activeTab === 'cod' && (
        <div className="space-y-2">
          {codRows.length === 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm font-bold text-slate-600">
              Tidak ada riwayat COD pada rentang tanggal ini.
            </div>
          )}
          {codRows.map((row) => {
            const key = String(row.id);
            const expanded = Boolean(expandedCod[key]);
            const diff = Number(row.diff_amount || 0);
            return (
              <div key={row.id} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900">Settlement #{row.id}</p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      {formatDateTime(row.settled_at)} · Driver: <span className="font-black">{row.driver?.name || '-'}</span> · Kasir: <span className="font-black">{row.receiver?.name || '-'}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedCod((prev) => ({ ...prev, [key]: !expanded }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase text-slate-700 inline-flex items-center gap-2"
                  >
                    Detail {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Expected</p>
                    <p className="text-sm font-black text-slate-900">{formatRp(Number(row.total_expected || 0))}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Received</p>
                    <p className="text-sm font-black text-slate-900">{formatRp(Number(row.amount_received || 0))}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Diff</p>
                    <p className={`text-sm font-black ${diff === 0 ? 'text-slate-900' : (diff < 0 ? 'text-rose-700' : 'text-emerald-700')}`}>
                      {formatRp(diff)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Debt Snapshot</p>
                    <p className="text-sm font-black text-slate-900">{formatRp(Number(row.driver_debt_before || 0))} → {formatRp(Number(row.driver_debt_after || 0))}</p>
                  </div>
                </div>

                {expanded && (
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Invoice Disettle</p>
                    {row.invoices.length === 0 && (
                      <p className="text-xs font-bold text-slate-600">Tidak ada invoice terhubung untuk settlement ini.</p>
                    )}
                    {row.invoices.map((inv) => (
                      <div key={inv.invoice_id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                        <p className="text-xs font-black text-slate-900">{inv.invoice_number || String(inv.invoice_id).slice(-8).toUpperCase()}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          Customer: <span className="font-black">{inv.customer?.name || '-'}</span>
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!loading && activeTab === 'retur' && (
        <div className="space-y-2">
          {handoverRows.length === 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm font-bold text-slate-600">
              Tidak ada riwayat handover retur pada rentang tanggal ini.
            </div>
          )}
          {handoverRows.map((row) => {
            const key = String(row.id);
            const expanded = Boolean(expandedHandover[key]);
            return (
              <div key={row.id} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-black text-slate-900">Handover #{row.id}</p>
                      <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-full ${row.status === 'received' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {row.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Invoice: {String(row.invoice_id || '').slice(-8).toUpperCase()} · Driver: <span className="font-black">{row.driver?.name || '-'}</span> · Kasir: <span className="font-black">{row.receiver?.name || '-'}</span>
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Submitted: <span className="font-black">{formatDateTime(row.submitted_at)}</span> · Received: <span className="font-black">{formatDateTime(row.received_at)}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedHandover((prev) => ({ ...prev, [key]: !expanded }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase text-slate-700 inline-flex items-center gap-2"
                  >
                    Detail {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>

                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Debt Snapshot</p>
                  <p className="text-sm font-black text-slate-900">{formatRp(Number(row.driver_debt_before || 0))} → {formatRp(Number(row.driver_debt_after || 0))}</p>
                  {row.note ? <p className="text-[11px] text-slate-600 mt-1">Catatan: {row.note}</p> : null}
                </div>

                {expanded && (
                  <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Items</p>
                    {row.items.length === 0 && (
                      <p className="text-xs font-bold text-slate-600">Tidak ada item retur.</p>
                    )}
                    {row.items.map((it) => (
                      <div key={it.retur_id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                        <p className="text-xs font-black text-slate-900">{it.product?.name || 'Produk'}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          SKU: {it.product?.sku || '-'} · Retur: {String(it.retur_id).slice(-8).toUpperCase()}
                        </p>
                        <p className="text-[10px] text-slate-600 mt-1">
                          Qty klaim: <span className="font-black">{it.qty}</span> {it.product?.unit || ''} · Qty diterima: <span className="font-black">{it.qty_received ?? '-'}</span>
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
