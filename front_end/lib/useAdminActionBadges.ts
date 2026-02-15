'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

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
  if (role === 'admin_finance') {
    return toNumber(stats.waiting_invoice) + toNumber(stats.waiting_payment) + toNumber(stats.delivered);
  }
  if (role === 'admin_gudang') {
    return toNumber(stats.pending) + toNumber(stats.ready_to_ship);
  }
  if (role === 'super_admin') {
    return toNumber(stats.pending) + toNumber(stats.waiting_invoice) + toNumber(stats.waiting_payment) + toNumber(stats.delivered);
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
    const shouldLoad = enabled && ['super_admin', 'admin_gudang', 'admin_finance'].includes(normalizedRole);

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
              verifyPayment: toNumber(stats.waiting_payment),
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
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, pollIntervalMs, role]);

  return badges;
};

