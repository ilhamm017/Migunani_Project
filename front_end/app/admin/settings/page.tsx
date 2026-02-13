'use client';

import { useEffect, useState } from 'react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';

export default function AdminSettingsPage() {
  const allowed = useRequireRoles(['super_admin']);
  const [waStatus, setWaStatus] = useState('UNKNOWN');
  const [pointRule, setPointRule] = useState('1 poin per Rp10.000');
  const [apiKey, setApiKey] = useState('********-demo-key');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.whatsapp.getStatus();
        setWaStatus(res.data?.status || 'UNKNOWN');
      } catch (error) {
        console.error('Failed to fetch WA status:', error);
      }
    };
    if (allowed) load();
  }, [allowed]);

  if (!allowed) return null;

  return (
    <div className="p-6 space-y-5">
      <h1 className="text-xl font-black text-slate-900">Pengaturan Sistem</h1>

      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3">
        <p className="text-sm font-bold text-slate-900">WhatsApp Bot</p>
        <p className="text-sm text-slate-600">Status koneksi: <span className="font-black">{waStatus}</span></p>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3">
        <p className="text-sm font-bold text-slate-900">Rule Loyalty Point</p>
        <input value={pointRule} onChange={(e) => setPointRule(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3">
        <p className="text-sm font-bold text-slate-900">API Key Integrasi</p>
        <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" />
      </div>

      <button onClick={() => alert('Pengaturan tersimpan (MVP).')} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black text-sm uppercase shadow-lg shadow-emerald-200">
        Simpan Pengaturan
      </button>
    </div>
  );
}
