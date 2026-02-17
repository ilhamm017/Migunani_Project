'use client';

import Link from 'next/link';
import { ArrowLeft, CheckCircle, Clock, FileText, RotateCcw, Settings, TrendingUp, Wallet } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { useAuthStore } from '@/store/authStore';

const financeMenus = [
  { href: '/admin/finance/verifikasi', title: 'Verifikasi Transfer', desc: 'Validasi bukti transfer customer.', icon: CheckCircle, tone: 'bg-emerald-100 text-emerald-700' },
  { href: '/admin/finance/cod', title: 'Settlement COD', desc: 'Terima setoran COD dari driver.', icon: Wallet, tone: 'bg-amber-100 text-amber-700' },
  { href: '/admin/finance/retur', title: 'Refund Retur', desc: 'Proses pengembalian dana retur.', icon: RotateCcw, tone: 'bg-indigo-100 text-indigo-700' },
  { href: '/admin/finance/biaya', title: 'Biaya Operasional', desc: 'Pengajuan dan pencairan expense.', icon: Clock, tone: 'bg-blue-100 text-blue-700' },
  { href: '/admin/finance/piutang', title: 'Piutang (AR)', desc: 'Monitor invoice belum lunas.', icon: Wallet, tone: 'bg-rose-100 text-rose-700' },
  { href: '/admin/finance/credit-note', title: 'Credit Note', desc: 'Koreksi kredit untuk invoice.', icon: FileText, tone: 'bg-purple-100 text-purple-700' },
  { href: '/admin/finance/laporan', title: 'Laporan Keuangan', desc: 'PnL, neraca, cashflow, pajak.', icon: TrendingUp, tone: 'bg-slate-100 text-slate-700' },
  { href: '/admin/finance/jurnal/adjustment', title: 'Jurnal Manual', desc: 'Adjustment jurnal akuntansi.', icon: FileText, tone: 'bg-cyan-100 text-cyan-700' },
  { href: '/admin/finance/settings/tax', title: 'Pengaturan Pajak', desc: 'Atur mode pajak perusahaan.', icon: Settings, tone: 'bg-lime-100 text-lime-700' },
];

export default function FinanceAdminHubPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_finance'], '/admin');
  const { user } = useAuthStore();

  if (!allowed) return null;

  return (
    <div className="p-4 sm:p-6 pb-20 space-y-5 sm:space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Link href="/admin" className="inline-flex items-center gap-2 text-xs font-bold text-slate-600">
          <ArrowLeft size={14} />
          Kembali ke Dashboard
        </Link>
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">FinanceHub</span>
      </div>

      <div className="bg-white border border-slate-200 rounded-[24px] sm:rounded-[32px] p-5 sm:p-6 shadow-sm">
        <p className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em]">Finance Command Center</p>
        <h1 className="text-xl sm:text-2xl font-black text-slate-900 mt-1">Halo, {user?.name?.split(' ')[0] || 'Admin'}.</h1>
        <p className="text-xs sm:text-sm text-slate-600 mt-2">
          Pilih modul keuangan yang mau kamu kerjakan. Halaman ini dipakai sebagai pintu utama semua aktivitas finance.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-3">
        {financeMenus.map((item) => {
          const Icon = item.icon || FileText;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm hover:border-emerald-300 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between gap-2">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${item.tone}`}>
                  <Icon size={18} />
                </div>
                <span className="text-[9px] font-black uppercase tracking-wide text-slate-400 group-hover:text-emerald-700">Buka</span>
              </div>
              <h3 className="mt-2.5 text-[11px] sm:text-xs font-black text-slate-900 leading-tight">{item.title}</h3>
              <p className="text-[10px] text-slate-500 mt-1 leading-tight hidden sm:block">{item.desc}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
