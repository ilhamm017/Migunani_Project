'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Filter, Receipt, RefreshCw, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';

type InvoiceRow = {
  id: string;
  invoice_number: string;
  payment_status: string;
  payment_method: string;
  payment_proof_url?: string | null;
  amount_paid?: number | null;
  total: number;
  collectible_total?: number | null;
  shipment_status?: string | null;
  verified_at?: string | null;
  expiry_date?: string | null;
  createdAt?: string | null;
  orderIds?: string[];
  delivery_return_summary?: { net_total?: number | null; return_total?: number | null } | null;
};

type ApiResponse = {
  total: number;
  totalPages: number;
  currentPage: number;
  limit: number;
  invoices: InvoiceRow[];
};

const parseCsv = (raw: string | null) =>
  String(raw || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

const uniqCsv = (values: string[]) => Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));

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
  if (status === 'cod_pending') return 'COD Pending';
  if (status === 'paid') return 'Lunas';
  return status || '-';
};

const shipmentStatusLabel = (status?: string) => {
  if (status === 'ready_to_ship') return 'Siap Dikirim';
  if (status === 'shipped') return 'Dikirim';
  if (status === 'delivered') return 'Terkirim';
  if (status === 'canceled') return 'Dibatalkan';
  return status || '-';
};

const isCompletedFromRow = (row: InvoiceRow) => {
  const status = String(row.payment_status || '');
  if (status === 'paid') return true;
  if (status === 'cod_pending') {
    const amountPaid = Number(row.amount_paid || 0);
    return Number.isFinite(amountPaid) && amountPaid > 0;
  }
  return false;
};

const defaultFilters = {
  q: '',
  stage: 'all' as 'all' | 'active' | 'completed',
  sort: 'createdAt_desc',
  page: 1,
  limit: 20,
  orderId: '',
  hasProof: '' as '' | 'true' | 'false',
  verified: '' as '' | 'true' | 'false',
  paymentStatus: [] as string[],
  paymentMethod: [] as string[],
  shipmentStatus: [] as string[],
  createdFrom: '',
  createdTo: '',
  expiryFrom: '',
  expiryTo: '',
  minTotal: '',
  maxTotal: '',
};

