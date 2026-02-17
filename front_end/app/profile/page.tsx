'use client';

import Link from 'next/link';
import { User, LogOut, MapPin, Phone, Mail, ChevronRight, Settings, HelpCircle, Shield, ArrowRight, Sparkles, RotateCcw } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

export default function ProfilePage() {
    const { user, isAuthenticated, logout } = useAuthStore();
    const isGuest = !isAuthenticated || !user;

    if (isGuest) {
        return (
            <div className="p-6 space-y-6">
                <div className="flex justify-between items-center">
                    <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Akun</h3>
                </div>

                <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm space-y-5">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center border border-emerald-200">
                        <Sparkles size={22} />
                    </div>
                    <div className="space-y-2">
                        <h2 className="text-xl font-black text-slate-900">Masuk untuk akses akun penuh</h2>
                        <p className="text-sm text-slate-600">
                            Login atau daftar untuk melihat profil, riwayat pesanan, poin loyalty, dan data pengiriman.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Link
                            href="/auth/login"
                            className="h-12 rounded-2xl bg-emerald-600 text-white font-black text-xs uppercase tracking-wide shadow-lg shadow-emerald-200 inline-flex items-center justify-center gap-2 active:scale-95 transition-all"
                        >
                            Login
                            <ArrowRight size={14} />
                        </Link>
                        <Link
                            href="/auth/register"
                            className="h-12 rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700 font-black text-xs uppercase tracking-wide inline-flex items-center justify-center gap-2 active:scale-95 transition-all"
                        >
                            Register
                            <ArrowRight size={14} />
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    const initials = user?.name
        ? user.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
        : 'U';

    const menuItems = [
        { icon: RotateCcw, label: 'Status Retur', desc: 'Lacak pengembalian barang Anda', href: '/retur' },
        { icon: User, label: 'Edit Profil', desc: 'Ubah nama, foto profil', href: '/profile/edit' },
        { icon: MapPin, label: 'Alamat Saya', desc: 'Kelola alamat pengiriman', href: '/profile/addresses' },
        { icon: Shield, label: 'Keamanan', desc: 'Password, verifikasi', href: '/profile/security' },
        { icon: Settings, label: 'Pengaturan', desc: 'Notifikasi, bahasa', href: '/profile/settings' },
        { icon: HelpCircle, label: 'Bantuan', desc: 'FAQ, hubungi kami', href: '/profile/help' },
    ];

    return (
        <div className="p-6 space-y-6">
            {/* Section Header */}
            <div className="flex justify-between items-center">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">Profil Saya</h3>
            </div>

            {/* Profile Card */}
            <div className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm">
                <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-600 font-black text-xl border border-white shadow-sm">
                        {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                        <h2 className="text-lg font-black text-slate-900">
                            {user.name}
                        </h2>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                            {user.role || 'Customer'}
                        </p>
                    </div>
                </div>


                {/* Contact Info */}
                <div className="mt-6 space-y-3">
                    <div className="flex items-center gap-3 bg-slate-50 rounded-2xl px-4 py-3">
                        <Mail size={16} className="text-slate-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-[9px] font-bold text-slate-400 uppercase">Email</p>
                            <p className="text-xs font-bold text-slate-900 truncate">{user.email || '-'}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 bg-slate-50 rounded-2xl px-4 py-3">
                        <Phone size={16} className="text-slate-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-[9px] font-bold text-slate-400 uppercase">Telepon</p>
                            <p className="text-xs font-bold text-slate-900">{user.whatsapp_number || user.phone || '-'}</p>
                        </div>
                    </div>
                </div>
            </div>


            {/* Menu Items */}
            <div className="space-y-2">
                {menuItems.map((item, i) => {
                    const Icon = item.icon;
                    return (
                        <Link
                            key={i}
                            href={item.href}
                            className="bg-white p-4 rounded-3xl border border-slate-100 flex items-center gap-4 active:scale-95 transition-all shadow-sm"
                        >
                            <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 shrink-0">
                                <Icon size={18} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <h4 className="text-xs font-bold text-slate-900">{item.label}</h4>
                                <p className="text-[10px] text-slate-400">{item.desc}</p>
                            </div>
                            <ChevronRight size={16} className="text-slate-300" />
                        </Link>
                    );
                })}
            </div>

            <button
                onClick={() => logout()}
                className="w-full py-4 bg-slate-100 text-rose-500 font-black rounded-2xl text-xs uppercase active:scale-95 transition-all"
            >
                <LogOut size={14} className="inline mr-2" />
                Keluar
            </button>
        </div>
    );
}
