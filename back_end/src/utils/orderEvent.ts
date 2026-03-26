import { Transaction } from 'sequelize';
import { OrderEvent } from '../models';

type OrderEventType =
    | 'allocation_set'
    | 'invoice_issued'
    | 'invoice_item_billed'
    | 'driver_assigned'
    | 'backorder_opened'
    | 'backorder_reallocated'
    | 'backorder_canceled'
    | 'order_item_canceled'
    | 'order_canceled'
    | 'order_pricing_adjusted'
    | 'warehouse_checked'
    | 'warehouse_handed_over'
    | 'order_status_changed';

type RecordOrderEventInput = {
    transaction?: Transaction;
    order_id: string;
    order_item_id?: string | null;
    invoice_id?: string | null;
    event_type: OrderEventType;
    payload?: unknown;
    reason?: string | null;
    actor_user_id?: string | null;
    actor_role?: string | null;
    occurred_at?: Date;
};

export const recordOrderEvent = async (input: RecordOrderEventInput) => {
    const orderId = String(input.order_id || '').trim();
    if (!orderId) return null;
    return await OrderEvent.create({
        order_id: orderId,
        order_item_id: input.order_item_id ? String(input.order_item_id) : null,
        invoice_id: input.invoice_id ? String(input.invoice_id) : null,
        event_type: input.event_type,
        payload: input.payload ?? null,
        reason: input.reason ?? null,
        actor_user_id: input.actor_user_id ? String(input.actor_user_id) : null,
        actor_role: input.actor_role ? String(input.actor_role) : null,
        occurred_at: input.occurred_at || new Date(),
    }, {
        transaction: input.transaction
    });
};

const normalizeNullableStatus = (raw: unknown): string | null => {
    if (raw === null || raw === undefined) return null;
    const val = String(raw).trim();
    if (!val) return null;
    const lowered = val.toLowerCase();
    if (['null', 'undefined', 'none', '-'].includes(lowered)) return null;
    return lowered;
};

type RecordOrderStatusChangedInput = {
    transaction?: Transaction;
    order_id: string;
    from_status: unknown;
    to_status: unknown;
    actor_user_id?: string | null;
    actor_role?: string | null;
    invoice_id?: string | null;
    reason?: string | null;
    occurred_at?: Date;
};

export const recordOrderStatusChanged = async (input: RecordOrderStatusChangedInput) => {
    const fromStatus = normalizeNullableStatus(input.from_status);
    const toStatus = normalizeNullableStatus(input.to_status);
    if (!toStatus) return null;
    if (fromStatus === toStatus) return null;

    return await recordOrderEvent({
        transaction: input.transaction,
        order_id: input.order_id,
        invoice_id: input.invoice_id ?? null,
        event_type: 'order_status_changed',
        actor_user_id: input.actor_user_id ?? null,
        actor_role: input.actor_role ?? null,
        reason: input.reason ?? null,
        occurred_at: input.occurred_at,
        payload: {
            before: { status: fromStatus },
            after: { status: toStatus },
            delta: { status_changed: true },
        },
    });
};
