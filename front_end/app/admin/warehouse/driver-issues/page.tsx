'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock3, ExternalLink, RefreshCw, ShieldCheck, Truck } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';
import Image from 'next/image';
import Link from 'next/link';

type FollowUpFormState = {
  courierId: string;
  resolutionNote: string;
  submitting: boolean;
  feedback: string;
};

type CourierOption = {
  id: string;
  name?: string;
  display_name?: string;
};

type ActiveIssue = {
  evidence_url?: string | null;
  due_at?: string | Date | null;
  note?: string;
  reporter_name?: string;
};

type DriverIssueOrder = {
  id: string;
  createdAt?: string | Date;
  customer_name?: string;
  courier_display_name?: string;
  issue_overdue?: boolean;
  active_issue?: ActiveIssue | null;
  Courier?: { name?: string } | null;
  invoice_id?: string | null;
  invoice_number?: string | null;
  Invoice?: {
    id?: string;
    invoice_number?: string;
    courier_id?: string | null;
  } | null;
};

type ApiErrorWithMessage = {
  response?: { data?: { message?: string } };
};
const PAGE_SIZE = 100;

const toDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const formatRemaining = (dueAt: string | Date | null | undefined): string => {
  const dueDate = toDate(dueAt);
  if (!dueDate) return '-';
  const diffMs = dueDate.getTime() - Date.now();
  const absHours = Math.floor(Math.abs(diffMs) / (1000 * 60 * 60));
  const absMinutes = Math.floor((Math.abs(diffMs) % (1000 * 60 * 60)) / (1000 * 60));
  if (diffMs < 0) return `Terlambat ${absHours}j ${absMinutes}m`;
  return `Sisa ${absHours}j ${absMinutes}m`;
};

const normalizeEvidenceUrl = (raw?: string | null): string | null => {
  if (!raw) return null;
  const val = String(raw).trim();
  if (!val) return null;
  if (val.startsWith('http://') || val.startsWith('https://') || val.startsWith('/uploads/')) return val;
  if (val.startsWith('uploads/')) return `/${val}`;
  const normalized = val.replace(/\\/g, '/');
  const idx = normalized.indexOf('/uploads/');
  if (idx >= 0) return normalized.slice(idx);
  return normalized;
};

