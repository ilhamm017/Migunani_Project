'use client';

import { useEffect, useMemo, useRef } from 'react';
import { getSocket } from '@/lib/socket';
import type { CodSettlementUpdatedEvent, OrderStatusChangedEvent, ReturStatusChangedEvent } from '@/lib/notificationEvents';

type RealtimeDomain = 'order' | 'retur' | 'cod' | 'admin';

type UseRealtimeRefreshParams = {
  enabled: boolean;
  onRefresh: () => void | Promise<void>;
  domains?: RealtimeDomain[];
  debounceMs?: number;
  pollIntervalMs?: number;
  refreshOnFocus?: boolean;
  refreshOnVisibility?: boolean;
  filterOrderIds?: string[];
  filterReturIds?: string[];
  filterDriverIds?: string[];
};

const normalizeStringSet = (values?: string[]): Set<string> => {
  if (!Array.isArray(values)) return new Set<string>();
  return new Set(
    values
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  );
};

const normalizeStringKey = (values?: string[]): string => {
  if (!Array.isArray(values) || values.length === 0) return '';
  return Array.from(
    new Set(
      values
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  )
    .sort()
    .join('|');
};

const hasIntersection = (candidate: string[] | undefined, target: Set<string>): boolean => {
  if (!candidate?.length || target.size === 0) return false;
  return candidate.some((item) => target.has(String(item || '').trim()));
};

export const useRealtimeRefresh = ({
  enabled,
  onRefresh,
  domains = ['admin'],
  debounceMs = 250,
  pollIntervalMs = 15000,
  refreshOnFocus = true,
  refreshOnVisibility = true,
  filterOrderIds,
  filterReturIds,
  filterDriverIds,
}: UseRealtimeRefreshParams) => {
  const onRefreshRef = useRef(onRefresh);
  const debounceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  const domainsKey = normalizeStringKey(domains);
  const orderIdsKey = normalizeStringKey(filterOrderIds);
  const returIdsKey = normalizeStringKey(filterReturIds);
  const driverIdsKey = normalizeStringKey(filterDriverIds);

  const activeDomains = useMemo(
    () => new Set(domainsKey ? domainsKey.split('|') : []),
    [domainsKey]
  );
  const orderIdSet = useMemo(
    () => normalizeStringSet(orderIdsKey ? orderIdsKey.split('|') : []),
    [orderIdsKey]
  );
  const returIdSet = useMemo(
    () => normalizeStringSet(returIdsKey ? returIdsKey.split('|') : []),
    [returIdsKey]
  );
  const driverIdSet = useMemo(
    () => normalizeStringSet(driverIdsKey ? driverIdsKey.split('|') : []),
    [driverIdsKey]
  );

  useEffect(() => {
    if (!enabled) return;

    const runRefresh = () => {
      void onRefreshRef.current();
    };

    const queueRefresh = () => {
      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(() => {
        debounceTimerRef.current = null;
        runRefresh();
      }, debounceMs);
    };

    const shouldRefreshOnOrder = (payload: OrderStatusChangedEvent) => {
      if (orderIdSet.size === 0) return true;
      return orderIdSet.has(String(payload?.order_id || '').trim());
    };

    const shouldRefreshOnRetur = (payload: ReturStatusChangedEvent) => {
      if (returIdSet.size === 0 && orderIdSet.size === 0) return true;
      const returId = String(payload?.retur_id || '').trim();
      const orderId = String(payload?.order_id || '').trim();
      return returIdSet.has(returId) || orderIdSet.has(orderId);
    };

    const shouldRefreshOnCod = (payload: CodSettlementUpdatedEvent) => {
      if (driverIdSet.size === 0 && orderIdSet.size === 0) return true;
      const driverId = String(payload?.driver_id || '').trim();
      return driverIdSet.has(driverId) || hasIntersection(payload?.order_ids, orderIdSet);
    };

    const socket = getSocket();
    const onOrderChanged = (payload: OrderStatusChangedEvent) => {
      if (!activeDomains.has('order')) return;
      if (!shouldRefreshOnOrder(payload)) return;
      queueRefresh();
    };
    const onReturChanged = (payload: ReturStatusChangedEvent) => {
      if (!activeDomains.has('retur')) return;
      if (!shouldRefreshOnRetur(payload)) return;
      queueRefresh();
    };
    const onCodUpdated = (payload: CodSettlementUpdatedEvent) => {
      if (!activeDomains.has('cod')) return;
      if (!shouldRefreshOnCod(payload)) return;
      queueRefresh();
    };
    const onAdminRefresh = () => {
      if (!activeDomains.has('admin')) return;
      queueRefresh();
    };

    socket.on('order:status_changed', onOrderChanged);
    socket.on('retur:status_changed', onReturChanged);
    socket.on('cod:settlement_updated', onCodUpdated);
    socket.on('admin:refresh_badges', onAdminRefresh);

    runRefresh();

    const pollTimer = pollIntervalMs > 0
      ? window.setInterval(() => {
        runRefresh();
      }, pollIntervalMs)
      : null;

    const onFocus = () => {
      if (refreshOnFocus) runRefresh();
    };
    const onVisibilityChange = () => {
      if (refreshOnVisibility && document.visibilityState === 'visible') {
        runRefresh();
      }
    };
    if (refreshOnFocus) window.addEventListener('focus', onFocus);
    if (refreshOnVisibility) document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      socket.off('order:status_changed', onOrderChanged);
      socket.off('retur:status_changed', onReturChanged);
      socket.off('cod:settlement_updated', onCodUpdated);
      socket.off('admin:refresh_badges', onAdminRefresh);

      if (pollTimer) window.clearInterval(pollTimer);
      if (refreshOnFocus) window.removeEventListener('focus', onFocus);
      if (refreshOnVisibility) document.removeEventListener('visibilitychange', onVisibilityChange);

      if (debounceTimerRef.current) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [
    activeDomains,
    debounceMs,
    driverIdSet,
    enabled,
    orderIdSet,
    pollIntervalMs,
    refreshOnFocus,
    refreshOnVisibility,
    returIdSet,
  ]);
};
