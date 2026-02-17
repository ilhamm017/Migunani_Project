'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';


type UseAdminActionBadgesParams = {
  enabled: boolean;
  role?: string | null;
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
  completed?: number | string;
  canceled?: number | string;
  expired?: number | string;
};

type FinanceCardBadges = {
  verifyPayment: number;
  codSettlement: number;
  refundRetur: number;
};

type AdminActionBadges = {
  orderBadgeCount: number;
  financeCardBadges: FinanceCardBadges;
};

const ZERO_FINANCE_BADGES: FinanceCardBadges = {
  verifyPayment: 0,
  codSettlement: 0,
  refundRetur: 0,
};

const ZERO_BADGES: AdminActionBadges = {
  orderBadgeCount: 0,
  financeCardBadges: ZERO_FINANCE_BADGES,
};

const toNumber = (value: unknown): number => {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
};

const resolveOrderBadgeCount = (stats: DashboardStats, role: string): number => {
  // Finance cares about invoices to issue, payments to verify, and deliveries to complete
  if (role === 'admin_finance') {
    return (
      toNumber(stats.waiting_invoice) +
      toNumber(stats.waiting_admin_verification) +
      toNumber(stats.delivered) +
      toNumber(stats.debt_pending)
    );
  }
  // Gudang cares about new orders to pick and ready items to ship
  if (role === 'admin_gudang') {
    return (
      toNumber(stats.pending) +
      toNumber(stats.ready_to_ship) +
      toNumber(stats.allocated) +
      toNumber(stats.partially_fulfilled)
    );
  }
  // Kasir/Admin is responsible for initial allocation
  if (role === 'kasir') {
    return toNumber(stats.pending) + toNumber(stats.waiting_payment);
  }
  // Super Admin sees everything that requires action
  if (role === 'super_admin') {
    return (
      toNumber(stats.pending) +
      toNumber(stats.waiting_invoice) +
      toNumber(stats.waiting_payment) +
      toNumber(stats.ready_to_ship) +
      toNumber(stats.waiting_admin_verification) +
      toNumber(stats.delivered) +
      toNumber(stats.allocated) +
      toNumber(stats.partially_fulfilled) +
      toNumber(stats.debt_pending) +
      toNumber(stats.shipped) +
      toNumber(stats.hold)
    );
  }
  return 0;
};

const countPendingCodSettlements = (rows: unknown): number => {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((acc, item) => {
    const orders = Array.isArray((item as { orders?: unknown[] })?.orders) ? (item as { orders: unknown[] }).orders : [];
    return acc + orders.length;
  }, 0);
};

const isReturNeedsFinanceAction = (row: any): boolean => {
  const status = String(row?.status || '').trim();
  if (!status) return false;
  if (status === 'pending' || status === 'rejected') return false;
  if (row?.refund_disbursed_at) return false;
  return ['approved', 'pickup_assigned', 'picked_up', 'handed_to_warehouse', 'received', 'completed'].includes(status);
};

const countPendingReturRefunds = (rows: unknown): number => {
  if (!Array.isArray(rows)) return 0;
  return rows.filter((row) => isReturNeedsFinanceAction(row)).length;
};

export const useAdminActionBadges = ({
  enabled,
  role,
  pollIntervalMs = 15000,
}: UseAdminActionBadgesParams): AdminActionBadges => {
  const [badges, setBadges] = useState<AdminActionBadges>(ZERO_BADGES);

  useEffect(() => {
    const normalizedRole = String(role || '').trim();
    const shouldLoad = enabled && ['super_admin', 'admin_gudang', 'admin_finance', 'kasir'].includes(normalizedRole);

    if (!shouldLoad) {
      setBadges(ZERO_BADGES);
      return;
    }

    let isMounted = true;

    const loadBadges = async () => {
      const statsPromise = api.admin.orderManagement
        .getStats()
        .then((res) => (res.data || {}) as DashboardStats)
        .catch(() => ({} as DashboardStats));

      const needFinanceCounts = normalizedRole === 'admin_finance';
      const codPromise = needFinanceCounts
        ? api.admin.finance.getDriverCodList().then((res) => res.data).catch(() => [])
        : Promise.resolve([]);
      const returPromise = needFinanceCounts
        ? api.retur.getAll().then((res) => res.data).catch(() => [])
        : Promise.resolve([]);

      const [stats, codRows, returRows] = await Promise.all([statsPromise, codPromise, returPromise]);

      const nextBadges: AdminActionBadges = {
        orderBadgeCount: resolveOrderBadgeCount(stats, normalizedRole),
        financeCardBadges: needFinanceCounts
          ? {
            verifyPayment: toNumber(stats.waiting_admin_verification),
            codSettlement: countPendingCodSettlements(codRows),
            refundRetur: countPendingReturRefunds(returRows),
          }
          : ZERO_FINANCE_BADGES,
      };

      if (isMounted) {
        setBadges(nextBadges);
      }
    };


    void loadBadges();

    // Socket.io Real-time integration
    const socket = getSocket();
    const onSocketRefresh = () => {
      console.log('[Socket] Refreshing badges due to admin:refresh_badges');
      void loadBadges();
    };

    socket.on('admin:refresh_badges', onSocketRefresh);

    const timer = window.setInterval(() => {
      void loadBadges();
    }, pollIntervalMs);

    const onFocus = () => {
      void loadBadges();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void loadBadges();
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      isMounted = false;
      socket.off('admin:refresh_badges', onSocketRefresh);
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, pollIntervalMs, role]);

  return badges;
};

