'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Search, User } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

export default function Header() {
    const pathname = usePathname();
    const { user } = useAuthStore();

    // Don't show header on auth pages
    if (pathname?.startsWith('/auth')) {
        return null;
    }

    // Don't show on admin pages (admin has its own layout)
    if (pathname?.startsWith('/admin')) {
        return null;
    }
    const isCatalogPage = pathname?.startsWith('/catalog');

    const initials = user?.name
        ? user.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
        : '';

    const profileHref = user?.role === 'driver' ? '/driver/profile' : '/profile';
    const isDriverPage = pathname?.startsWith('/driver');

    if (isDriverPage) {
        return (
            <header className="bg-slate-900 text-white px-6 pt-8 pb-6 rounded-b-[32px] shadow-xl shadow-slate-200 sticky top-0 z-30 mb-6">
                <div className="flex justify-between items-center">
                    <div>
                        <Link href="/driver">
                            <div className="flex items-center gap-2">
                                <span className="bg-emerald-500 w-2 h-2 rounded-full animate-pulse"></span>
                                <h1 className="text-lg font-black tracking-tight italic text-white/90">DRIVER APP</h1>
                            </div>
                        </Link>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1 pl-4">Mitra Pengiriman Migunani</p>
                    </div>
                    <Link href="/driver/profile" className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-emerald-400 font-black border border-white/10 text-xs backdrop-blur-md">
                        {initials ? initials : <User size={16} />}
                    </Link>
                </div>
            </header>
        );
    }

    return (
        <header className="bg-white/95 backdrop-blur-sm px-6 pt-10 pb-6 rounded-b-[40px] shadow-sm border-b border-slate-200 sticky top-0 z-30">
            <div className={`flex justify-between items-center ${isCatalogPage ? '' : 'mb-6'}`}>
                <div>
                    <Link href="/">
                        <h1 className="text-xl font-black tracking-tight italic text-emerald-600">MIGUNANI MOTOR</h1>
                    </Link>
                    <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Suku cadang terpercaya</p>
                </div>
                <Link href={profileHref} className="w-10 h-10 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-600 font-bold border border-white shadow-sm text-sm">
                    {initials ? initials : <User size={16} />}
                </Link>
            </div>

            {!isCatalogPage && (
                <div className="relative">
                    <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <Link href="/catalog">
                        <div className="w-full bg-slate-100 border border-slate-200 rounded-2xl py-3.5 pl-12 pr-4 text-sm text-slate-500 shadow-inner cursor-pointer">
                            Cari suku cadang, produk...
                        </div>
                    </Link>
                </div>
            )}
        </header>
    );
}
