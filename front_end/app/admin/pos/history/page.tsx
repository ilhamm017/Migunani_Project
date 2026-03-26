'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency, formatDateTime } from '@/lib/utils';

type SaleRow = any;

const safeStr = (v: unknown) => String(v ?? '').trim();
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export default function AdminPosHistoryPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir']);
  const router = useRouter();

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [q, setQ] = useState('');
  const [startDate, setStartDate] = useState<string>(today);
  const [endDate, setEndDate] = useState<string>(today);
  const [status, setStatus] = useState<'all' | 'paid' | 'voided'>('all');

  const [page, setPage] = useState(1);
  const limit = 20;

  const [rows, setRows] = useState<SaleRow[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const totalPages = useMemo(() => Math.max(1, Math.ceil(Math.max(0, count) / limit)), [count]);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    try {
      if (!options?.silent) setLoading(true);
      setError('');
      const res = await api.admin.pos.listSales({
        page,
        limit,
        q: q.trim() || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        status: status === 'all' ? undefined : status,
      });
      const payload = res.data || {};
      setRows(Array.isArray(payload.rows) ? payload.rows : []);
      setCount(Number(payload.count || payload.total || 0) || 0);
    } catch (e: unknown) {
      const message = typeof e === 'object' && e && 'response' in e
        ? String((e as any).response?.data?.message || '')
        : '';
      setError(message || 'Gagal memuat riwayat POS.');
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [endDate, limit, page, q, startDate, status]);

  useEffect(() => {
    if (!allowed) return;
    const handle = window.setTimeout(() => {
      void load();
    }, 250);
    return () => window.clearTimeout(handle);
  }, [allowed, load]);

  useEffect(() => {
    setPage(1);
  }, [q, startDate, endDate, status]);

  const canPrev = page > 1;
  const canNext = page < totalPages;

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/pos" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
            <ArrowLeft size={16} />
            Kembali
          </Link>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">POS</p>
            <h1 className="text-xl font-black text-slate-900">Riwayat</h1>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-700 disabled:opacity-60"
        >
          {loading ? '...' : 'Refresh'}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
          <div className="lg:col-span-2">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Cari (No Struk / Nama)</label>
            <div className="mt-1 relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Ketik..."
                className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase">Dari</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase">Sampai</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[10px] font-bold text-slate-500 uppercase">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="all">Semua</option>
            <option value="paid">Paid</option>
            <option value="voided">Voided</option>
          </select>
          <div className="ml-auto text-xs text-slate-500">
            Total: <span className="font-black text-slate-700">{count}</span>
          </div>
        </div>

        {error ? <p className="text-sm text-rose-700 whitespace-pre-wrap">{error}</p> : null}

        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">{loading ? 'Memuat...' : 'Belum ada transaksi.'}</p>
        ) : (
          <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 overflow-hidden">
            {rows.map((s: any, idx: number) => {
              const id = safeStr(s?.id);
              const receipt = safeStr(s?.receipt_number) || '-';
              const paidAt = safeStr(s?.paid_at || s?.paidAt || s?.createdAt);
              const rowStatus = safeStr(s?.status);
              const total = n(s?.total);
              const customer = safeStr(s?.customer_name);
              const note = safeStr(s?.note);

              return (
                <button
                  key={id || `${receipt}:${idx}`}
                  type="button"
                  onClick={() => router.push(`/admin/pos/${encodeURIComponent(id)}`)}
                  className="w-full text-left px-4 py-3 hover:bg-slate-50"
                  disabled={!id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-900 truncate">{receipt}</p>
                      <p className="text-[11px] text-slate-500">
                        {paidAt ? formatDateTime(paidAt) : '-'}
                        {rowStatus ? ` • ${rowStatus}` : ''}
                        {customer ? ` • ${customer}` : ''}
                      </p>
                      {note ? <p className="mt-1 text-[11px] text-slate-400 truncate">{note}</p> : null}
                    </div>
                    <div className="text-sm font-black text-slate-900">{formatCurrency(total)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-2">
          <div className="text-xs text-slate-500">
            Halaman <span className="font-black text-slate-700">{page}</span> / {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={!canPrev || loading}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase tracking-wide text-slate-700 disabled:opacity-60"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={!canNext || loading}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase tracking-wide text-slate-700 disabled:opacity-60"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

