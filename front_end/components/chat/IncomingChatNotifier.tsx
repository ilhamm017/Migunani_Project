'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, X } from 'lucide-react';
import getSocket from '@/lib/socket';
import { useAuthStore } from '@/store/authStore';

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

    const dismissNotice = (id: string) => {
        const timeoutId = timeoutMapRef.current.get(id);
        if (typeof timeoutId === 'number') {
            window.clearTimeout(timeoutId);
            timeoutMapRef.current.delete(id);
        }
        setNotices((prev) => prev.filter((item) => item.id !== id));
    };

    const pushNotice = (notice: Omit<NoticeItem, 'id'>) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setNotices((prev) => [{ id, ...notice }, ...prev].slice(0, 3));
        const timeoutId = window.setTimeout(() => dismissNotice(id), NOTICE_TTL_MS);
        timeoutMapRef.current.set(id, timeoutId);
    };

    const maybePushBrowserNotification = (title: string, body: string, href: string) => {
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
    };

    useEffect(() => {
        return () => {
            timeoutMapRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
            timeoutMapRef.current.clear();
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
    }, [isAuthenticated, router, user?.id, user?.role]);

    if (!isAuthenticated || notices.length === 0) return null;

    return (
        <div className="fixed top-20 right-4 z-[70] w-[min(92vw,360px)] space-y-2 pointer-events-none">
            {notices.map((notice) => (
                <div
                    key={notice.id}
                    className="pointer-events-auto rounded-xl border border-emerald-200 bg-white/95 shadow-lg backdrop-blur-sm p-3"
                >
                    <div className="flex items-start gap-3">
                        <div className="h-8 w-8 shrink-0 rounded-full bg-emerald-100 text-emerald-700 inline-flex items-center justify-center">
                            <Bell size={16} />
                        </div>
                        <button
                            onClick={() => {
                                router.push(notice.href);
                                dismissNotice(notice.id);
                            }}
                            className="text-left min-w-0 flex-1"
                            type="button"
                        >
                            <p className="text-xs font-black text-slate-900 leading-tight">{notice.title}</p>
                            <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{notice.body}</p>
                        </button>
                        <button
                            type="button"
                            onClick={() => dismissNotice(notice.id)}
                            className="h-6 w-6 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100 inline-flex items-center justify-center"
                            aria-label="Tutup notifikasi"
                        >
                            <X size={13} />
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}
