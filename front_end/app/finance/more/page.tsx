
'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft, Lock, FileText, Settings, Archive, ChevronRight, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function FinanceMorePage() {
    const router = useRouter();

    // Mock Data
    const currentPeriod = { month: 'Februari', year: 2024, status: 'OPEN' };

    const menuItems = [
        { icon: Lock, label: 'Tutup Buku / Periode', href: '/finance/more/periods', desc: `Status: ${currentPeriod.status}` },
        { icon: FileText, label: 'Jurnal Umum', href: '/finance/more/journals', desc: 'Lihat semua entry jurnal' },
        { icon: Archive, label: 'Audit Log', href: '/finance/more/audit-log', desc: 'Rekam jejak aktivitas' },
        { icon: Settings, label: 'Pengaturan Akun', href: '/finance/settings', desc: 'Manage Chart of Accounts' },
    ];

    const handleLogout = () => {
        if (confirm('Yakin logout?')) {
            sessionStorage.clear();
            window.location.href = '/auth/login';
        }
    };

    return (
        <div className="bg-slate-50 min-h-screen pb-24">
            {/* Header */}
            <div className="bg-white px-4 py-3 border-b border-slate-200 sticky top-0 z-10 flex items-center gap-3">
                <Link href="/finance" className="p-2 -ml-2 text-slate-600 hover:bg-slate-100 rounded-full">
                    <ArrowLeft size={20} />
                </Link>
                <div className="flex-1">
                    <h1 className="font-bold text-slate-900">Menu Lainnya</h1>
                    <p className="text-xs text-slate-500">Kontrol & Pengaturan</p>
                </div>
            </div>

            <div className="p-4 space-y-4">
                {/* Profile Card */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-lg">
                        AD
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-900">Admin Finance</h3>
                        <p className="text-xs text-slate-500">adminfinance@migunanimotor.com</p>
                    </div>
                </div>

                {/* Menu Grid */}
                <div className="space-y-2">
                    {menuItems.map((item, idx) => (
                        <Link
                            href={item.href}
                            key={idx}
                            className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between hover:bg-slate-50 transition-colors"
                        >
                            <div className="flex items-center gap-4">
                                <item.icon className="text-slate-500" size={20} />
                                <div>
                                    <h3 className="font-medium text-slate-900">{item.label}</h3>
                                    <p className="text-xs text-slate-500">{item.desc}</p>
                                </div>
                            </div>
                            <ChevronRight size={16} className="text-slate-300" />
                        </Link>
                    ))}
                </div>

                <button
                    onClick={handleLogout}
                    className="w-full bg-white text-red-600 font-bold py-3 rounded-xl border border-red-100 flex items-center justify-center gap-2 mt-8 hover:bg-red-50"
                >
                    <LogOut size={18} /> Logout
                </button>

                <p className="text-center text-[10px] text-slate-400 mt-4">
                    MIGUNANI MOTOR v1.2.0 • Build 20240216
                </p>
            </div>
        </div>
    );
}
