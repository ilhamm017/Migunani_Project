'use client';

import { api } from '@/lib/api';
import { useRequireRoles } from '@/lib/guards';
import { useEffect, useMemo, useState } from 'react';

type AuditActor = {
  id?: string;
  name?: string;
  email?: string | null;
  role?: string;
};

type AuditLogRow = {
  id: number;
  actor_user_id?: string | null;
  actor_role?: string | null;
  method: string;
  path: string;
  action: string;
  status_code: number;
  success: boolean;
  error_message?: string | null;
  request_payload?: unknown;
  response_payload?: unknown;
  createdAt: string;
  Actor?: AuditActor | null;
};

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
};

export default function AuditLogPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_finance']);
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [statusGroup, setStatusGroup] = useState<'' | 'success' | 'error'>('');
  const [method, setMethod] = useState('');

  useEffect(() => {
    if (!allowed) return;
    const load = async () => {
      try {
        setLoading(true);
        const res = await api.admin.finance.getAuditLogs({
          limit: 150,
          q: query.trim() || undefined,
          method: method || undefined,
          status_group: statusGroup || undefined,
        });
        setLogs(Array.isArray(res.data) ? res.data as AuditLogRow[] : []);
      } catch (error) {
        console.error('Failed to load audit logs:', error);
        setLogs([]);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [allowed, method, query, statusGroup]);

  const summary = useMemo(() => {
    return logs.reduce((acc, log) => {
      acc.total += 1;
      if (log.status_code >= 400) acc.errors += 1;
      else acc.success += 1;
      return acc;
    }, { total: 0, success: 0, errors: 0 });
  }, [logs]);

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-xl font-black text-slate-900">Audit Log</h1>
        <p className="text-sm text-slate-600">Rekam jejak perubahan website untuk tracking masalah, approval, dan mutasi data.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Log</p>
          <p className="mt-2 text-2xl font-black text-slate-900">{summary.total}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Berhasil</p>
          <p className="mt-2 text-2xl font-black text-emerald-800">{summary.success}</p>
        </div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">Error</p>
          <p className="mt-2 text-2xl font-black text-rose-800">{summary.errors}</p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_180px_180px]">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari action, path, atau error..."
          className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
        />
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm focus:outline-none"
        >
          <option value="">Semua Method</option>
          <option value="POST">POST</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
          <option value="DELETE">DELETE</option>
        </select>
        <select
          value={statusGroup}
          onChange={(e) => setStatusGroup(e.target.value as '' | 'success' | 'error')}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm focus:outline-none"
        >
          <option value="">Semua Status</option>
          <option value="success">Berhasil</option>
          <option value="error">Error</option>
        </select>
      </div>

      {loading && <p className="text-sm text-slate-500">Memuat audit log...</p>}
      {!loading && logs.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-sm text-slate-500">
          Belum ada audit log yang cocok dengan filter ini.
        </div>
      )}

      <div className="space-y-2">
        {logs.map((log) => (
          <div key={log.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wide ${log.status_code >= 400 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {log.method}
                  </span>
                  <span className="text-sm font-bold text-slate-900">{log.action}</span>
                </div>
                <p className="mt-2 text-xs text-slate-600">
                  Actor: {log.Actor?.name || log.Actor?.email || log.actor_user_id || 'System'} {log.actor_role ? `• ${log.actor_role}` : ''}
                </p>
                <p className="text-xs text-slate-600 break-all">Path: {log.path}</p>
                <p className="text-xs text-slate-500 mt-1">{formatDateTime(log.createdAt)} • HTTP {log.status_code}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wide ${log.status_code >= 400 ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'}`}>
                #{log.id}
              </span>
            </div>

            {log.error_message && (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                {log.error_message}
              </div>
            )}

            <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <summary className="cursor-pointer text-xs font-black uppercase tracking-wide text-slate-600">
                Detail Payload
              </summary>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div>
                  <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Request</p>
                  <pre className="max-h-64 overflow-auto rounded-xl bg-white p-3 text-[11px] text-slate-700">{JSON.stringify(log.request_payload ?? {}, null, 2)}</pre>
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Response</p>
                  <pre className="max-h-64 overflow-auto rounded-xl bg-white p-3 text-[11px] text-slate-700">{JSON.stringify(log.response_payload ?? {}, null, 2)}</pre>
                </div>
              </div>
            </details>
          </div>
        ))}
      </div>
    </div>
  );
}
