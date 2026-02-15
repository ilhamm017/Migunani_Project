'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClipboardList, LayoutDashboard, MessageSquare, Users, Wallet } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { canUseChatUnreadByRole, useChatUnreadCount } from '@/lib/useChatUnreadCount';
import { useAdminActionBadges } from '@/lib/useAdminActionBadges';

const navItems = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/sales', label: 'Customer', icon: Users },
  { href: '/admin/orders', label: 'Order', icon: ClipboardList },
  { href: '/admin/finance', label: 'Finance', icon: Wallet },
  { href: '/admin/chat', label: 'Chat', icon: MessageSquare },
];

export default function AdminBottomNav() {
  const pathname = usePathname();
  const { isAuthenticated, user } = useAuthStore();
  const role = user?.role || 'guest';

  const allowedAdminRoles = ['super_admin', 'admin_gudang', 'admin_finance', 'kasir'];
  const canAccessAdminNav = !!user && allowedAdminRoles.includes(user.role);
  const canAccessChat = !!user && canUseChatUnreadByRole(user.role);
  const unreadCount = useChatUnreadCount({
    enabled: !!pathname?.startsWith('/admin') && isAuthenticated && canAccessChat
  });
  const { orderBadgeCount } = useAdminActionBadges({
    enabled: !!pathname?.startsWith('/admin') && isAuthenticated && canAccessAdminNav,
    role: user?.role
  });

  if (!pathname?.startsWith('/admin') || !canAccessAdminNav) {
    return null;
  }
  const filteredNavItems = navItems.filter((item) => {
    if (role === 'super_admin') return true;

    // Overview & Chat always visible to all admins
    if (['Overview', 'Chat'].includes(item.label)) return true;

    if (role === 'admin_gudang') {
      return ['Order'].includes(item.label);
    }

    if (role === 'admin_finance') {
      return ['Order'].includes(item.label);
    }

    if (role === 'kasir') {
      return ['Customer'].includes(item.label);
    }

    return false;
  });

  const isActive = (href: string) => {
    if (href === '/admin') return pathname === '/admin';
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <nav className="fixed bottom-0 inset-x-0 h-[var(--admin-bottom-nav-height,5rem)] bg-white/95 backdrop-blur-sm border-t border-slate-200 px-4 flex items-center justify-between z-50">
      {filteredNavItems.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.href);
        const isChatItem = item.href === '/admin/chat';
        const isOrderItem = item.href === '/admin/orders';

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center gap-1 flex-1 transition-all active:scale-[0.96] active:opacity-80 ${active ? 'text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <div className="relative">
              <Icon size={20} strokeWidth={active ? 2.5 : 2} />
              {isChatItem && canAccessChat && unreadCount > 0 && (
                <span
                  className="absolute -top-2 -right-3 bg-emerald-600 text-white text-[8px] font-black rounded-full min-w-[16px] h-4 px-1 inline-flex items-center justify-center leading-none"
                  aria-hidden="true"
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
              {isOrderItem && orderBadgeCount > 0 && (
                <span
                  className="absolute -top-2 -right-3 bg-emerald-600 text-white text-[8px] font-black rounded-full min-w-[16px] h-4 px-1 inline-flex items-center justify-center leading-none"
                  aria-hidden="true"
                >
                  {orderBadgeCount > 99 ? '99+' : orderBadgeCount}
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
