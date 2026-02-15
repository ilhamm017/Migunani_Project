'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useRequireRoles } from '@/lib/guards';
import { useAuthStore } from '@/store/authStore';

export default function FinanceAdminHubPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_finance']);
  const router = useRouter();
  const { user } = useAuthStore();

  useEffect(() => {
    if (allowed && user?.role === 'admin_finance') {
      router.replace('/admin');
    }
  }, [allowed, router, user?.role]);

  if (!allowed) return null;
  if (user?.role === 'admin_finance') return null;

  const menus = [
    { href: '/admin/finance/verifikasi', title: 'Verifikasi Pembayaran', desc: 'Cek bukti transfer dan approve/reject' },
    { href: '/admin/finance/biaya', title: 'Input Biaya Operasional', desc: 'Input dan pantau expense harian' },
    { href: '/admin/finance/biaya/label', title: 'Konfigurasi Label Biaya', desc: 'Tambah, ubah, dan hapus label biaya' },
    { href: '/admin/finance/piutang', title: 'Laporan Piutang', desc: 'Aging report invoice belum lunas' },
    { href: '/admin/finance/pnl', title: 'Laba Rugi (P&L)', desc: 'Omzet - HPP - biaya operasional' },
    { href: '/admin/finance/retur', title: 'Refund Retur', desc: 'Daftar pengembalian dana dari retur disetujui' },
  ];

  return (
    <div className="p-6 space-y-5">
      <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm">
        <h1 className="text-xl font-black text-slate-900">Admin Finance</h1>
        <p className="text-sm text-slate-600 mt-1">Kelola pembayaran, biaya, AR, dan laporan keuangan.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {menus.map((m) => (
          <Link key={m.href} href={m.href} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:border-emerald-300 transition-colors">
            <h3 className="text-sm font-black text-slate-900">{m.title}</h3>
            <p className="text-xs text-slate-600 mt-1">{m.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
