'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Boxes, ClipboardList, LayoutDashboard, MessageSquare, Wallet } from 'lucide-react';
import { api } from '@/lib/api';
import getSocket from '@/lib/socket';
import { useAuthStore } from '@/store/authStore';

type ChatSessionRow = {
  Messages?: Array<{
    sender_type?: 'customer' | 'admin' | string;
    is_read?: boolean;
  }>;
};

const navItems = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/orders', label: 'Order', icon: ClipboardList },
  { href: '/admin/inventory', label: 'Gudang', icon: Boxes },
  { href: '/admin/finance', label: 'Finance', icon: Wallet },
  { href: '/admin/chat', label: 'Chat', icon: MessageSquare },
];

export default function AdminBottomNav() {
  const pathname = usePathname();
  const { isAuthenticated, user } = useAuthStore();
  const [hasUnreadChat, setHasUnreadChat] = useState(false);

  const canAccessChat = !!user && ['super_admin', 'admin_gudang', 'admin_finance', 'kasir'].includes(user.role);

  useEffect(() => {
    if (!pathname?.startsWith('/admin') || !isAuthenticated || !canAccessChat) {
      setHasUnreadChat(false);
      return;
    }

    let isMounted = true;

    const loadChatStatus = async () => {
      try {
        const res = await api.chat.getSessions();
        const rows = Array.isArray(res.data?.sessions) ? (res.data.sessions as ChatSessionRow[]) : [];
        const pendingTotal = Number(res.data?.pending_total || 0);

        const hasUnreadFromRows = rows.some((session) => {
          const latestMessage = Array.isArray(session.Messages) && session.Messages.length > 0 ? session.Messages[0] : null;
          return latestMessage?.sender_type === 'customer' && latestMessage?.is_read === false;
        });

        if (isMounted) {
          setHasUnreadChat(pendingTotal > 0 || hasUnreadFromRows);
        }
      } catch (error) {
        console.error('Failed to load chat indicator:', error);
      }
    };

    void loadChatStatus();

    const socket = getSocket();
    const onChatMessage = () => {
      void loadChatStatus();
    };
    const onChatStatus = () => {
      void loadChatStatus();
    };

    socket.on('chat:message', onChatMessage);
    socket.on('chat:status', onChatStatus);
    const timer = setInterval(() => {
      void loadChatStatus();
    }, 15000);

    return () => {
      isMounted = false;
      clearInterval(timer);
      socket.off('chat:message', onChatMessage);
      socket.off('chat:status', onChatStatus);
    };
  }, [pathname, isAuthenticated, canAccessChat]);

  if (!pathname?.startsWith('/admin')) {
    return null;
  }

  const isActive = (href: string) => {
    if (href === '/admin') return pathname === '/admin';
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <nav className="fixed bottom-0 inset-x-0 h-20 bg-white/95 backdrop-blur-sm border-t border-slate-200 px-4 flex items-center justify-between z-50">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.href);
        const isChatItem = item.href === '/admin/chat';

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center gap-1 flex-1 transition-all active:scale-[0.96] active:opacity-80 ${active ? 'text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <div className="relative">
              <Icon size={20} strokeWidth={active ? 2.5 : 2} />
              {isChatItem && canAccessChat && hasUnreadChat && (
                <span
                  className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full ring-2 ring-white bg-emerald-500 animate-pulse"
                  aria-hidden="true"
                />
              )}
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wide">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
