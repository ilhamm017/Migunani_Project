'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AlertTriangle, Boxes, DollarSign, MessageSquare, Users, ClipboardCheck, Settings, Shield, LayoutDashboard, Megaphone, LogOut } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

export default function AdminOverviewPage() {
  const allowed = useRequireRoles(['super_admin', 'admin_gudang', 'admin_finance', 'kasir']);
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const [summary, setSummary] = useState({ pendingOrders: 0, unpaid: 0, chats: 0 });

  useEffect(() => {
    const load = async () => {
      try {
        const [ordersRes, arRes, chatRes] = await Promise.all([
          api.admin.orders.getAll({ page: 1, limit: 20 }),
          api.admin.finance.getAR(),
          api.chat.getSessions(),
        ]);

        setSummary({
          pendingOrders: Number(ordersRes.data?.total || 0),
          unpaid: Array.isArray(arRes.data) ? arRes.data.length : 0,
          chats: Number(chatRes.data?.pending_total || 0),
        });
      } catch (error) {
        console.error('Failed to load admin summary:', error);
      }
    };

    if (allowed) load();
  }, [allowed]);

  if (!allowed) return null;

  const isSuperAdmin = user?.role === 'super_admin';

  const modules = [
    { href: '/admin/inventory', title: 'Admin Gudang', desc: 'Inventori, import CSV, scanner SKU, PO', icon: Boxes },
    { href: '/admin/finance', title: 'Admin Finance', desc: 'Verifikasi transfer, biaya operasional, AR', icon: DollarSign },
    { href: '/admin/chat', title: 'Admin CS', desc: 'Shared inbox omnichannel', icon: MessageSquare },
    { href: '/admin/pos', title: 'Kasir POS', desc: 'Transaksi toko, pembayaran, shift', icon: ClipboardCheck },
    { href: '/admin/staff/daftar', title: 'Manajemen Staf', desc: 'CRUD akun admin/kasir/driver', icon: Users },
    { href: '/admin/settings', title: 'Pengaturan Sistem', desc: 'WA bot, poin loyalty, API', icon: Settings },
    { href: '/admin/audit-log', title: 'Audit Log', desc: 'Jejak aktivitas sensitif', icon: Shield },
  ];

  const superAdminTabs = [
    { href: '/admin', label: 'Overview', icon: LayoutDashboard },
    { href: '/admin/staff/daftar', label: 'Staf', icon: Users },
    { href: '/admin/settings', label: 'Pengaturan', icon: Settings },
    { href: '/admin/audit-log', label: 'Audit', icon: Shield },
    { href: '/admin/chat/broadcast', label: 'Broadcast', icon: Megaphone },
  ];

  const handleLogout = () => {
    logout();
    router.replace('/auth/login');
  };

  return (
    <div className="p-6 space-y-6">
      {isSuperAdmin && (
        <div className="bg-white border border-slate-200 rounded-[24px] p-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            {superAdminTabs.map((tab) => {
              const Icon = tab.icon;
              const active = pathname === tab.href;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
                    active ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  <Icon size={14} />
                  {tab.label}
                </Link>
              );
            })}

            <button
              onClick={handleLogout}
              className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-50 text-rose-700 text-xs font-bold hover:bg-rose-100 transition-colors"
            >
              <LogOut size={14} />
              Logout
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-[32px] p-6 shadow-sm">
        <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest">PALUGADA MODE</p>
        <h1 className="text-2xl font-black text-slate-900 mt-1">Owner Takeover Dashboard</h1>
        <p className="text-sm text-slate-600 mt-2">
          Mode Palugada dipakai saat owner perlu turun tangan menggantikan admin yang belum tersedia (gudang/finance/CS/kasir).
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
          <p className="text-xs text-amber-700">Order Perlu Follow-up</p>
          <p className="text-2xl font-black text-amber-700 mt-1">{summary.pendingOrders}</p>
        </div>
        <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4">
          <p className="text-xs text-rose-700">Piutang Aktif</p>
          <p className="text-2xl font-black text-rose-700 mt-1">{summary.unpaid}</p>
        </div>
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
          <p className="text-xs text-blue-700">Chat Masuk</p>
          <p className="text-2xl font-black text-blue-700 mt-1">{summary.chats}</p>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex items-start gap-3">
        <AlertTriangle size={18} className="text-amber-600 mt-0.5" />
        <p className="text-sm text-amber-800">
          Saat satu fungsi admin kosong, owner bisa langsung buka modul terkait dari halaman ini tanpa menunggu handover personel.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {modules.map((m) => {
          const Icon = m.icon;
          return (
            <Link key={m.href} href={m.href} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:border-emerald-300 transition-colors">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                  <Icon size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900">{m.title}</h3>
                  <p className="text-xs text-slate-600 mt-1">{m.desc}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
