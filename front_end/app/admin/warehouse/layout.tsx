'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useRequireRoles } from '@/lib/guards';

export default function WarehouseDashboardLayout({ children }: { children: React.ReactNode }) {
    const allowed = useRequireRoles(['super_admin', 'admin_gudang'], '/admin');
    const pathname = usePathname();

    const hasInternalPageScroll =
        pathname === '/admin/warehouse/stok' ||
        pathname === '/admin/warehouse/pesanan' ||
        pathname === '/admin/warehouse/helper' ||
        pathname === '/admin/warehouse/inbound';

    useEffect(() => {
        if (!allowed) return;

        const prevBodyOverflow = document.body.style.overflow;
        const prevHtmlOverflow = document.documentElement.style.overflow;
        const prevBodyPaddingBottom = document.body.style.paddingBottom;

        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        document.body.style.paddingBottom = '0px';

        return () => {
            document.body.style.overflow = prevBodyOverflow;
            document.documentElement.style.overflow = prevHtmlOverflow;
            document.body.style.paddingBottom = prevBodyPaddingBottom;
        };
    }, [allowed]);

    if (!allowed) return null;

    return (
        <div className="warehouse-theme pt-2 h-[calc(100dvh-var(--admin-header-height,72px)-var(--admin-bottom-nav-height,5rem)-0.5rem)] flex flex-col overflow-hidden">
            {/* Top Header Bar */}
            <header className="z-20 bg-slate-900/95 text-white shadow-lg backdrop-blur">
                <div className="flex items-center justify-between px-4 md:px-6 py-3">
                    <div className="flex items-center gap-3">
                        <Link
                            href="/admin"
                            className="flex items-center justify-center w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 transition-colors min-h-0 min-w-0"
                        >
                            <ArrowLeft size={18} />
                        </Link>
                        <div>
                            <h1 className="text-base md:text-lg font-black tracking-tight leading-none">
                                Gudang Command Center
                            </h1>
                            <p className="text-[11px] text-slate-400 font-medium mt-0.5 hidden sm:block">
                                Manajemen Gudang Advanced — Migunani Motor
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-[11px] text-emerald-400 font-bold hidden sm:inline">LIVE</span>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className={`flex-1 min-h-0 ${hasInternalPageScroll ? 'overflow-hidden' : 'overflow-y-auto'}`}>
                {children}
            </main>
        </div>
    );
}
