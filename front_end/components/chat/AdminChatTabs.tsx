'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquare, RadioTower, Megaphone } from 'lucide-react';

const tabs = [
  { href: '/admin/chat', label: 'Inbox Web + WA', icon: MessageSquare },
  { href: '/admin/chat/whatsapp', label: 'Koneksi WhatsApp', icon: RadioTower },
  { href: '/admin/chat/broadcast', label: 'Broadcast', icon: Megaphone },
];

export default function AdminChatTabs() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/admin/chat') {
      return pathname === '/admin/chat';
    }
    return pathname === href || pathname?.startsWith(`${href}/`);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-2 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab.href);

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold transition-colors ${
                active ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
