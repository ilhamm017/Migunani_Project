'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock3, RefreshCw, Truck } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { useRealtimeRefresh } from '@/lib/useRealtimeRefresh';

type FollowUpFormState = {
  courierId: string;
  resolutionNote: string;
  submitting: boolean;
  feedback: string;
};

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
  const allowed = useRequireRoles(['admin_gudang', 'super_admin'], '/admin');
  const [orders, setOrders] = useState<any[]>([]);
  const [couriers, setCouriers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [forms, setForms] = useState<Record<string, FollowUpFormState>>({});

  const loadData = useCallback(async (searchValue: string) => {
    try {
      setLoading(true);
      const [ordersRes, couriersRes] = await Promise.all([
        api.admin.orderManagement.getAll({
          status: 'hold',
          limit: 100,
          search: searchValue || undefined,
        }),
        api.admin.orderManagement.getCouriers(),
      ]);

      const rows = (ordersRes.data?.orders || []) as any[];
      setOrders(rows);
      setCouriers(couriersRes.data?.employees || []);
      setForms((prev) => {
        const next: Record<string, FollowUpFormState> = {};
        for (const row of rows) {
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
      setOrders([]);
    } finally {
      setLoading(false);
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
    void loadData(search.trim());
  }, [loadData, search]);

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
    if (!form.courierId) {
      setOrderForm(orderId, { feedback: 'Pilih driver untuk kirim ulang.' });
      return;
    }
    if (form.resolutionNote.trim().length < 5) {
      setOrderForm(orderId, { feedback: 'Catatan follow-up minimal 5 karakter.' });
      return;
    }

    try {
      setOrderForm(orderId, { submitting: true, feedback: '' });
      await api.admin.orderManagement.updateStatus(orderId, {
        status: 'shipped',
        courier_id: form.courierId,
        resolution_note: form.resolutionNote.trim(),
      });
      setOrderForm(orderId, { feedback: 'Follow-up berhasil. Order dikirim ulang ke driver.' });
      await loadData(search.trim());
    } catch (error: any) {
      const message = error?.response?.data?.message || 'Gagal submit follow-up.';
      setOrderForm(orderId, { feedback: message });
    } finally {
      setOrderForm(orderId, { submitting: false });
    }
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900">Laporan Driver: Barang Kurang</h1>
          <p className="text-sm text-slate-600 mt-1">Follow-up wajib dalam 1x24 jam. Pilih driver baru untuk kirim ulang.</p>
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

            return (
              <div key={order.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-slate-900">Order #{String(order.id).slice(-8).toUpperCase()}</p>
                    <p className="text-xs text-slate-600 mt-1">
                      Customer: <span className="font-semibold text-slate-800">{order.customer_name || '-'}</span>
                    </p>
                    <p className="text-xs text-slate-600">
                      Driver pelapor: <span className="font-semibold text-slate-800">{order.courier_display_name || order.Courier?.name || '-'}</span>
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
                    <img
                      src={evidenceUrl}
                      alt="Bukti laporan driver"
                      className="w-full max-h-64 object-contain rounded-xl border border-slate-200 bg-slate-50"
                    />
                  </div>
                )}

                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="text-xs font-bold text-slate-600">
                    Assign driver kirim ulang
                    <select
                      value={form.courierId}
                      onChange={(e) => setOrderForm(String(order.id), { courierId: e.target.value })}
                      className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                      disabled={form.submitting}
                    >
                      <option value="">Pilih driver</option>
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
                    <Truck size={14} /> {form.submitting ? 'Memproses...' : 'Kirim Ulang ke Driver'}
                  </button>
                  {form.feedback && (
                    <p className={`text-xs font-semibold ${form.feedback.toLowerCase().includes('berhasil') ? 'text-emerald-700' : 'text-rose-600'}`}>
                      {form.feedback}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
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
