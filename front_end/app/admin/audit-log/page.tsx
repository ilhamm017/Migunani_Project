'use client';

import { useRequireRoles } from '@/lib/guards';

const logs = [
  { id: 'L-001', actor: 'owner@migunani.com', action: 'Approve Payment', target: 'Order #A-12', at: '2026-02-11 09:12' },
  { id: 'L-002', actor: 'owner@migunani.com', action: 'Create PO', target: 'PO #PO-889', at: '2026-02-11 10:32' },
  { id: 'L-003', actor: 'finance@migunani.com', action: 'Create Expense', target: 'Expense #E-90', at: '2026-02-11 13:01' },
];

export default function AuditLogPage() {
  const allowed = useRequireRoles(['super_admin']);
  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      <h1 className="text-xl font-black text-slate-900">Audit Log</h1>
      <p className="text-sm text-slate-600">Rekam jejak aktivitas sensitif sistem.</p>
      <div className="space-y-2">
        {logs.map((log) => (
          <div key={log.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <p className="text-sm font-bold text-slate-900">{log.action}</p>
            <p className="text-xs text-slate-600 mt-1">Actor: {log.actor}</p>
            <p className="text-xs text-slate-600">Target: {log.target}</p>
            <p className="text-xs text-slate-500 mt-1">{log.at}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
