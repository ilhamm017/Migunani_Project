'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw, Wallet } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

type BalanceEntry = {
  id: number;
  amount: string | number;
  entry_type: string;
  reference_type?: string | null;
  reference_id?: string | null;
  note?: string | null;
  createdAt: string;
};

type BalanceResponse = {
  balance: number;
  total_credit: number;
  total_debt: number;
  entries: BalanceEntry[];
};

type ApiErrorWithMessage = {
  response?: { data?: { message?: string } };
};

export default function ProfileBalancePage() {
  const { user, isAuthenticated } = useAuthStore();
  const isGuest = !isAuthenticated || !user;

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<BalanceResponse | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await api.profile.getBalance();
      setData((res.data || null) as BalanceResponse | null);
    } catch (e: unknown) {
      const err = e as ApiErrorWithMessage;
      setData(null);
      setError(err?.response?.data?.message || 'Gagal memuat saldo');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isGuest) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  if (isGuest) {
    return (
      <div className="p-6 space-y-4">
        <Link href="/profile" className="inline-flex items-center gap-2 text-xs font-black text-slate-600">
          <ArrowLeft size={14} /> Kembali
        </Link>
        <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center border border-emerald-200">
            <Wallet size={22} />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-900">Masuk untuk melihat saldo</h2>
            <p className="text-sm text-slate-600 mt-2">Saldo hanya tersedia untuk akun customer.</p>
          </div>
          <Link
            href="/auth/login"
            className="h-12 rounded-2xl bg-emerald-600 text-white font-black text-xs uppercase tracking-wide shadow-lg shadow-emerald-200 inline-flex items-center justify-center gap-2 active:scale-95 transition-all"
          >
            Login
          </Link>
        </div>
      </div>
    );
  }

  const balance = Number(data?.balance || 0);
  const entries = Array.isArray(data?.entries) ? data!.entries : [];

  return (
    <div className="p-6 space-y-4 pb-24">
      <div className="flex items-center justify-between gap-3">
        <Link href="/profile" className="inline-flex items-center gap-2 text-xs font-black text-slate-600">
          <ArrowLeft size={14} /> Profil
        </Link>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="btn-3d inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200/70 disabled:opacity-50"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div className={`bg-white p-6 rounded-[32px] border shadow-sm ${balance < 0 ? 'border-rose-200' : 'border-emerald-200'}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Saldo Saya</p>
            <p className={`mt-2 text-2xl font-black ${balance < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
              {formatCurrency(balance)}
            </p>
            <p className="mt-2 text-[11px] text-slate-500">
              Kredit: <span className="font-bold text-slate-700">{formatCurrency(Number(data?.total_credit || 0))}</span> • Hutang: <span className="font-bold text-slate-700">{formatCurrency(Number(data?.total_debt || 0))}</span>
            </p>
          </div>
          <div className={`w-14 h-14 rounded-3xl border flex items-center justify-center ${balance < 0 ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
            <Wallet size={22} />
          </div>
        </div>
      </div>

      {error ? <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-sm text-rose-700">{error}</div> : null}

      <div className="bg-white p-5 rounded-[28px] border border-slate-100 shadow-sm space-y-3">
        <p className="text-xs font-black text-slate-900">Riwayat (20 terakhir)</p>
        {loading ? (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-500">Memuat...</div>
        ) : entries.length === 0 ? (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-500">Belum ada pergerakan saldo.</div>
        ) : (
          <div className="space-y-2">
            {entries.map((row) => {
              const amt = Number(row.amount || 0);
              const date = row.createdAt ? new Date(row.createdAt) : null;
              const dateStr = date && !Number.isNaN(date.getTime()) ? date.toISOString().replace('T', ' ').slice(0, 19) : '-';
              return (
                <div key={row.id} className="border border-slate-200 rounded-2xl p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black text-slate-900">{row.entry_type}</p>
                      <p className="text-[11px] text-slate-500 mt-1">{dateStr}</p>
                      {row.note ? <p className="text-[11px] text-slate-600 mt-1">{row.note}</p> : null}
                    </div>
                    <div className={`text-sm font-black ${amt < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                      {formatCurrency(amt)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

