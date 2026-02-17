import { io } from '../server';

type OrderStatusChangedEventPayload = {
    order_id: string;
    from_status: string | null;
    to_status: string;
    source?: string | null;
    payment_method?: string | null;
    courier_id?: string | null;
    triggered_by_role?: string | null;
    triggered_at?: string;
    target_roles?: string[];
    target_user_ids?: string[];
};

type ReturStatusChangedEventPayload = {
    retur_id: string;
    order_id: string;
    from_status: string | null;
    to_status: string;
    courier_id?: string | null;
    triggered_by_role?: string | null;
    triggered_at?: string;
    target_roles?: string[];
    target_user_ids?: string[];
};

type CodSettlementUpdatedEventPayload = {
    driver_id: string;
    order_ids?: string[];
    invoice_ids?: string[];
    total_expected?: number;
    amount_received?: number;
    driver_debt_before?: number;
    driver_debt_after?: number;
    settled_at?: string;
    triggered_by_role?: string | null;
    target_roles?: string[];
    target_user_ids?: string[];
};

const normalizeString = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
};

const normalizeStringArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => normalizeString(item))
        .filter((item): item is string => Boolean(item));
};

const normalizeNumber = (value: unknown): number | null => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

export const emitAdminRefreshBadges = () => {
    io.emit('admin:refresh_badges');
};

export const emitOrderStatusChanged = (payload: OrderStatusChangedEventPayload) => {
    const normalizedPayload = {
        order_id: String(payload.order_id),
        from_status: normalizeString(payload.from_status),
        to_status: String(payload.to_status),
        source: normalizeString(payload.source),
        payment_method: normalizeString(payload.payment_method),
        courier_id: normalizeString(payload.courier_id),
        triggered_by_role: normalizeString(payload.triggered_by_role),
        triggered_at: normalizeString(payload.triggered_at) || new Date().toISOString(),
        target_roles: normalizeStringArray(payload.target_roles),
        target_user_ids: normalizeStringArray(payload.target_user_ids),
    };

    io.emit('order:status_changed', normalizedPayload);
    io.emit('admin:refresh_badges');
};

export const emitReturStatusChanged = (payload: ReturStatusChangedEventPayload) => {
    const normalizedPayload = {
        retur_id: String(payload.retur_id),
        order_id: String(payload.order_id),
        from_status: normalizeString(payload.from_status),
        to_status: String(payload.to_status),
        courier_id: normalizeString(payload.courier_id),
        triggered_by_role: normalizeString(payload.triggered_by_role),
        triggered_at: normalizeString(payload.triggered_at) || new Date().toISOString(),
        target_roles: normalizeStringArray(payload.target_roles),
        target_user_ids: normalizeStringArray(payload.target_user_ids),
    };

    io.emit('retur:status_changed', normalizedPayload);
    io.emit('admin:refresh_badges');
};

export const emitCodSettlementUpdated = (payload: CodSettlementUpdatedEventPayload) => {
    const normalizedPayload = {
        driver_id: String(payload.driver_id),
        order_ids: normalizeStringArray(payload.order_ids),
        invoice_ids: normalizeStringArray(payload.invoice_ids),
        total_expected: normalizeNumber(payload.total_expected),
        amount_received: normalizeNumber(payload.amount_received),
        driver_debt_before: normalizeNumber(payload.driver_debt_before),
        driver_debt_after: normalizeNumber(payload.driver_debt_after),
        settled_at: normalizeString(payload.settled_at) || new Date().toISOString(),
        triggered_by_role: normalizeString(payload.triggered_by_role),
        target_roles: normalizeStringArray(payload.target_roles),
        target_user_ids: normalizeStringArray(payload.target_user_ids),
    };

    io.emit('cod:settlement_updated', normalizedPayload);
    io.emit('admin:refresh_badges');
};

export type {
    OrderStatusChangedEventPayload,
    ReturStatusChangedEventPayload,
    CodSettlementUpdatedEventPayload
};
