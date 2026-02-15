'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ShoppingBag, ShoppingCart, Package, MessageSquare } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCartStore } from '@/store/cartStore';
import { useAuthStore } from '@/store/authStore';
import { canUseChatUnreadByRole, useChatUnreadCount } from '@/lib/useChatUnreadCount';

type NavItem = {
    label: string;
    icon: LucideIcon;
    href: string;
};

const navItems: NavItem[] = [
    { href: '/', label: 'Home', icon: Home },
    { href: '/catalog', label: 'Katalog', icon: ShoppingBag },
    { href: '/cart', label: 'Keranjang', icon: ShoppingCart },
    { href: '/orders', label: 'Pesanan', icon: Package },
    { href: '/chat', label: 'Chat', icon: MessageSquare },
];

export default function BottomNav() {
    const pathname = usePathname();
    const totalItems = useCartStore((state) => state.totalItems);
    const { isAuthenticated, user } = useAuthStore();
    const role = String(user?.role || '').trim();
    const isCustomerRoute = !pathname?.startsWith('/admin') && !pathname?.startsWith('/auth') && !pathname?.startsWith('/driver');
    const isCustomerRole = !role || role === 'customer';
    const unreadCount = useChatUnreadCount({
        enabled: !!isCustomerRoute && isAuthenticated && isCustomerRole && canUseChatUnreadByRole(role)
    });

    // Show customer bottom nav on customer-facing routes.
    if (!isCustomerRoute) {
        return null;
    }

    return (
        <nav className="fixed bottom-0 inset-x-0 h-24 bg-white/95 backdrop-blur-sm border-t border-slate-200 px-6 flex items-center justify-between z-[120] rounded-t-[44px] shadow-[0_-10px_30px_rgba(15,23,42,0.08)] pointer-events-auto">
            {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
                const isCart = item.href === '/cart';
                const isChat = item.href === '/chat';
                const sharedClassName = `flex flex-col items-center gap-1 flex-1 transition-colors ${isActive ? 'text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`;

                return (
                    <Link
                        key={item.href}
                        href={item.href}
                        className={sharedClassName}
                    >
                        <div className="relative">
                            <Icon size={22} strokeWidth={isActive ? 3 : 2} />
                            {isCart && totalItems > 0 && (
                                <span className="absolute -top-2 -right-3 bg-emerald-600 text-white text-[8px] font-black rounded-full w-4 h-4 flex items-center justify-center">
                                    {totalItems > 9 ? '9+' : totalItems}
                                </span>
                            )}
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