export default function WarehouseDriverIssuesPage() {
  const allowed = useRequireRoles(['admin_gudang', 'super_admin', 'checker_gudang'], '/admin');
  const [orders, setOrders] = useState<DriverIssueOrder[]>([]);
  const [couriers, setCouriers] = useState<CourierOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [forms, setForms] = useState<Record<string, FollowUpFormState>>({});

  const loadData = useCallback(async (
    searchValue: string,
    options?: { append?: boolean; page?: number; silent?: boolean }
  ) => {
    const append = options?.append === true;
    const targetPage = options?.page && options.page > 0 ? options.page : 1;
    const silent = options?.silent === true;
    try {
      if (append) {
        setLoadingMore(true);
      } else {
        if (!silent) setLoading(true);
      }

      const ordersPromise = api.admin.orderManagement.getAll({
        status: 'hold',
        page: targetPage,
        limit: PAGE_SIZE,
        search: searchValue || undefined,
      });
      const [ordersRes, couriersRes] = await Promise.all([
        ordersPromise,
        append ? Promise.resolve(null) : api.admin.orderManagement.getCouriers(),
      ]);

      const rows = (ordersRes.data?.orders || []) as DriverIssueOrder[];
      let mergedRows: DriverIssueOrder[] = rows;
      setOrders((prev) => {
        const merged = append ? [...prev, ...rows] : rows;
        const dedupMap = new Map<string, DriverIssueOrder>();
        for (const row of merged) {
          dedupMap.set(String(row?.id || ''), row);
        }
        mergedRows = Array.from(dedupMap.values());
        return mergedRows;
      });
      if (couriersRes) {
        setCouriers(couriersRes.data?.employees || []);
      }
      setCurrentPage(targetPage);
      setHasMore(rows.length >= PAGE_SIZE);

      setForms((prev) => {
        const dedupMap = new Map<string, DriverIssueOrder>();
        for (const row of mergedRows) {
          dedupMap.set(String(row?.id || ''), row);
        }

        const next: Record<string, FollowUpFormState> = {};
        for (const row of dedupMap.values()) {
          const orderId = String(row.id || '');
          const existing = prev[orderId];
          next[orderId] = existing || {
            courierId: '',
            resolutionNote: '',
            submitting: false,
            feedback: '',
          };
        }
        return next;
      });
    } catch (error) {
      console.error('Failed to load driver shortage issues', error);
      if (!append) {
        setOrders([]);
        setHasMore(false);
      }
    } finally {
      if (append) {
        setLoadingMore(false);
      } else {
        if (!silent) setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    const timer = setTimeout(() => {
      void loadData(search.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [allowed, loadData, search]);

  const refreshCurrent = useCallback(() => {
    void loadData(search.trim(), { silent: true });
  }, [loadData, search]);

  const loadMore = useCallback(() => {
    if (loadingMore || loading || !hasMore) return;
    void loadData(search.trim(), { append: true, page: currentPage + 1 });
  }, [currentPage, hasMore, loadData, loading, loadingMore, search]);

  useRealtimeRefresh({
    enabled: allowed,
    onRefresh: refreshCurrent,
    domains: ['order', 'admin'],
    pollIntervalMs: 15000,
  });

  const filteredOrders = useMemo(() => {
    if (!overdueOnly) return orders;
    return orders.filter((order) => Boolean(order.issue_overdue));
  }, [orders, overdueOnly]);

  const summary = useMemo(() => {
    const total = orders.length;
    const overdue = orders.filter((item) => Boolean(item.issue_overdue)).length;
    return { total, overdue };
  }, [orders]);

  if (!allowed) return null;

  const setOrderForm = (orderId: string, patch: Partial<FollowUpFormState>) => {
    setForms((prev) => {
      const current = prev[orderId] || {
        courierId: '',
        resolutionNote: '',
        submitting: false,
        feedback: '',
      };
      return {
        ...prev,
        [orderId]: {
          ...current,
          ...patch,
        },
      };
    });
  };

  const submitFollowUp = async (orderId: string) => {
    const form = forms[orderId];
    if (!form) return;
    if (form.resolutionNote.trim().length < 5) {
      setOrderForm(orderId, { feedback: 'Catatan follow-up minimal 5 karakter.' });
      return;
    }

    try {
      setOrderForm(orderId, { submitting: true, feedback: '' });
      const orderRow = orders.find((row) => String(row?.id || '') === String(orderId)) || null;
      const invoiceId = String(orderRow?.Invoice?.id || orderRow?.invoice_id || '').trim();

      if (invoiceId && form.courierId) {
        await api.invoices.assignDriver(invoiceId, { courier_id: form.courierId });
      }

      await api.admin.orderManagement.updateStatus(orderId, {
        status: 'ready_to_ship',
        courier_id: form.courierId || undefined,
        resolution_note: form.resolutionNote.trim(),
      });

      setOrderForm(orderId, { feedback: 'Follow-up berhasil. Order keluar dari HOLD dan masuk ke Checker untuk dicek ulang.' });
      await loadData(search.trim());
    } catch (error: unknown) {
      const apiError = error as ApiErrorWithMessage;
      const safeMessage = apiError?.response?.data?.message || 'Gagal submit follow-up.';
      setOrderForm(orderId, { feedback: safeMessage });
    } finally {
      setOrderForm(orderId, { submitting: false });
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900">Laporan HOLD: Barang Kurang / Mismatch</h1>
          <p className="text-sm text-slate-600 mt-1">Follow-up wajib dalam 1x24 jam. Setelah dibereskan, kembalikan order ke Checker untuk dicek ulang.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadData(search.trim())}
          className="px-3 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 text-xs font-bold inline-flex items-center gap-1"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4">
          <p className="text-xs text-violet-700">Order Hold Aktif</p>
          <p className="text-2xl font-black text-violet-700 mt-1">{summary.total}</p>
        </div>
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4">
          <p className="text-xs text-rose-700">Melewati SLA</p>
          <p className="text-2xl font-black text-rose-700 mt-1">{summary.overdue}</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-sm flex flex-col md:flex-row gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari order id / customer..."
          className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => setOverdueOnly((prev) => !prev)}
          className={`px-3 py-2 rounded-xl text-xs font-bold border ${overdueOnly ? 'bg-rose-50 border-rose-300 text-rose-700' : 'bg-slate-50 border-slate-200 text-slate-700'}`}
        >
          {overdueOnly ? 'Tampilkan Semua' : 'Hanya Overdue'}
        </button>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <p className="text-sm text-slate-500">Memuat laporan driver...</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <p className="text-sm text-slate-500">Tidak ada laporan driver pada filter ini.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredOrders.map((order) => {
            const form = forms[String(order.id)] || {
              courierId: '',
              resolutionNote: '',
              submitting: false,
              feedback: '',
            };
            const activeIssue = order.active_issue || null;
            const evidenceUrl = normalizeEvidenceUrl(activeIssue?.evidence_url);
            const dueAt = activeIssue?.due_at;
            const issueOverdue = Boolean(order.issue_overdue);
            const invoiceId = String(order?.Invoice?.id || order?.invoice_id || '').trim();
            const invoiceNumber = String(order?.Invoice?.invoice_number || order?.invoice_number || '').trim();
            const invoiceLabel = invoiceNumber ? `INV ${invoiceNumber}` : invoiceId ? `INV-${invoiceId.slice(-8).toUpperCase()}` : '';
            const courierAssigned = String(order?.Invoice?.courier_id || '').trim() || '';

            return (
              <div key={order.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-slate-900">Order #{String(order.id).slice(-8).toUpperCase()}</p>
                    {invoiceLabel && (
                      <p className="text-xs text-slate-600 mt-1">
                        Invoice: <span className="font-semibold text-slate-800">{invoiceLabel}</span>
                      </p>
                    )}
                    <p className="text-xs text-slate-600 mt-1">
                      Customer: <span className="font-semibold text-slate-800">{order.customer_name || '-'}</span>
                    </p>
                    <p className="text-xs text-slate-600">
                      Pelapor: <span className="font-semibold text-slate-800">{activeIssue?.reporter_name || order.courier_display_name || order.Courier?.name || '-'}</span>
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Dibuat: {formatDateTime(order.createdAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-xs font-bold ${issueOverdue ? 'text-rose-700' : 'text-amber-700'}`}>
                      {issueOverdue ? 'OVERDUE' : 'PERLU FOLLOW-UP'}
                    </p>
                    <p className="text-xs text-slate-600 mt-1">
                      Deadline: {dueAt ? formatDateTime(dueAt) : '-'}
                    </p>
                    <p className={`text-xs mt-1 inline-flex items-center gap-1 ${issueOverdue ? 'text-rose-700' : 'text-amber-700'}`}>
                      <Clock3 size={12} />
                      {formatRemaining(dueAt)}
                    </p>
                  </div>
                </div>

                {activeIssue?.note && (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs text-amber-800">
                      <span className="font-black">Catatan Driver:</span> {activeIssue.note}
                    </p>
                  </div>
                )}

                {evidenceUrl && (
                  <div className="mt-3">
                    <p className="text-[11px] font-bold text-slate-500 uppercase mb-1">Foto Bukti</p>
                    <Image
                      src={evidenceUrl}
                      alt="Bukti laporan driver"
                      width={1024}
                      height={512}
                      unoptimized
                      className="w-full max-h-64 object-contain rounded-xl border border-slate-200 bg-slate-50"
                    />
                  </div>
                )}

                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="text-xs font-bold text-slate-600">
                    (Opsional) Assign driver untuk proses ulang
                    <select
                      value={form.courierId}
                      onChange={(e) => setOrderForm(String(order.id), { courierId: e.target.value })}
                      className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                      disabled={form.submitting}
                    >
                      <option value="">{courierAssigned ? 'Biarkan driver existing' : 'Pilih driver'}</option>
                      {couriers.map((courier) => (
                        <option key={courier.id} value={courier.id}>
                          {courier.display_name || courier.name || 'Driver'}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-xs font-bold text-slate-600">
                    Catatan follow-up gudang
                    <textarea
                      value={form.resolutionNote}
                      onChange={(e) => setOrderForm(String(order.id), { resolutionNote: e.target.value })}
                      rows={3}
                      placeholder="Contoh: Barang kurang sudah disiapkan ulang, kirim batch susulan."
                      className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                      disabled={form.submitting}
                    />
                  </label>
                </div>

                <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void submitFollowUp(String(order.id))}
                    disabled={form.submitting}
                    className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase inline-flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    <ShieldCheck size={14} /> {form.submitting ? 'Memproses...' : 'Selesaikan & Kembali ke Checker'}
                  </button>
                  {invoiceId && (
                    <Link
                      href={`/admin/tracker-gudang/${encodeURIComponent(invoiceId)}`}
                      className="px-4 py-2.5 rounded-xl border border-cyan-200 bg-cyan-50 text-cyan-700 text-xs font-black uppercase inline-flex items-center justify-center gap-2"
                    >
                      <ExternalLink size={14} /> Buka Checking
                    </Link>
                  )}
                  {form.feedback && (
                    <p className={`text-xs font-semibold ${form.feedback.toLowerCase().includes('berhasil') ? 'text-emerald-700' : 'text-rose-600'}`}>
                      {form.feedback}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
          {hasMore && (
            <div className="flex justify-center pt-1">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 text-xs font-bold disabled:opacity-60"
              >
                {loadingMore ? 'Memuat...' : 'Muat Lebih Banyak'}
              </button>
            </div>
          )}
        </div>
      )}

      {summary.overdue > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-rose-600 mt-0.5" />
          <p className="text-sm text-rose-700">
            Ada {summary.overdue} laporan melewati SLA 1x24 jam. Prioritaskan follow-up sebelum komplain berulang.
          </p>
        </div>
      )}
    </div>
  );
}
