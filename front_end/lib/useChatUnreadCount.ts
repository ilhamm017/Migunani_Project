'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import getSocket from '@/lib/socket';

type UseChatUnreadCountParams = {
    enabled: boolean;
    userId?: string | null;
};

const CHAT_ENABLED_ROLES = new Set([
    'super_admin',
    'kasir',
    'admin_gudang',
    'admin_finance',
    'driver',
    'customer'
]);

export const useChatUnreadCount = ({ enabled, userId }: UseChatUnreadCountParams): number => {
    const [unreadCount, setUnreadCount] = useState(0);

    useEffect(() => {
        const currentUserId = String(userId || '').trim();
        if (!enabled || !currentUserId) {
            setUnreadCount(0);
            return;
        }

        let isMounted = true;
        const applyUnreadCount = (value: number) => {
            if (!isMounted) return;
            const normalized = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
            setUnreadCount(normalized);
        };

        const loadUnreadCount = async () => {
            try {
                const res = await api.chat.getThreads({ limit: 100 });
                const rows = Array.isArray(res.data?.threads) ? (res.data.threads as Array<{ unread_count?: number | string }>) : [];
                const total = rows.reduce((acc, row) => acc + Number(row.unread_count || 0), 0);
                applyUnreadCount(total);
            } catch (_error) {
                applyUnreadCount(0);
            }
        };

        void loadUnreadCount();

        const socket = getSocket();
        const refreshUnread = () => {
            void loadUnreadCount();
        };
        const onUnreadBadgeUpdated = (payload: { user_id?: string; total_unread?: number | string }) => {
            const payloadUserId = String(payload?.user_id || '').trim();
            if (payloadUserId && payloadUserId !== currentUserId) return;
            const nextValue = Number(payload?.total_unread ?? 0);
            if (!Number.isFinite(nextValue)) {
                refreshUnread();
                return;
            }
            applyUnreadCount(nextValue);
        };
        const onConnect = () => {
            refreshUnread();
        };
        const onFocus = () => {
            refreshUnread();
        };
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                refreshUnread();
            }
        };

        socket.on('chat:unread_badge_updated', onUnreadBadgeUpdated);
        socket.on('connect', onConnect);
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisibilityChange);

        return () => {
            isMounted = false;
            socket.off('chat:unread_badge_updated', onUnreadBadgeUpdated);
            socket.off('connect', onConnect);
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [enabled, userId]);

    return unreadCount;
};

export const canUseChatUnreadByRole = (role?: string | null): boolean => {
    const normalized = String(role || '').trim();
    return CHAT_ENABLED_ROLES.has(normalized);
};
