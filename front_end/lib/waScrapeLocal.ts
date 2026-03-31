'use client';

export type WaScrapeOrderRecord = {
  order_id: string;
  created_at_ms: number;
  message_ids?: string[];
  item_keys?: string[];
};

export type WaScrapeOrderedCustomer =
  | WaScrapeOrderRecord
  | {
      orders: WaScrapeOrderRecord[];
    };

export type WaScrapeOrderedMap = Record<string, WaScrapeOrderedCustomer>;

export const buildWaScrapeOrderedScopeKey = (params: {
  groupId?: string;
  dateFrom?: string;
  dateTo?: string;
  timezone?: string;
  sessionIdFallback?: string;
}) => {
  const groupId = String(params.groupId || '').trim();
  const dateFrom = String(params.dateFrom || '').trim();
  const dateTo = String(params.dateTo || '').trim();
  const timezone = String(params.timezone || '').trim() || 'Asia/Jakarta';

  if (groupId && dateFrom && dateTo) {
    return `group:${groupId}|${dateFrom}|${dateTo}|${timezone}`;
  }
  const sessionId = String(params.sessionIdFallback || '').trim();
  if (sessionId) return `session:${sessionId}`;
  return '';
};

const storageKey = (scopeKey: string) => `wa_scrape_ordered:${encodeURIComponent(String(scopeKey || '').trim())}`;
const legacyStorageKey = (sessionId: string) => `wa_scrape_ordered:${String(sessionId || '').trim()}`;

const readMapSafe = (key: string): WaScrapeOrderedMap => {
  if (typeof window === 'undefined') return {};
  if (!key || key.endsWith(':')) return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as WaScrapeOrderedMap;
  } catch {
    return {};
  }
};

const asOrderRecord = (value: unknown): WaScrapeOrderRecord | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Partial<WaScrapeOrderRecord>;
  const orderId = String(rec.order_id || '').trim();
  const createdAtMs = Number(rec.created_at_ms || 0);
  if (!orderId) return null;
  return {
    order_id: orderId,
    created_at_ms: Number.isFinite(createdAtMs) && createdAtMs > 0 ? createdAtMs : 0,
    message_ids: Array.isArray(rec.message_ids)
      ? Array.from(new Set(rec.message_ids.map((v) => String(v || '').trim()).filter(Boolean)))
      : undefined,
    item_keys: Array.isArray(rec.item_keys)
      ? Array.from(new Set(rec.item_keys.map((v) => String(v || '').trim()).filter(Boolean)))
      : undefined,
  };
};

export const listWaScrapeCustomerOrders = (map: WaScrapeOrderedMap, customerKey: string): WaScrapeOrderRecord[] => {
  const key = String(customerKey || '').trim();
  if (!key) return [];
  const raw = (map || {})[key] as unknown;
  if (!raw) return [];

  if (typeof raw === 'object' && raw && !Array.isArray(raw) && 'orders' in (raw as Record<string, unknown>)) {
    const ordersRaw = (raw as { orders?: unknown }).orders;
    const orders = Array.isArray(ordersRaw) ? ordersRaw.map(asOrderRecord).filter(Boolean) as WaScrapeOrderRecord[] : [];
    return orders.sort((a, b) => (Number(b.created_at_ms || 0) - Number(a.created_at_ms || 0)));
  }

  const single = asOrderRecord(raw);
  return single ? [single] : [];
};

export const getWaScrapeCustomerProcessedMessageIds = (orders: WaScrapeOrderRecord[]): Set<string> => {
  const out = new Set<string>();
  for (const o of orders || []) {
    for (const id of o.message_ids || []) {
      const mid = String(id || '').trim();
      if (mid) out.add(mid);
    }
  }
  return out;
};

export const getWaScrapeCustomerProcessedItemKeys = (orders: WaScrapeOrderRecord[]): Set<string> => {
  const out = new Set<string>();
  for (const o of orders || []) {
    for (const key of o.item_keys || []) {
      const k = String(key || '').trim();
      if (k) out.add(k);
    }
  }
  return out;
};

export const getWaScrapeOrderedMap = (params: { scopeKey?: string; legacySessionId?: string }): WaScrapeOrderedMap => {
  const merged: WaScrapeOrderedMap = {};
  const scopeKey = String(params.scopeKey || '').trim();
  if (scopeKey) Object.assign(merged, readMapSafe(storageKey(scopeKey)));
  const legacySessionId = String(params.legacySessionId || '').trim();
  if (legacySessionId) Object.assign(merged, readMapSafe(legacyStorageKey(legacySessionId)));
  return merged;
};

export const markWaScrapeCustomerOrdered = (params: {
  scopeKey?: string;
  legacySessionId?: string;
  customerKey: string;
  orderId: string;
  messageIds?: string[];
  itemKeys?: string[];
}) => {
  if (typeof window === 'undefined') return;
  const scopeKey = String(params.scopeKey || '').trim();
  const legacySessionId = String(params.legacySessionId || '').trim();
  const keysToWrite = [
    ...(scopeKey ? [storageKey(scopeKey)] : []),
    ...(legacySessionId ? [legacyStorageKey(legacySessionId)] : []),
  ].filter(Boolean);
  if (keysToWrite.length === 0) return;

  const customerKey = String(params.customerKey || '').trim();
  const orderId = String(params.orderId || '').trim();
  if (!customerKey || !orderId) return;

  const messageIds = Array.isArray(params.messageIds)
    ? Array.from(new Set(params.messageIds.map((v) => String(v || '').trim()).filter(Boolean)))
    : [];
  const itemKeys = Array.isArray(params.itemKeys)
    ? Array.from(new Set(params.itemKeys.map((v) => String(v || '').trim()).filter(Boolean)))
    : [];

  const nextRecord: WaScrapeOrderRecord = {
    order_id: orderId,
    created_at_ms: Date.now(),
    ...(messageIds.length > 0 ? { message_ids: messageIds } : {}),
    ...(itemKeys.length > 0 ? { item_keys: itemKeys } : {}),
  };

  for (const key of keysToWrite) {
    if (!key || key.endsWith(':')) continue;
    const existing = readMapSafe(key);
    const currentOrders = listWaScrapeCustomerOrders(existing, customerKey);
    const mergedOrders = [
      nextRecord,
      ...currentOrders.filter((o) => String(o.order_id || '').trim() !== orderId),
    ].sort((a, b) => (Number(b.created_at_ms || 0) - Number(a.created_at_ms || 0)));
    const next: WaScrapeOrderedMap = { ...existing, [customerKey]: { orders: mergedOrders } };

    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // ignore quota errors
    }
  }
};
