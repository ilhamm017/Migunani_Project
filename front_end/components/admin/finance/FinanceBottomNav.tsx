'use client';

import { Home, ClipboardList, BarChart3, Menu } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function FinanceBottomNav() {
    const pathname = usePathname();

    const navItems = [
        { href: '/admin', icon: Home, label: 'Home' },
        { href: '/admin/finance/biaya', icon: ClipboardList, label: 'Tasks' }, // Use Biaya as Tasks for now
        { href: '/admin/finance/pnl', icon: BarChart3, label: 'Reports' },
        { href: '/admin/finance/more', icon: Menu, label: 'More' }, // Placeholder for now
    ];

    return (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-3 flex justify-between items-center z-50 md:hidden">
            {navItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                    <Link key={item.href} href={item.href} className="flex flex-col items-center gap-1">
                        <item.icon
                            size={24}
                            className={`transition-colors ${isActive ? 'text-emerald-600 fill-emerald-100' : 'text-slate-400'}`}
                            fill={isActive ? 'currentColor' : 'none'}
                        />
                        <span className={`text-[10px] font-medium ${isActive ? 'text-emerald-700' : 'text-slate-400'}`}>
                            {item.label}
                        </span>
                    </Link>
                );
            })}
        </div>
    );
}
