
'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ListTodo, PieChart, Menu, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
// import { useFinanceBadges } from '@/lib/useFinanceBadges'; // To be implemented later

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();

    const navItems = [
        { href: '/finance', label: 'Home', icon: Home, exact: true },
        { href: '/finance/tasks', label: 'Tasks', icon: ListTodo }, // Virtual page or aggregate
        { href: '/finance/reports', label: 'Reports', icon: PieChart },
        { href: '/finance/more', label: 'More', icon: Menu },
    ];

    const isActive = (href: string, exact: boolean = false) => {
        if (exact) return pathname === href;
        return pathname.startsWith(href);
    };

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            <main className="flex-1 pb-20">
                {children}
            </main>

            {/* Bottom Navigation for Mobile */}
            <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-2 flex justify-between items-center z-50 md:hidden">
                {navItems.map((item) => (
                    <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                            "flex flex-col items-center gap-1 p-2 rounded-lg transition-colors min-w-[64px]",
                            isActive(item.href, item.exact)
                                ? "text-blue-600"
                                : "text-slate-400 hover:text-slate-600"
                        )}
                    >
                        <div className="relative">
                            <item.icon size={24} strokeWidth={isActive(item.href, item.exact) ? 2.5 : 2} />
                            {/* Badger placeholder */}
                            {item.label === 'Tasks' && (
                                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>
                            )}
                        </div>
                        <span className="text-[10px] font-medium">{item.label}</span>
                    </Link>
                ))}
            </div>

            {/* Desktop Sidebar Fallback (Simple) */}
            <div className="hidden md:flex flex-col fixed left-0 top-0 bottom-0 w-64 bg-slate-900 text-white p-6">
                <div className="mb-8">
                    <h1 className="text-xl font-bold tracking-tight">MIGUNANI<span className="text-blue-400">FINANCE</span></h1>
                </div>
                <nav className="flex flex-col gap-2">
                    {navItems.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                "flex items-center gap-3 px-4 py-3 rounded-lg transition-colors",
                                isActive(item.href, item.exact)
                                    ? "bg-blue-600 text-white"
                                    : "text-slate-400 hover:text-white hover:bg-slate-800"
                            )}
                        >
                            <item.icon size={20} />
                            <span className="font-medium">{item.label}</span>
                        </Link>
                    ))}
                </nav>
            </div>
            <div className="hidden md:block md:pl-64">
                {/* Desktop content spacer */}
            </div>
        </div>
    );
}
