'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, X } from 'lucide-react';
import getSocket from '@/lib/socket';
import { useAuthStore } from '@/store/authStore';
import { notifyClose, notifyOpen } from '@/lib/notify';

type IncomingChatEvent = {
    session_id?: string;
    thread_id?: string;
    sender?: 'customer' | 'admin' | 'bot' | string;
    sender_id?: string;
    platform?: 'web' | 'whatsapp' | string;
    body?: string;
    attachment_url?: string;
    timestamp?: string;
};

type NoticeItem = {
    id: string;
    title: string;
    body: string;
    href: string;
};

const NOTICE_TTL_MS = 6500;
const STAFF_ROLES = new Set(['super_admin', 'kasir', 'admin_gudang', 'admin_finance', 'driver']);
const ATTACHMENT_FALLBACK_BODY = '[Lampiran]';

const getRouteByRole = (role: string): string => {
    if (role === 'customer') return '/chat';
    if (role === 'driver') return '/driver/chat';
    if (STAFF_ROLES.has(role)) return '/admin/chat';
    return '/';
};

const getPreviewBody = (payload: IncomingChatEvent): string => {
    const raw = String(payload.body || '').trim();
    if (raw && raw !== ATTACHMENT_FALLBACK_BODY) return raw;
    if (payload.attachment_url) return 'Lampiran baru';
    return raw || 'Pesan baru';
};

export default function IncomingChatNotifier() {
    const router = useRouter();
    const { user, isAuthenticated } = useAuthStore();
    const [notices, setNotices] = useState<NoticeItem[]>([]);
    const timeoutMapRef = useRef<Map<string, number>>(new Map());
    const hasRequestedBrowserPermissionRef = useRef(false);

    const dismissNotice = useCallback((id: string) => {
        const timeoutId = timeoutMapRef.current.get(id);
        if (typeof timeoutId === 'number') {
            window.clearTimeout(timeoutId);
            timeoutMapRef.current.delete(id);
        }
        setNotices((prev) => prev.filter((item) => item.id !== id));
    }, []);

    const pushNotice = useCallback((notice: Omit<NoticeItem, 'id'>) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setNotices((prev) => [{ id, ...notice }, ...prev].slice(0, 3));
        const timeoutId = window.setTimeout(() => dismissNotice(id), NOTICE_TTL_MS);
        timeoutMapRef.current.set(id, timeoutId);
    }, [dismissNotice]);

    const maybePushBrowserNotification = useCallback((title: string, body: string, href: string) => {
        if (typeof window === 'undefined') return;
        if (!('Notification' in window)) return;
        if (document.visibilityState === 'visible') return;

        const openTarget = () => {
            window.focus();
            router.push(href);
        };

        if (Notification.permission === 'granted') {
            const browserNotification = new Notification(title, {
                body,
                icon: '/favicon.ico'
            });
            browserNotification.onclick = openTarget;
            return;
        }

        if (Notification.permission === 'default' && !hasRequestedBrowserPermissionRef.current) {
            hasRequestedBrowserPermissionRef.current = true;
            Notification.requestPermission().then((permission) => {
                if (permission !== 'granted') return;
                const browserNotification = new Notification(title, {
                    body,
                    icon: '/favicon.ico'
                });
                browserNotification.onclick = openTarget;
            }).catch(() => {
                // Ignore browser permission errors silently.
            });
        }
    }, [router]);

    useEffect(() => {
        const timeoutMap = timeoutMapRef.current;
        return () => {
            timeoutMap.forEach((timeoutId) => window.clearTimeout(timeoutId));
            timeoutMap.clear();
        };
    }, []);

    useEffect(() => {
        if (!isAuthenticated || !user?.id || !user?.role) return;

        const socket = getSocket();
        const onIncomingMessage = (payload: IncomingChatEvent) => {
            if (!payload) return;

            const sender = String(payload.sender || '').trim();
            if (!sender || sender === 'bot') return;

            const actorRole = String(user.role || '').trim();
            const actorId = String(user.id || '').trim();
            const senderId = String(payload.sender_id || '').trim();
            if (senderId && senderId === actorId) return;

            let shouldNotify = false;
            if (actorRole === 'customer') {
                shouldNotify = sender === 'admin';
            } else if (STAFF_ROLES.has(actorRole)) {
                shouldNotify = sender === 'customer' || (sender === 'admin' && (!senderId || senderId !== actorId));
            }

            if (!shouldNotify) return;

            const sourceLabel = payload.platform === 'whatsapp' ? 'WA' : 'APP';
            const previewBody = getPreviewBody(payload);
            const title = actorRole === 'customer'
                ? `Pesan baru dari Migunani (${sourceLabel})`
                : `Pesan masuk (${sourceLabel})`;
            const body = previewBody.length > 120 ? `${previewBody.slice(0, 117)}...` : previewBody;
            const href = getRouteByRole(actorRole);

            pushNotice({ title, body, href });
            maybePushBrowserNotification(title, body, href);
        };

        socket.on('chat:message', onIncomingMessage);
        return () => {
            socket.off('chat:message', onIncomingMessage);
        };
    }, [dismissNotice, isAuthenticated, maybePushBrowserNotification, pushNotice, user?.id, user?.role]);

    if (!isAuthenticated || notices.length === 0) return null;

    return (
        <button
            type="button"
            className="fixed top-20 right-4 z-[70] inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/95 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-700 shadow-lg backdrop-blur-sm hover:bg-emerald-50"
            onClick={() => {
                notifyOpen({
                    variant: 'info',
                    title: 'Pesan Masuk',
                    secondaryLabel: 'Bersihkan',
                    primaryLabel: 'Tutup',
                    onSecondary: () => setNotices([]),
                    message: (
                        <div className="space-y-2">
                            {notices.map((notice) => (
                                <div key={notice.id} className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-white/70 p-3">
                                    <div className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                                        <Bell size={16} />
                                    </div>
                                    <button
                                        type="button"
                                        className="min-w-0 flex-1 text-left"
                                        onClick={() => {
                                            router.push(notice.href);
                                            dismissNotice(notice.id);
                                            notifyClose();
                                        }}
                                    >
                                        <p className="text-xs font-black text-slate-900 leading-tight">{notice.title}</p>
                                        <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{notice.body}</p>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => dismissNotice(notice.id)}
                                        className="h-8 w-8 rounded-2xl border border-slate-200 bg-white/70 text-slate-600 hover:bg-white inline-flex items-center justify-center"
                                        aria-label="Hapus notifikasi"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    ),
                });
            }}
            aria-label="Buka notifikasi chat"
        >
            <Bell size={16} />
            <span>Chat</span>
            <span className="inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[9px] font-black text-white leading-none">
                {notices.length > 99 ? '99+' : notices.length}
            </span>
        </button>
    );
}
