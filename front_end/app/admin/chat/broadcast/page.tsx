'use client';

import { useState } from 'react';
import { useRequireRoles } from '@/lib/guards';
import AdminChatTabs from '@/components/chat/AdminChatTabs';

export default function BroadcastPage() {
  const allowed = useRequireRoles(['super_admin', 'kasir']);
  const [title, setTitle] = useState('Promo Akhir Pekan');
  const [message, setMessage] = useState('Diskon 10% untuk semua oli hingga Minggu.');
  const [history, setHistory] = useState<Array<{ title: string; message: string; at: string }>>([]);

  if (!allowed) return null;

  const sendBroadcast = () => {
    const row = { title, message, at: new Date().toISOString() };
    setHistory((prev) => [row, ...prev]);
    alert('Broadcast tersimpan (MVP UI). Endpoint broadcast backend belum tersedia.');
  };

  return (
    <div className="p-6 space-y-5">
      <h1 className="text-xl font-black text-slate-900">Broadcast Management</h1>
      <AdminChatTabs />

      <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-sm space-y-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" placeholder="Judul broadcast" />
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm" rows={4} placeholder="Isi pesan" />
        <button onClick={sendBroadcast} className="w-full py-3 bg-emerald-600 text-white rounded-xl text-sm font-bold">Kirim Broadcast</button>
      </div>

      <div className="space-y-2">
        {history.map((h, i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
            <p className="text-sm font-bold text-slate-900">{h.title}</p>
            <p className="text-xs text-slate-600 mt-1">{h.message}</p>
            <p className="text-[10px] text-slate-500 mt-1">{h.at}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
