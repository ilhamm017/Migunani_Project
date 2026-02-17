'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { MessageSquare, Coins, Key, Loader2, QrCode, RefreshCw, Smartphone, LogOut, CheckCircle2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

type WhatsAppStatusInfo = {
  pushname?: string;
  wid?: {
    user?: string;
  };
};

type WhatsAppStatus = {
  status?: string;
  info?: WhatsAppStatusInfo;
};

export default function AdminSettingsPage() {
  const allowed = useRequireRoles(['super_admin']);
  const [waStatus, setWaStatus] = useState<WhatsAppStatus>({ status: 'LOADING' });
  const [qr, setQr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [pointRule, setPointRule] = useState('1 poin per Rp10.000');
  const [apiKey, setApiKey] = useState('********-demo-key');

  const loadStatus = useCallback(async () => {
    try {
      const res = await api.whatsapp.getStatus();
      setWaStatus(res.data || { status: 'UNKNOWN' });

      // If we need a scan, fetch the QR
      if (res.data?.status === 'SCAN_NEEDED' || res.data?.status === 'QR_RECEIVED') {
        const qrRes = await api.whatsapp.getQr();
        if (qrRes.data?.qr) {
          setQr(qrRes.data.qr);
        }
      } else {
        setQr(null);
      }
    } catch (error) {
      console.error('Failed to fetch WA status:', error);
    }
  }, []);

  useEffect(() => {
    if (allowed) {
      loadStatus();
      const timer = setInterval(loadStatus, 10000);
      return () => clearInterval(timer);
    }
  }, [allowed, loadStatus]);

  if (!allowed) return null;

  const handleConnect = async () => {
    try {
      setLoading(true);
      await api.whatsapp.connect();
      // Wait a bit for initialization to start
      setTimeout(loadStatus, 2000);
    } catch {
      alert('Gagal memulai koneksi WhatsApp');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!confirm('Yakin ingin memutus koneksi WhatsApp?')) return;
    try {
      setLoading(true);
      await api.whatsapp.logout();
      setTimeout(loadStatus, 1000);
    } catch {
      alert('Gagal memutus koneksi');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 pb-24 space-y-8 animate-in fade-in duration-500">
      <header>
        <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] mb-1">System Configuration</p>
        <h1 className="text-2xl font-black text-slate-900 leading-none">Pengaturan Sistem</h1>
      </header>

      {/* WhatsApp Integrated Management */}
      <section className="bg-white border border-slate-200 rounded-[32px] overflow-hidden shadow-sm">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-500 text-white flex items-center justify-center shadow-lg shadow-green-500/20">
              <MessageSquare size={20} />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900 uppercase tracking-tight">WhatsApp Engine</h2>
              <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest mt-0.5">Automated Notifications & Bot</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${waStatus.status === 'READY' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                waStatus.status === 'STOPPED' ? 'bg-slate-100 text-slate-600 border-slate-200' :
                  'bg-amber-50 text-amber-700 border-amber-100 animate-pulse'
              }`}>
              {waStatus.status || 'CHECKING...'}
            </span>
            <button onClick={loadStatus} className="p-2 text-slate-400 hover:text-slate-900 transition-colors">
              <RefreshCw size={16} />
            </button>
          </div>
        </div>

        <div className="p-8 space-y-6">
          {waStatus.status === 'READY' ? (
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center">
                <CheckCircle2 size={48} />
              </div>
              <div>
                <p className="text-lg font-black text-slate-900">{waStatus.info?.pushname || 'Connected'}</p>
                <p className="text-sm text-slate-500 font-medium">Nomor: {waStatus.info?.wid?.user || '-'}</p>
                <p className="text-[10px] text-emerald-500 font-bold uppercase mt-1">Bot Aktif & Siap Menerima Pesan</p>
              </div>
              <button
                onClick={handleLogout}
                disabled={loading}
                className="mt-2 text-rose-600 text-xs font-black uppercase tracking-widest hover:underline flex items-center gap-1"
              >
                <LogOut size={14} /> Putus Koneksi
              </button>
            </div>
          ) : qr ? (
            <div className="flex flex-col items-center space-y-6">
              <div className="p-4 bg-white border-4 border-slate-900 rounded-[32px] shadow-2xl">
                <QRCodeSVG value={qr} size={200} />
              </div>
              <div className="text-center">
                <p className="text-sm font-black text-slate-900">Scan QR Code ini</p>
                <p className="text-xs text-slate-500 mt-1 max-w-[200px]">Buka WhatsApp di HP Anda {'>'} Perangkat Tertaut {'>'} Tautkan Perangkat.</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center text-center space-y-6 py-4">
              <div className="w-20 h-20 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center">
                <Smartphone size={40} />
              </div>
              <div className="max-w-xs">
                <h3 className="text-base font-black text-slate-900">Mulai Koneksi WhatsApp</h3>
                <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                  Klik tombol dibawah untuk menyalakan mesin WhatsApp dan men-generate QR Code baru.
                </p>
              </div>
              <button
                onClick={handleConnect}
                disabled={loading}
                className="px-8 py-4 bg-slate-900 text-white rounded-[24px] font-black text-sm uppercase tracking-widest shadow-xl shadow-slate-200 hover:scale-105 transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : <QrCode size={18} />}
                Connect WhatsApp
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Other Settings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
              <Coins size={20} />
            </div>
            <h3 className="text-sm font-black text-slate-900 uppercase">Loyalty Points</h3>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Aturan Perolehan Poin</label>
            <input value={pointRule} onChange={(e) => setPointRule(e.target.value)} className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition-all" />
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
              <Key size={20} />
            </div>
            <h3 className="text-sm font-black text-slate-900 uppercase">Integrasi API</h3>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">External API Key</label>
            <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all" />
          </div>
        </section>
      </div>

      <button className="w-full py-5 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-[28px] font-black text-sm uppercase tracking-[0.2em] shadow-2xl shadow-emerald-200 hover:scale-[0.99] active:scale-[0.97] transition-all">
        Update Global Configurations
      </button>

      <style jsx>{`
        @keyframes loading-progress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
    </div>
  );
}
