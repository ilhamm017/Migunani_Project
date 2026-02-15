'use client';

import Link from 'next/link';
import { User } from 'lucide-react';

export default function AdminHeader() {
    return (
        <header className="bg-white/95 backdrop-blur-sm px-6 h-[var(--admin-header-height,72px)] sticky top-0 z-30 shadow-sm border-b border-slate-200 flex items-center justify-between">
            <Link href="/admin">
                <h1 className="text-lg font-black italic text-emerald-600 tracking-tight">MIGUNANI ADMIN</h1>
            </Link>
            <Link href="/admin/profile" className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-600 hover:bg-emerald-50 hover:text-emerald-600 transition-colors group">
                <User size={20} className="group-hover:scale-110 transition-transform" />
            </Link>
        </header>
    );
}
