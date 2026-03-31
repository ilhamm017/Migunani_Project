'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { formatCurrency, formatDateTime } from '@/lib/utils';

type SaleRow = {
  id?: string;
  receipt_number?: string | null;
  receipt_no?: string | number;
  status?: string | null;
  total?: number | string | null;
  amount_received?: number | string | null;
  change_amount?: number | string | null;
  paid_at?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
  customer_name?: string | null;
  note?: string | null;
  invoice_id?: string | null;
  invoice_number?: string | null;
  Invoice?: {
    id?: string | null;
    invoice_number?: string | null;
    payment_status?: string | null;
  } | null;
};

const safeStr = (v: unknown) => String(v ?? '').trim();
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const apiErrorMessage = (e: unknown) => {
  if (!e || typeof e !== 'object') return '';
  if (!('response' in e)) return '';
  const response = (e as { response?: unknown }).response;
  if (!response || typeof response !== 'object') return '';
  if (!('data' in response)) return '';
  const data = (response as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return '';
  if (!('message' in data)) return '';
  const message = (data as { message?: unknown }).message;
  return typeof message === 'string' ? message : '';
};

type StatusFilter = 'all' | 'paid' | 'refunded';
type PaymentFilter = 'all' | 'settled' | 'underpay';
const parseStatusFilter = (raw: string): StatusFilter => {
  if (raw === 'paid' || raw === 'refunded') return raw;
  return 'all';
};
const parsePaymentFilter = (raw: string): PaymentFilter => {
  if (raw === 'settled' || raw === 'underpay') return raw;
  return 'all';
};

const toLocalDateInputValue = (d: Date) => {
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export default function AdminPosHistoryPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir']);
  const router = useRouter();

  const btn3dBase = 'btn-3d disabled:opacity-60';
  const btn3dNeutral = `${btn3dBase} bg-white border border-slate-200 text-slate-700 hover:bg-slate-50`;

  const today = useMemo(() => toLocalDateInputValue(new Date()), []);
  const defaultStart = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toLocalDateInputValue(d);
  }, []);

  const [q, setQ] = useState('');
  const [startDate, setStartDate] = useState<string>(defaultStart);
  const [endDate, setEndDate] = useState<string>(today);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [payment, setPayment] = useState<PaymentFilter>('all');

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
        payment: payment === 'all' ? undefined : payment,
      });
      const payload = res.data || {};
      setRows(Array.isArray(payload.rows) ? payload.rows : []);
      setCount(Number(payload.count || payload.total || 0) || 0);
    } catch (e: unknown) {
      setError(apiErrorMessage(e) || 'Gagal memuat riwayat POS.');
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [endDate, limit, page, payment, q, startDate, status]);

  useEffect(() => {
    if (!allowed) return;
    const handle = window.setTimeout(() => {
      void load();
    }, 250);
    return () => window.clearTimeout(handle);
  }, [allowed, load]);

  useEffect(() => {
    setPage(1);
  }, [q, startDate, endDate, status, payment]);

  const canPrev = page > 1;
  const canNext = page < totalPages;

  if (!allowed) return null;

	  return (
	    <div className="p-6 space-y-6">
	      <div className="flex items-center justify-between gap-3">
	        <div className="flex items-center gap-3">
	          <Link
	            href="/admin/pos"
	            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wide ${btn3dNeutral}`}
	          >
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
	          className={`rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wide ${btn3dNeutral}`}
	        >
	          {loading ? '...' : 'Refresh'}
	        </button>
	      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
          <div className="lg:col-span-2">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Cari (No Struk / No Invoice / Nama)</label>
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
            onChange={(e) => setStatus(parseStatusFilter(e.target.value))}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="all">Semua</option>
            <option value="paid">Paid</option>
            <option value="refunded">Refunded</option>
          </select>
          <label className="text-[10px] font-bold text-slate-500 uppercase ml-2">Pembayaran</label>
          <select
            value={payment}
            onChange={(e) => setPayment(parsePaymentFilter(e.target.value))}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            title="Lunas vs Hutang hanya relevan untuk transaksi status paid."
          >
            <option value="all">Semua</option>
            <option value="settled">Lunas</option>
            <option value="underpay">Hutang</option>
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
            {rows.map((s: SaleRow, idx: number) => {
              const id = safeStr(s?.id);
              const receipt = safeStr(s?.receipt_number) || '-';
              const invoiceNumber = safeStr(s?.invoice_number || s?.Invoice?.invoice_number);
              const paidAt = safeStr(s?.paid_at || s?.paidAt || s?.createdAt);
              const rowStatusRaw = safeStr(s?.status).toLowerCase();
              const rowStatus = rowStatusRaw === 'voided' ? 'refunded' : rowStatusRaw;
              const total = n(s?.total);
              const received = n(s?.amount_received);
              const changeAmount = n(s?.change_amount);
              const isUnderpay = changeAmount < 0;
              const due = Math.max(0, Math.round((total - received) * 100) / 100);
              const customer = safeStr(s?.customer_name);
              const note = safeStr(s?.note);
              const badge = rowStatus === 'refunded'
                ? { label: 'REFUND', cls: 'bg-rose-50 text-rose-700 border-rose-200' }
                : isUnderpay
                  ? { label: `HUTANG ${formatCurrency(due)}`, cls: 'bg-rose-50 text-rose-700 border-rose-200' }
                  : { label: 'LUNAS', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };

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
                      <p className="text-sm font-black text-slate-900 truncate">
                        {receipt}
                        {invoiceNumber ? <span className="font-bold text-slate-500"> • {invoiceNumber}</span> : null}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {paidAt ? formatDateTime(paidAt) : '-'}
                        {rowStatus ? ` • ${rowStatus}` : ''}
                        {customer ? ` • ${customer}` : ''}
                      </p>
                      {note ? <p className="mt-1 text-[11px] text-slate-400 truncate">{note}</p> : null}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-black text-slate-900">{formatCurrency(total)}</div>
                      <div className={`mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-black tracking-widest ${badge.cls}`}>
                        {badge.label}
                      </div>
                    </div>
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
	              className={`rounded-xl px-3 py-2 text-xs font-black uppercase tracking-wide ${btn3dNeutral}`}
	            >
	              Prev
	            </button>
	            <button
	              type="button"
	              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
	              disabled={!canNext || loading}
	              className={`rounded-xl px-3 py-2 text-xs font-black uppercase tracking-wide ${btn3dNeutral}`}
	            >
	              Next
	            </button>
	          </div>
	        </div>
	      </div>
    </div>
  );
}
