'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Truck, Clock, MessageSquare } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { canUseChatUnreadByRole, useChatUnreadCount } from '@/lib/useChatUnreadCount';

type NavItem = {
    label: string;
    icon: LucideIcon;
    href: string;
};

const navItems: NavItem[] = [
    { href: '/driver', label: 'Tugas', icon: Truck },
    { href: '/driver/history', label: 'Riwayat', icon: Clock },
    { href: '/driver/chat', label: 'Chat', icon: MessageSquare },
];

export default function DriverBottomNav() {
    const pathname = usePathname();
    const { isAuthenticated, user } = useAuthStore();
    const role = String(user?.role || '').trim();
    const canAccessDriverNav = ['driver', 'super_admin', 'admin_gudang'].includes(role);
    const unreadCount = useChatUnreadCount({
        enabled: !!pathname?.startsWith('/driver') && isAuthenticated && canUseChatUnreadByRole(role)
    });

    // Only show on driver pages for driver-access roles.
    if (!pathname?.startsWith('/driver') || !canAccessDriverNav) {
        return null;
    }

    return (
        <nav className="fixed bottom-0 inset-x-0 h-24 bg-white/95 backdrop-blur-sm border-t border-slate-200 px-6 flex items-center justify-between z-50 rounded-t-[44px] shadow-[0_-10px_30px_rgba(15,23,42,0.08)]">
            {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const isChat = item.href === '/driver/chat';
                const sharedClassName = `flex flex-col items-center gap-1 flex-1 transition-colors ${isActive ? 'text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`;

                return (
                    <Link
                        key={item.href}
                        href={item.href}
                        className={sharedClassName}
                    >
                        <div className="relative">
                            <Icon size={24} strokeWidth={isActive ? 2.5 : 2} />
                            {isChat && unreadCount > 0 && (
                                <span className="absolute -top-2 -right-3 bg-emerald-600 text-white text-[8px] font-black rounded-full min-w-[16px] h-4 px-1 inline-flex items-center justify-center leading-none">
                                    {unreadCount > 99 ? '99+' : unreadCount}
                                </span>
                            )}
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wide">{item.label}</span>
                    </Link>
                );
            })}
        </nav>
    );
}
