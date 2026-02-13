'use client';

import { useState } from 'react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';

export default function PosShiftReportPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'kasir']);
  const [startCash, setStartCash] = useState('0');
  const [endCash, setEndCash] = useState('0');
  const [summary, setSummary] = useState<any>(null);

  if (!allowed) return null;

  const startShift = async () => {
    try {
      await api.pos.startShift({ initialCash: Number(startCash) });
      alert('Shift dimulai.');
    } catch (error) {
      console.error('Start shift failed:', error);
      alert('Gagal start shift.');
    }
  };

  const endShift = async () => {
    try {
      const res = await api.pos.endShift({ endCash: Number(endCash) });
      setSummary(res.data?.summary || null);
    } catch (error) {
      console.error('End shift failed:', error);
      alert('Gagal end shift.');
    }
  };

  return (
    <div className="p-6 space-y-5">
      <h1 className="text-xl font-black text-slate-900">Laporan Shift Kasir</h1>

      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3">
        <label className="text-sm font-bold text-slate-900">Start Cash</label>
        <input type="number" value={startCash} onChange={(e) => setStartCash(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
        <button onClick={startShift} className="w-full py-3 bg-emerald-600 text-white rounded-xl text-sm font-bold">Mulai Shift</button>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3">
        <label className="text-sm font-bold text-slate-900">End Cash (Aktual)</label>
        <input type="number" value={endCash} onChange={(e) => setEndCash(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
        <button onClick={endShift} className="w-full py-3 bg-slate-900 text-white rounded-xl text-sm font-bold">Tutup Shift</button>
      </div>

      {summary && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-3xl p-5 space-y-1">
          <p className="text-sm font-bold text-emerald-700">Ringkasan Shift</p>
          <p className="text-xs text-emerald-700">Start cash: {summary.start_cash}</p>
          <p className="text-xs text-emerald-700">Cash sales: {summary.cash_sales}</p>
          <p className="text-xs text-emerald-700">Expected cash: {summary.expected_cash}</p>
          <p className="text-xs text-emerald-700">Actual cash: {summary.actual_cash}</p>
          <p className="text-xs text-emerald-700">Difference: {summary.difference}</p>
        </div>
      )}
    </div>
  );
}
