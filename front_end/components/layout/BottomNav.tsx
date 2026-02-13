'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Home, ShoppingBag, ShoppingCart, Package, MessageSquare } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCartStore } from '@/store/cartStore';

type NavItem = {
    label: string;
    icon: LucideIcon;
    href?: string;
    action?: 'toggle-chat';
};

const navItems: NavItem[] = [
    { href: '/', label: 'Home', icon: Home },
    { href: '/catalog', label: 'Katalog', icon: ShoppingBag },
    { href: '/cart', label: 'Keranjang', icon: ShoppingCart },
    { href: '/orders', label: 'Pesanan', icon: Package },
    { label: 'Chat', icon: MessageSquare, action: 'toggle-chat' },
];

export default function BottomNav() {
    const pathname = usePathname();
    const totalItems = useCartStore((state) => state.totalItems);
    const [chatOpen, setChatOpen] = useState(false);

    useEffect(() => {
        const onChatState = (event: Event) => {
            const customEvent = event as CustomEvent<{ open?: boolean }>;
            setChatOpen(customEvent.detail?.open === true);
        };

        window.addEventListener('webchat:state', onChatState as EventListener);
        return () => {
            window.removeEventListener('webchat:state', onChatState as EventListener);
        };
    }, []);

    // Hide bottom nav on admin pages and auth pages
    if (pathname?.startsWith('/admin') || pathname?.startsWith('/auth')) {
        return null;
    }

    return (
        <nav className="fixed bottom-0 inset-x-0 h-24 bg-white/95 backdrop-blur-sm border-t border-slate-200 px-6 flex items-center justify-between z-50 rounded-t-[44px] shadow-[0_-10px_30px_rgba(15,23,42,0.08)]">
            {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = item.action === 'toggle-chat' ? chatOpen : pathname === item.href;
                const isCart = item.href === '/cart';
                const sharedClassName = `flex flex-col items-center gap-1 flex-1 transition-colors ${isActive ? 'text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`;

                if (item.action === 'toggle-chat') {
                    return (
                        <button
                            key={item.label}
                            type="button"
                            onClick={() => window.dispatchEvent(new CustomEvent('webchat:toggle'))}
                            className={sharedClassName}
                            aria-label="Buka chat bantuan"
                        >
                            <div className="relative">
                                <Icon size={22} strokeWidth={isActive ? 3 : 2} />
                            </div>
                            <span className="text-[10px] font-bold uppercase tracking-wide">{item.label}</span>
                        </button>
                    );
                }

                return (
                    <Link
                        key={item.href}
                        href={item.href!}
                        className={sharedClassName}
                    >
                        <div className="relative">
                            <Icon size={22} strokeWidth={isActive ? 3 : 2} />
                            {isCart && totalItems > 0 && (
                                <span className="absolute -top-2 -right-3 bg-emerald-600 text-white text-[8px] font-black rounded-full w-4 h-4 flex items-center justify-center">
                                    {totalItems > 9 ? '9+' : totalItems}
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
