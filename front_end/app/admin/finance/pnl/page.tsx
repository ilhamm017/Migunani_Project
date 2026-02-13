'use client';

import { useState } from 'react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';

export default function FinancePnLPage() {
  const allowed = useRequireRoles(['super_admin']);
  const [startDate, setStartDate] = useState('2026-01-01');
  const [endDate, setEndDate] = useState('2026-12-31');
  const [data, setData] = useState<any>(null);

  if (!allowed) return null;

  const load = async () => {
    try {
      const res = await api.admin.finance.getPnL({ startDate, endDate });
      setData(res.data);
    } catch (error) {
      console.error('Failed to load PnL:', error);
      alert('Gagal mengambil data laba rugi.');
    }
  };

  return (
    <div className="p-6 space-y-5">
      <h1 className="text-xl font-black text-slate-900">Laporan Laba Rugi</h1>

      <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm grid grid-cols-1 md:grid-cols-3 gap-2">
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
        <button onClick={load} className="bg-emerald-600 text-white rounded-xl text-sm font-bold">Ambil Laporan</button>
      </div>

      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm"><p className="text-xs text-slate-500">Revenue</p><p className="text-2xl font-black text-slate-900">Rp {Number(data.revenue || 0).toLocaleString('id-ID')}</p></div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm"><p className="text-xs text-slate-500">COGS</p><p className="text-2xl font-black text-slate-900">Rp {Number(data.cogs || 0).toLocaleString('id-ID')}</p></div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm"><p className="text-xs text-slate-500">Expenses</p><p className="text-2xl font-black text-slate-900">Rp {Number(data.expenses || 0).toLocaleString('id-ID')}</p></div>
          <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 shadow-sm"><p className="text-xs text-emerald-700">Net Profit</p><p className="text-2xl font-black text-emerald-700">Rp {Number(data.net_profit || 0).toLocaleString('id-ID')}</p></div>
        </div>
      )}
    </div>
  );
}
