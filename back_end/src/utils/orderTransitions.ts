const LEGACY_STATUS_ALIAS: Record<string, string> = {
    waiting_payment: 'ready_to_ship',
};

const warnedLegacyStatusContexts = new Set<string>();

const toStatusString = (statusRaw: unknown): string => String(statusRaw || '').trim().toLowerCase();

const warnLegacyAliasUsage = (legacyStatus: string, canonicalStatus: string, context: string) => {
    const key = `${context}:${legacyStatus}->${canonicalStatus}`;
    if (warnedLegacyStatusContexts.has(key)) return;
    warnedLegacyStatusContexts.add(key);
    console.warn(`[OrderStatusLegacy] ${context}: '${legacyStatus}' treated as legacy alias for '${canonicalStatus}'.`);
};

export const isLegacyOrderStatusAlias = (statusRaw: unknown): boolean => {
    const status = toStatusString(statusRaw);
    return Boolean(status && LEGACY_STATUS_ALIAS[status]);
};

export const resolveLegacyOrderStatusAlias = (statusRaw: unknown, context = 'order_status_boundary'): string => {
    const status = toStatusString(statusRaw);
    if (!status) return '';
    const canonicalStatus = LEGACY_STATUS_ALIAS[status];
    if (!canonicalStatus) return status;
    warnLegacyAliasUsage(status, canonicalStatus, context);
    return canonicalStatus;
};

const ALLOWED_ORDER_TRANSITIONS: Record<string, Set<string>> = {
    pending: new Set(['waiting_invoice', 'waiting_admin_verification', 'hold', 'canceled']),
    waiting_invoice: new Set(['ready_to_ship', 'waiting_admin_verification', 'hold', 'canceled']),
    ready_to_ship: new Set(['shipped', 'completed', 'partially_fulfilled', 'waiting_admin_verification', 'hold', 'canceled']),
    hold: new Set(['waiting_invoice', 'ready_to_ship', 'waiting_admin_verification', 'shipped', 'canceled']),
    shipped: new Set(['delivered', 'completed', 'partially_fulfilled', 'hold', 'canceled']),
    delivered: new Set(['completed', 'hold', 'canceled']),
    partially_fulfilled: new Set(['waiting_invoice', 'completed', 'hold', 'canceled']),
    waiting_admin_verification: new Set(['ready_to_ship', 'completed', 'hold', 'canceled']),
    allocated: new Set(['waiting_invoice', 'waiting_admin_verification', 'hold', 'canceled']),
    debt_pending: new Set(['waiting_invoice', 'hold', 'canceled']),
    completed: new Set(['waiting_invoice']),
    canceled: new Set([]),
    expired: new Set([]),
};

export const normalizeOrderStatus = (statusRaw: unknown): string => {
    return toStatusString(statusRaw);
};

export const isOrderTransitionAllowed = (fromStatusRaw: unknown, toStatusRaw: unknown): boolean => {
    const fromStatus = toStatusString(fromStatusRaw);
    const toStatus = toStatusString(toStatusRaw);
    if (!toStatus || !fromStatus) return false;
    if (fromStatus === toStatus) return true;
    const allowedTargets = ALLOWED_ORDER_TRANSITIONS[fromStatus];
    if (!allowedTargets) return false;
    return allowedTargets.has(toStatus);
};
