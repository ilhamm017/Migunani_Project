'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { formatOrderStatusLabel, formatOrderStatusToastMessage, type OrderStatusChangedEvent } from '@/lib/orderStatusMeta';

type SupportedRole = 'super_admin' | 'admin_gudang' | 'admin_finance' | 'kasir' | 'driver';

type PriorityCard = {
  id: string;
  title: string;
  count: number;
  description: string;
};

type UseOrderStatusNotificationsParams = {
  enabled: boolean;
  role?: string | null;
  userId?: string | null;
  pollIntervalMs?: number;
};

type DashboardStats = {
  pending?: number | string;
  waiting_invoice?: number | string;
  waiting_payment?: number | string;
  delivered?: number | string;
  ready_to_ship?: number | string;
  waiting_admin_verification?: number | string;
  allocated?: number | string;
  partially_fulfilled?: number | string;
  debt_pending?: number | string;
  shipped?: number | string;
  hold?: number | string;
};

const MAX_EVENTS = 30;
const ACTIONABLE_STATUSES_BY_ROLE: Record<Exclude<SupportedRole, 'driver'>, string[]> = {
  super_admin: ['pending', 'waiting_invoice', 'ready_to_ship', 'waiting_admin_verification', 'delivered', 'allocated', 'partially_fulfilled', 'shipped', 'hold'],
  admin_gudang: ['pending', 'ready_to_ship', 'allocated', 'partially_fulfilled', 'hold'],
  admin_finance: ['waiting_invoice', 'waiting_admin_verification', 'delivered'],
  kasir: ['pending'],
};

const toNumber = (value: unknown): number => {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
};

const normalizeRole = (role?: string | null): SupportedRole | null => {
  const val = String(role || '').trim() as SupportedRole;
  if (['super_admin', 'admin_gudang', 'admin_finance', 'kasir', 'driver'].includes(val)) {
    return val;
  }
  return null;
};

const resolveOrderActionableCount = (stats: DashboardStats, role: SupportedRole): number => {
  if (role === 'admin_finance') {
    return (
      toNumber(stats.waiting_invoice) +
      toNumber(stats.waiting_admin_verification) +
      toNumber(stats.delivered)
    );
  }
  if (role === 'admin_gudang') {
    return (
      toNumber(stats.pending) +
      toNumber(stats.ready_to_ship) +
      toNumber(stats.allocated) +
      toNumber(stats.partially_fulfilled) +
      toNumber(stats.hold)
    );
  }
  if (role === 'kasir') {
    return toNumber(stats.pending);
  }
  if (role === 'super_admin') {
    return (
      toNumber(stats.pending) +
      toNumber(stats.waiting_invoice) +
      toNumber(stats.ready_to_ship) +
      toNumber(stats.waiting_admin_verification) +
      toNumber(stats.delivered) +
      toNumber(stats.allocated) +
      toNumber(stats.partially_fulfilled) +
      toNumber(stats.shipped) +
      toNumber(stats.hold)
    );
  }
  return 0;
};

const toTimestamp = (value: unknown): number => {
  const date = new Date(String(value || ''));
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : Date.now();
};

const toIsoTimestamp = (value: unknown): string => {
  const ms = toTimestamp(value);
  return new Date(ms).toISOString();
};

const isEventRelevant = (event: OrderStatusChangedEvent, role: SupportedRole, userId: string | null): boolean => {
  const targetRoles = Array.isArray(event.target_roles) ? event.target_roles : [];
  const targetUserIds = Array.isArray(event.target_user_ids) ? event.target_user_ids : [];

  if (role !== 'super_admin' && targetRoles.length > 0 && !targetRoles.includes(role)) {
    return false;
  }

  if (role === 'driver' && targetUserIds.length > 0 && userId && !targetUserIds.includes(userId)) {
    return false;
  }

  if (role === 'driver' && targetRoles.length > 0 && !targetRoles.includes('driver')) {
    return false;
  }

  return true;
};

const isActionableStatusForRole = (status: string, role: SupportedRole): boolean => {
  const normalizedStatus = String(status || '').trim();
  if (!normalizedStatus) return false;
  if (role === 'driver') return true;
  return ACTIONABLE_STATUSES_BY_ROLE[role].includes(normalizedStatus);
};

const buildPriorityCards = (role: SupportedRole, events: OrderStatusChangedEvent[], newTaskCount: number): PriorityCard[] => {
  const latestStatus = events[0]?.to_status || '';
  const latestStatusLabel = latestStatus ? formatOrderStatusLabel(latestStatus) : '-';

  if (role === 'driver') {
    return [
      {
        id: 'driver_new_tasks',
        title: 'Tugas Baru Driver',
        count: newTaskCount,
        description: latestStatus ? `Status terbaru: ${latestStatusLabel}` : 'Belum ada notifikasi baru',
      },
    ];
  }

  return [
    {
      id: 'incoming_orders',
      title: 'Notifikasi Tugas Baru',
      count: newTaskCount,
      description: latestStatus ? `Status terbaru: ${latestStatusLabel}` : 'Belum ada notifikasi baru',
    },
  ];
};