export default function CustomerAllInvoicesPage() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const router = useRouter();
  const searchParams = useSearchParams();

  const initial = useMemo(() => {
    const q = String(searchParams.get('q') || '').trim();
    const stage = (String(searchParams.get('stage') || 'all').trim().toLowerCase() as any) || 'all';
    const sort = String(searchParams.get('sort') || 'createdAt_desc').trim() || 'createdAt_desc';
    const page = Math.max(1, Number(searchParams.get('page') || 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 20) || 20));
    const orderId = String(searchParams.get('order_id') || '').trim();
    const hasProof = (String(searchParams.get('has_proof') || '').trim() as any) || '';
    const verified = (String(searchParams.get('verified') || '').trim() as any) || '';
    const paymentStatus = parseCsv(searchParams.get('payment_status'));
    const paymentMethod = parseCsv(searchParams.get('payment_method'));
    const shipmentStatus = parseCsv(searchParams.get('shipment_status'));
    const createdFrom = String(searchParams.get('created_from') || '').trim();
    const createdTo = String(searchParams.get('created_to') || '').trim();
    const expiryFrom = String(searchParams.get('expiry_from') || '').trim();
    const expiryTo = String(searchParams.get('expiry_to') || '').trim();
    const minTotal = String(searchParams.get('min_total') || '').trim();
    const maxTotal = String(searchParams.get('max_total') || '').trim();

    return {
      ...defaultFilters,
      q,
      stage: stage === 'active' || stage === 'completed' || stage === 'all' ? stage : 'all',
      sort,
      page,
      limit,
      orderId,
      hasProof: hasProof === 'true' || hasProof === 'false' ? hasProof : '',
      verified: verified === 'true' || verified === 'false' ? verified : '',
      paymentStatus,
      paymentMethod,
      shipmentStatus,
      createdFrom,
      createdTo,
      expiryFrom,
      expiryTo,
      minTotal,
      maxTotal,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [filters, setFilters] = useState(initial);
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState({ total: 0, totalPages: 1, currentPage: 1, limit: initial.limit });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const lastQueryKeyRef = useRef<string>('');

  const queryKey = useMemo(() => JSON.stringify(filters), [filters]);

  const syncUrl = useCallback((next: typeof filters) => {
    const params = new URLSearchParams();
    if (next.q) params.set('q', next.q);
    if (next.stage !== 'all') params.set('stage', next.stage);
    if (next.sort && next.sort !== 'createdAt_desc') params.set('sort', next.sort);
    if (next.page && next.page !== 1) params.set('page', String(next.page));
    if (next.limit && next.limit !== 20) params.set('limit', String(next.limit));
    if (next.orderId) params.set('order_id', next.orderId);
    if (next.hasProof) params.set('has_proof', next.hasProof);
    if (next.verified) params.set('verified', next.verified);
    if (next.paymentStatus.length) params.set('payment_status', uniqCsv(next.paymentStatus).join(','));
    if (next.paymentMethod.length) params.set('payment_method', uniqCsv(next.paymentMethod).join(','));
    if (next.shipmentStatus.length) params.set('shipment_status', uniqCsv(next.shipmentStatus).join(','));
    if (next.createdFrom) params.set('created_from', next.createdFrom);
    if (next.createdTo) params.set('created_to', next.createdTo);
    if (next.expiryFrom) params.set('expiry_from', next.expiryFrom);
    if (next.expiryTo) params.set('expiry_to', next.expiryTo);
    if (next.minTotal) params.set('min_total', next.minTotal);
    if (next.maxTotal) params.set('max_total', next.maxTotal);
    const qs = params.toString();
    router.replace(qs ? `/invoices/all?${qs}` : '/invoices/all');
  }, [router]);

  const load = useCallback(async (opts?: { silent?: boolean; force?: boolean }) => {
    const silent = Boolean(opts?.silent);
    const force = Boolean(opts?.force);
    if (!isAuthenticated) {
      setRows([]);
      if (!silent) setLoading(false);
      return;
    }

    if (!force && lastQueryKeyRef.current === queryKey) return;
    lastQueryKeyRef.current = queryKey;

    try {
      if (!silent) setLoading(true);
      const res = await api.invoices.getMy({
        page: filters.page,
        limit: filters.limit,
        q: filters.q || undefined,
        stage: filters.stage,
        sort: filters.sort,
        order_id: filters.orderId || undefined,
        has_proof: filters.hasProof || undefined,
        verified: filters.verified || undefined,
        payment_status: filters.paymentStatus.length ? uniqCsv(filters.paymentStatus).join(',') : undefined,
        payment_method: filters.paymentMethod.length ? uniqCsv(filters.paymentMethod).join(',') : undefined,
        shipment_status: filters.shipmentStatus.length ? uniqCsv(filters.shipmentStatus).join(',') : undefined,
        created_from: filters.createdFrom || undefined,
        created_to: filters.createdTo || undefined,
        expiry_from: filters.expiryFrom || undefined,
        expiry_to: filters.expiryTo || undefined,
        min_total: filters.minTotal || undefined,
        max_total: filters.maxTotal || undefined,
        include_collectible_total: 'true',
      });

      const data: ApiResponse = (res as any)?.data || ({} as any);
      const invoices = Array.isArray(data?.invoices) ? data.invoices : [];
      setRows(invoices);
      setMeta({
        total: Number(data?.total || 0),
        totalPages: Math.max(1, Number(data?.totalPages || 1)),
        currentPage: Math.max(1, Number(data?.currentPage || filters.page)),
        limit: Math.max(1, Number(data?.limit || filters.limit)),
      });
    } catch (error) {
      console.error('Failed to load all invoices:', error);
      setRows([]);
      setMeta({ total: 0, totalPages: 1, currentPage: 1, limit: filters.limit });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filters, isAuthenticated, queryKey]);

  useEffect(() => {
    syncUrl(filters);
    void load({ force: true });
  }, [filters, load, syncUrl]);

  useRealtimeRefresh({
    enabled: isAuthenticated,
    onRefresh: () => load({ silent: true, force: true }),
    domains: ['order', 'retur', 'admin'],
    pollIntervalMs: 25000,
  });

  const totals = useMemo(() => {
    const completed = rows.filter(isCompletedFromRow);
    const active = rows.filter((r) => !isCompletedFromRow(r));
    const sum = (list: InvoiceRow[]) => list.reduce((acc, r) => acc + Number(r.collectible_total ?? r.total ?? 0), 0);
    return {
      activeCount: active.length,
      completedCount: completed.length,
      activeTotal: sum(active),
      completedTotal: sum(completed),
    };
  }, [rows]);

  const toggleValue = (key: 'paymentStatus' | 'paymentMethod' | 'shipmentStatus', value: string) => {
    setFilters((prev) => {
      const list = new Set(prev[key]);
      if (list.has(value)) list.delete(value);
      else list.add(value);
      return { ...prev, [key]: Array.from(list), page: 1 };
    });
  };

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6">
          <Receipt size={40} className="text-slate-300" />
        </div>
        <h2 className="text-xl font-black text-slate-800 mb-2">Login Diperlukan</h2>
        <p className="text-slate-500 mb-6 max-w-xs">Silakan login untuk melihat seluruh invoice Anda.</p>
        <Link href="/auth/login" className="w-full max-w-xs bg-emerald-600 text-white py-4 rounded-2xl font-black text-sm uppercase tracking-wider shadow-lg shadow-emerald-100">
          Login Sekarang
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white pb-24">
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/invoices" className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
              <ChevronLeft size={18} />
            </Link>
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-widest text-slate-400">Invoice Saya</p>
              <h1 className="text-xl font-black text-slate-900 truncate">Semua Invoice</h1>
            </div>
          </div>
          <button
            onClick={() => load({ force: true })}
            className="shrink-0 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-bold text-slate-600 uppercase">Aktif (di halaman ini)</p>
            <p className="mt-1 text-lg font-black text-rose-700">{formatCurrency(totals.activeTotal)}</p>
            <p className="text-xs text-slate-500">{totals.activeCount} invoice</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[11px] font-bold text-slate-600 uppercase">Selesai (di halaman ini)</p>
            <p className="mt-1 text-lg font-black text-emerald-700">{formatCurrency(totals.completedTotal)}</p>
            <p className="text-xs text-slate-500">{totals.completedCount} invoice</p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-black text-slate-900">Filter & Pencarian</h2>
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              <Filter size={14} />
              {showAdvanced ? 'Sembunyikan' : 'Filter Lengkap'}
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
              <Search size={14} className="text-slate-400" />
              <input
                value={filters.q}
                onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value, page: 1 }))}
                placeholder="Cari invoice number / invoice id"
                className="w-full text-xs font-semibold text-slate-700 outline-none"
              />
            </div>

            <select
              value={filters.stage}
              onChange={(e) => setFilters((p) => ({ ...p, stage: e.target.value as any, page: 1 }))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700"
            >
              <option value="all">Semua Stage</option>
              <option value="active">Aktif</option>
              <option value="completed">Selesai</option>
            </select>

            <select
              value={filters.sort}
              onChange={(e) => setFilters((p) => ({ ...p, sort: e.target.value, page: 1 }))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700"
            >
              <option value="createdAt_desc">Terbaru</option>
              <option value="createdAt_asc">Terlama</option>
              <option value="total_desc">Total Terbesar</option>
              <option value="total_asc">Total Terkecil</option>
              <option value="expiry_asc">Expiry Terdekat</option>
              <option value="expiry_desc">Expiry Terjauh</option>
            </select>

            <select
              value={filters.limit}
              onChange={(e) => setFilters((p) => ({ ...p, limit: Number(e.target.value) || 20, page: 1 }))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700"
            >
              <option value={10}>10 / halaman</option>
              <option value={20}>20 / halaman</option>
              <option value={50}>50 / halaman</option>
            </select>

            <button
              onClick={() => setFilters(defaultFilters)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              Reset
            </button>
          </div>

          {showAdvanced && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Payment Method</p>
                  <div className="flex flex-wrap gap-2">
                    {['pending', 'transfer_manual', 'cod', 'cash_store'].map((v) => (
                      <button
                        key={v}
                        onClick={() => toggleValue('paymentMethod', v)}
                        className={`rounded-xl border px-3 py-2 text-xs font-bold ${
                          filters.paymentMethod.includes(v)
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {paymentMethodLabel(v)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Payment Status</p>
                  <div className="flex flex-wrap gap-2">
                    {['draft', 'unpaid', 'cod_pending', 'paid'].map((v) => (
                      <button
                        key={v}
                        onClick={() => toggleValue('paymentStatus', v)}
                        className={`rounded-xl border px-3 py-2 text-xs font-bold ${
                          filters.paymentStatus.includes(v)
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {paymentStatusLabel(v)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Shipment Status</p>
                  <div className="flex flex-wrap gap-2">
                    {['ready_to_ship', 'shipped', 'delivered', 'canceled'].map((v) => (
                      <button
                        key={v}
                        onClick={() => toggleValue('shipmentStatus', v)}
                        className={`rounded-xl border px-3 py-2 text-xs font-bold ${
                          filters.shipmentStatus.includes(v)
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {shipmentStatusLabel(v)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Bukti & Verifikasi</p>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={filters.hasProof}
                      onChange={(e) => setFilters((p) => ({ ...p, hasProof: e.target.value as any, page: 1 }))}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                    >
                      <option value="">Bukti: Semua</option>
                      <option value="true">Bukti: Ada</option>
                      <option value="false">Bukti: Tidak ada</option>
                    </select>
                    <select
                      value={filters.verified}
                      onChange={(e) => setFilters((p) => ({ ...p, verified: e.target.value as any, page: 1 }))}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                    >
                      <option value="">Verifikasi: Semua</option>
                      <option value="true">Terverifikasi</option>
                      <option value="false">Belum verifikasi</option>
                    </select>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Tanggal (Created)</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={filters.createdFrom}
                      onChange={(e) => setFilters((p) => ({ ...p, createdFrom: e.target.value, page: 1 }))}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                    />
                    <input
                      type="date"
                      value={filters.createdTo}
                      onChange={(e) => setFilters((p) => ({ ...p, createdTo: e.target.value, page: 1 }))}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Order / Total</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={filters.orderId}
                      onChange={(e) => setFilters((p) => ({ ...p, orderId: e.target.value, page: 1 }))}
                      placeholder="Order ID (opsional)"
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        inputMode="numeric"
                        value={filters.minTotal}
                        onChange={(e) => setFilters((p) => ({ ...p, minTotal: e.target.value, page: 1 }))}
                        placeholder="Min total"
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                      />
                      <input
                        inputMode="numeric"
                        value={filters.maxTotal}
                        onChange={(e) => setFilters((p) => ({ ...p, maxTotal: e.target.value, page: 1 }))}
                        placeholder="Max total"
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Expiry (opsional)</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <input
                    type="date"
                    value={filters.expiryFrom}
                    onChange={(e) => setFilters((p) => ({ ...p, expiryFrom: e.target.value, page: 1 }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                  />
                  <input
                    type="date"
                    value={filters.expiryTo}
                    onChange={(e) => setFilters((p) => ({ ...p, expiryTo: e.target.value, page: 1 }))}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                  />
                  <div className="text-xs text-slate-500 flex items-center col-span-2">
                    Filter expiry berguna untuk invoice yang punya batas waktu pembayaran.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-black text-slate-900">Hasil</p>
              <p className="text-xs text-slate-500">
                Total {meta.total} invoice • Halaman {meta.currentPage} / {meta.totalPages}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setFilters((p) => ({ ...p, page: Math.max(1, p.page - 1) }))}
                disabled={filters.page <= 1 || loading}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"
              >
                Prev
              </button>
              <button
                onClick={() => setFilters((p) => ({ ...p, page: Math.min(meta.totalPages, p.page + 1) }))}
                disabled={filters.page >= meta.totalPages || loading}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>

          {loading && <p className="text-sm text-slate-500">Memuat invoice...</p>}
          {!loading && rows.length === 0 && <div className="text-sm text-slate-500">Tidak ada invoice untuk filter ini.</div>}

          {!loading && rows.length > 0 && (
            <div className="space-y-2">
              {rows.map((row) => {
                const done = isCompletedFromRow(row);
                const displayTotal = Number(row.collectible_total ?? row.total ?? 0);
                return (
                  <Link
                    key={row.id}
                    href={`/invoices/${row.id}`}
                    className="block border border-slate-200 rounded-2xl p-4 bg-slate-50 hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">{row.invoice_number}</p>
                        <p className="text-xs text-slate-600 truncate">
                          Order: {(row.orderIds || []).length ? (row.orderIds || []).join(', ') : '-'}
                        </p>
                        <p className="text-[10px] text-slate-500">
                          {paymentMethodLabel(row.payment_method)} • {row.createdAt ? formatDateTime(String(row.createdAt)) : '-'}
                        </p>
                        <p className="mt-1 text-[10px] text-slate-500">
                          Pembayaran: {paymentStatusLabel(row.payment_status)} • Pengiriman: {shipmentStatusLabel(String(row.shipment_status || ''))}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[11px] text-slate-500">Total</p>
                        <p className={`text-sm font-black ${done ? 'text-emerald-700' : 'text-rose-700'}`}>{formatCurrency(displayTotal)}</p>
                      </div>
                    </div>

                    <div className={`mt-3 rounded-xl border px-3 py-2 ${done ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[10px] font-black uppercase tracking-[0.22em]">{done ? 'Selesai' : 'Aktif'}</p>
                        <p className="text-[10px] font-bold">
                          {row.verified_at ? 'Terverifikasi' : 'Belum Verifikasi'} • {row.payment_proof_url ? 'Ada Bukti' : 'Tanpa Bukti'}
                        </p>
                      </div>
                      {row.expiry_date && (
                        <p className="mt-1 text-[11px] font-medium">
                          Expiry: {formatDateTime(String(row.expiry_date))}
                        </p>
                      )}
                      {row.delivery_return_summary?.return_total && Number(row.delivery_return_summary.return_total || 0) > 0 && (
                        <p className="mt-1 text-[11px] font-medium">
                          Ada retur pengiriman: {formatCurrency(Number(row.delivery_return_summary.return_total || 0))}
                        </p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

