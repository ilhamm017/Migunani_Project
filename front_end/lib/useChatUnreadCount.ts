'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import getSocket from '@/lib/socket';

type UseChatUnreadCountParams = {
    enabled: boolean;
};

const CHAT_ENABLED_ROLES = new Set([
    'super_admin',
    'kasir',
    'admin_gudang',
    'admin_finance',
    'driver',
    'customer'
]);

export const useChatUnreadCount = ({ enabled }: UseChatUnreadCountParams): number => {
    const [unreadCount, setUnreadCount] = useState(0);

    useEffect(() => {
        if (!enabled) {
            setUnreadCount(0);
            return;
        }

        let isMounted = true;

        const loadUnreadCount = async () => {
            try {
                const res = await api.chat.getThreads({ limit: 100 });
                const rows = Array.isArray(res.data?.threads) ? (res.data.threads as Array<{ unread_count?: number | string }>) : [];
                const total = rows.reduce((acc, row) => acc + Number(row.unread_count || 0), 0);
                if (isMounted) {
                    setUnreadCount(total);
                }
            } catch (_error) {
                if (isMounted) {
                    setUnreadCount(0);
                }
            }
        };

        void loadUnreadCount();

        const socket = getSocket();
        const refreshUnread = () => {
            void loadUnreadCount();
        };

        socket.on('chat:message', refreshUnread);
        socket.on('chat:thread_message', refreshUnread);
        socket.on('chat:thread_read', refreshUnread);
        socket.on('chat:status', refreshUnread);

        const timer = window.setInterval(() => {
            void loadUnreadCount();
        }, 15000);

        return () => {
            isMounted = false;
            window.clearInterval(timer);
            socket.off('chat:message', refreshUnread);
            socket.off('chat:thread_message', refreshUnread);
            socket.off('chat:thread_read', refreshUnread);
            socket.off('chat:status', refreshUnread);
        };
    }, [enabled]);

    return unreadCount;
};

export const canUseChatUnreadByRole = (role?: string | null): boolean => {
    const normalized = String(role || '').trim();
    return CHAT_ENABLED_ROLES.has(normalized);
};