export const useOrderStatusNotifications = ({
  enabled,
  role,
  userId,
  pollIntervalMs = 15000,
}: UseOrderStatusNotificationsParams) => {
  const normalizedRole = normalizeRole(role);
  const shouldEnable = Boolean(enabled && normalizedRole);
  const normalizedUserId = String(userId || '').trim() || null;

  const lastSeenCountKey = normalizedRole ? `notif_last_seen_count_${normalizedRole}` : '';
  const lastSeenAtKey = normalizedRole ? `notif_last_seen_at_${normalizedRole}` : '';

  const [latestEvents, setLatestEvents] = useState<OrderStatusChangedEvent[]>([]);
  const [actionableCount, setActionableCount] = useState(0);
  const [lastSeenCount, setLastSeenCount] = useState(0);
  const [lastSeenAtMs, setLastSeenAtMs] = useState(0);
  const [activeToast, setActiveToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const clearToast = useCallback(() => {
    setActiveToast(null);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
  }, []);

  const showToast = useCallback((message: string) => {
    setActiveToast(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setActiveToast(null);
      toastTimerRef.current = null;
    }, 4500);
  }, []);

  const loadActionableCount = useCallback(async () => {
    if (!normalizedRole) return 0;
    if (normalizedRole === 'driver') {
      try {
        const res = await api.driver.getOrders();
        return Array.isArray(res.data) ? res.data.length : 0;
      } catch {
        return 0;
      }
    }

    try {
      const statsRes = await api.admin.orderManagement.getStats();
      const stats = (statsRes.data || {}) as DashboardStats;
      return resolveOrderActionableCount(stats, normalizedRole);
    } catch {
      return 0;
    }
  }, [normalizedRole]);

  const markSeen = useCallback(() => {
    if (!normalizedRole) return;
    setLastSeenCount(actionableCount);
    const nowIso = new Date().toISOString();
    setLastSeenAtMs(toTimestamp(nowIso));
    localStorage.setItem(lastSeenCountKey, String(actionableCount));
    localStorage.setItem(lastSeenAtKey, nowIso);
  }, [actionableCount, lastSeenAtKey, lastSeenCountKey, normalizedRole]);

  useEffect(() => {
    if (!shouldEnable || !normalizedRole) {
      setLatestEvents([]);
      setActionableCount(0);
      setLastSeenCount(0);
      setLastSeenAtMs(0);
      clearToast();
      return;
    }

    const savedSeen = Number(localStorage.getItem(lastSeenCountKey) || 'NaN');
    const hasSavedSeen = Number.isFinite(savedSeen);
    setLastSeenCount(hasSavedSeen ? savedSeen : 0);
    const savedSeenAt = localStorage.getItem(lastSeenAtKey);
    setLastSeenAtMs(savedSeenAt ? toTimestamp(savedSeenAt) : 0);

    let mounted = true;
    const bootstrap = async () => {
      const current = await loadActionableCount();
      if (!mounted) return;
      setActionableCount(current);
      if (!hasSavedSeen) {
        const nowIso = new Date().toISOString();
        setLastSeenCount(current);
        setLastSeenAtMs(toTimestamp(nowIso));
        localStorage.setItem(lastSeenCountKey, String(current));
        localStorage.setItem(lastSeenAtKey, nowIso);
      }
    };

    void bootstrap();

    const socket = getSocket();
    const onRefresh = () => {
      void loadActionableCount().then((count) => {
        if (mounted) setActionableCount(count);
      });
    };

    const onOrderChanged = (incoming: OrderStatusChangedEvent) => {
      if (!mounted || !normalizedRole) return;
      const normalizedEvent: OrderStatusChangedEvent = {
        ...incoming,
        triggered_at: toIsoTimestamp(incoming?.triggered_at),
        target_roles: Array.isArray(incoming?.target_roles) ? incoming.target_roles : [],
        target_user_ids: Array.isArray(incoming?.target_user_ids) ? incoming.target_user_ids : [],
      };
      if (!isEventRelevant(normalizedEvent, normalizedRole, normalizedUserId)) {
        return;
      }

      if (isActionableStatusForRole(normalizedEvent.to_status, normalizedRole)) {
        setLatestEvents((prev) => [normalizedEvent, ...prev].slice(0, MAX_EVENTS));
        showToast(formatOrderStatusToastMessage(normalizedEvent));
      }
      void loadActionableCount().then((count) => {
        if (mounted) setActionableCount(count);
      });
    };

    socket.on('admin:refresh_badges', onRefresh);
    socket.on('order:status_changed', onOrderChanged);

    const timer = window.setInterval(() => {
      void loadActionableCount().then((count) => {
        if (mounted) setActionableCount(count);
      });
    }, pollIntervalMs);

    const onFocus = () => {
      void loadActionableCount().then((count) => {
        if (mounted) setActionableCount(count);
      });
    };
    window.addEventListener('focus', onFocus);

    return () => {
      mounted = false;
      socket.off('admin:refresh_badges', onRefresh);
      socket.off('order:status_changed', onOrderChanged);
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      clearToast();
    };
  }, [
    clearToast,
    lastSeenAtKey,
    lastSeenCountKey,
    loadActionableCount,
    normalizedRole,
    normalizedUserId,
    pollIntervalMs,
    shouldEnable,
    showToast,
  ]);

  const newTaskCount = Math.max(0, actionableCount - lastSeenCount);
  const latestEventsSinceSeen = useMemo(
    () =>
      latestEvents.filter((event) => {
        if (!event.triggered_at) return true;
        return toTimestamp(event.triggered_at) > lastSeenAtMs;
      }),
    [lastSeenAtMs, latestEvents]
  );
  const priorityCards = useMemo(
    () => (normalizedRole ? buildPriorityCards(normalizedRole, latestEventsSinceSeen, newTaskCount) : []),
    [latestEventsSinceSeen, newTaskCount, normalizedRole]
  );

  return {
    newTaskCount,
    latestEvents: latestEventsSinceSeen,
    priorityCards,
    markSeen,
    activeToast,
    dismissToast: clearToast,
  };
};
