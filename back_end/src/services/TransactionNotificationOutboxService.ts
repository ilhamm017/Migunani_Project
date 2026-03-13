import { Op, Transaction } from 'sequelize';
import { NotificationOutbox, sequelize } from '../models';
import { io } from '../server';
import { sendWhatsappSafe } from './WhatsappSendService';

export type AdminRefreshBadgesEventPayload = Record<string, never>;
export type OrderStatusChangedEventPayload = {
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

export type ReturStatusChangedEventPayload = {
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

export type CodSettlementUpdatedEventPayload = {
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

export type NotificationEventName =
    | 'admin:refresh_badges'
    | 'order:status_changed'
    | 'retur:status_changed'
    | 'cod:settlement_updated'
    | 'whatsapp:send';

export type NotificationPayloadByEvent = {
    'admin:refresh_badges': AdminRefreshBadgesEventPayload;
    'order:status_changed': OrderStatusChangedEventPayload;
    'retur:status_changed': ReturStatusChangedEventPayload;
    'cod:settlement_updated': CodSettlementUpdatedEventPayload;
    'whatsapp:send': WhatsappSendEventPayload;
};

export type WhatsappSendEventPayload = {
    target: string;
    text_body?: string | null;
    attachment_path?: string | null;
};

const MAX_RETRY_ATTEMPTS = Number(process.env.NOTIFICATION_OUTBOX_MAX_ATTEMPTS || 8);
const POLL_INTERVAL_MS = Number(process.env.NOTIFICATION_OUTBOX_POLL_MS || 2000);
const BATCH_LIMIT = Number(process.env.NOTIFICATION_OUTBOX_BATCH_LIMIT || 50);
let workerTimer: NodeJS.Timeout | null = null;
let isProcessing = false;
let kickScheduled = false;

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

const buildRetryDelayMs = (attempts: number): number => {
    const baseMs = Number(process.env.NOTIFICATION_OUTBOX_RETRY_BASE_MS || 2000);
    const cappedExponent = Math.min(6, Math.max(0, attempts - 1));
    return baseMs * (2 ** cappedExponent);
};

const dispatchAdminRefreshBadges = () => {
    io.emit('admin:refresh_badges');
};

const dispatchOrderStatusChanged = (payload: OrderStatusChangedEventPayload) => {
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
    dispatchAdminRefreshBadges();
};

const dispatchReturStatusChanged = (payload: ReturStatusChangedEventPayload) => {
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
    dispatchAdminRefreshBadges();
};

const dispatchCodSettlementUpdated = (payload: CodSettlementUpdatedEventPayload) => {
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
    dispatchAdminRefreshBadges();
};

const dispatchSocketNotificationEvent = (eventName: NotificationEventName, payload: Record<string, unknown> | null) => {
    switch (eventName) {
        case 'admin:refresh_badges':
            dispatchAdminRefreshBadges();
            return;
        case 'order:status_changed':
            dispatchOrderStatusChanged((payload || {}) as OrderStatusChangedEventPayload);
            return;
        case 'retur:status_changed':
            dispatchReturStatusChanged((payload || {}) as ReturStatusChangedEventPayload);
            return;
        case 'cod:settlement_updated':
            dispatchCodSettlementUpdated((payload || {}) as CodSettlementUpdatedEventPayload);
            return;
        default:
            throw new Error(`Unsupported notification event: ${eventName}`);
    }
};

const dispatchWhatsappNotificationEvent = async (payload: Record<string, unknown> | null, requestContext: string | null) => {
    const target = normalizeString(payload?.target) || '';
    const textBody = normalizeString(payload?.text_body);
    const attachmentPath = normalizeString(payload?.attachment_path);
    if (!target) {
        throw new Error('missing_whatsapp_target');
    }

    const result = await sendWhatsappSafe({
        target,
        textBody,
        attachmentPath,
        requestContext: requestContext || 'whatsapp_outbox_send'
    });

    if (result.status === 'sent' || result.status === 'skipped_no_target') {
        return;
    }

    throw new Error(result.reason || result.status || 'whatsapp_send_failed');
};

const logOutboxResult = (row: {
    id: string;
    event_name: string;
    status: string;
    attempts: number;
    request_context: string | null;
    last_error?: string | null;
}) => {
    const summary = {
        id: row.id,
        event: row.event_name,
        status: row.status,
        attempts: row.attempts,
        context: row.request_context || null,
        last_error: row.last_error || null,
    };

    if (row.status === 'delivered') {
        console.info('[NOTIF_OUTBOX]', summary);
        return;
    }

    console.warn('[NOTIF_OUTBOX]', summary);
};

const claimPendingRows = async () => {
    const transaction = await sequelize.transaction();
    try {
        const now = new Date();
        const rows = await NotificationOutbox.findAll({
            where: {
                status: { [Op.in]: ['pending', 'failed_soft'] },
                attempts: { [Op.lt]: MAX_RETRY_ATTEMPTS },
                [Op.or]: [
                    { next_retry_at: null },
                    { next_retry_at: { [Op.lte]: now } },
                ],
            },
            order: [['createdAt', 'ASC']],
            limit: BATCH_LIMIT,
            transaction,
            lock: transaction.LOCK.UPDATE,
            skipLocked: true,
        });

        if (rows.length === 0) {
            await transaction.commit();
            return [] as typeof rows;
        }

        for (const row of rows) {
            await row.update(
                {
                    status: 'processing',
                    attempts: Number(row.attempts || 0) + 1,
                    last_error: null,
                    next_retry_at: null,
                },
                { transaction }
            );
        }

        await transaction.commit();
        return rows;
    } catch (error) {
        try { await transaction.rollback(); } catch {}
        throw error;
    }
};

export const processNotificationOutboxBatch = async (): Promise<number> => {
    if (isProcessing) return 0;
    isProcessing = true;
    try {
        const rows = await claimPendingRows();
        for (const row of rows) {
            try {
                if (String(row.channel || '') === 'whatsapp') {
                    await dispatchWhatsappNotificationEvent(row.payload || null, row.request_context);
                } else {
                    dispatchSocketNotificationEvent(row.event_name as NotificationEventName, row.payload || null);
                }
                await row.update({
                    status: 'delivered',
                    delivered_at: new Date(),
                    last_error: null,
                    next_retry_at: null,
                });
                logOutboxResult({
                    id: String(row.id),
                    event_name: String(row.event_name),
                    status: 'delivered',
                    attempts: Number(row.attempts || 0),
                    request_context: row.request_context,
                });
            } catch (error) {
                const attempts = Number(row.attempts || 0);
                const lastError = error instanceof Error ? error.message : String(error);
                const exhausted = attempts >= MAX_RETRY_ATTEMPTS;
                await row.update({
                    status: 'failed_soft',
                    last_error: lastError,
                    next_retry_at: exhausted ? null : new Date(Date.now() + buildRetryDelayMs(attempts)),
                });
                logOutboxResult({
                    id: String(row.id),
                    event_name: String(row.event_name),
                    status: exhausted ? 'failed_soft_exhausted' : 'failed_soft',
                    attempts,
                    request_context: row.request_context,
                    last_error: lastError,
                });
            }
        }
        return rows.length;
    } finally {
        isProcessing = false;
    }
};

const scheduleKick = () => {
    if (kickScheduled) return;
    kickScheduled = true;
    setTimeout(async () => {
        kickScheduled = false;
        try {
            await processNotificationOutboxBatch();
        } catch (error) {
            console.error('[NOTIF_OUTBOX] kick failed:', error);
        }
    }, 25);
};

export const enqueueNotificationEvent = async <T extends NotificationEventName>(params: {
    eventName: T;
    payload?: NotificationPayloadByEvent[T] | null;
    requestContext?: string | null;
    transaction?: Transaction;
}) => {
    const created = await NotificationOutbox.create({
        channel: 'socket',
        event_name: params.eventName,
        payload: (params.payload || null) as Record<string, unknown> | null,
        status: 'pending',
        request_context: params.requestContext ? String(params.requestContext).trim() : null,
        attempts: 0,
        next_retry_at: null,
        delivered_at: null,
        last_error: null,
    }, params.transaction ? { transaction: params.transaction } : undefined);

    if (params.transaction?.afterCommit) {
        params.transaction.afterCommit(() => {
            scheduleKick();
        });
    } else {
        scheduleKick();
    }

    return created;
};

export const enqueueWhatsappNotification = async (params: {
    target: string | null | undefined;
    textBody?: string | null;
    attachmentPath?: string | null;
    requestContext?: string | null;
    transaction?: Transaction;
}) => {
    const normalizedTarget = normalizeString(params.target);
    if (!normalizedTarget) {
        return null;
    }

    const created = await NotificationOutbox.create({
        channel: 'whatsapp',
        event_name: 'whatsapp:send',
        payload: {
            target: normalizedTarget,
            text_body: normalizeString(params.textBody),
            attachment_path: normalizeString(params.attachmentPath),
        },
        status: 'pending',
        request_context: params.requestContext ? String(params.requestContext).trim() : null,
        attempts: 0,
        next_retry_at: null,
        delivered_at: null,
        last_error: null,
    }, params.transaction ? { transaction: params.transaction } : undefined);

    if (params.transaction?.afterCommit) {
        params.transaction.afterCommit(() => {
            scheduleKick();
        });
    } else {
        scheduleKick();
    }

    return created;
};

export const startNotificationOutboxWorker = () => {
    if (workerTimer) return;
    workerTimer = setInterval(() => {
        void processNotificationOutboxBatch().catch((error) => {
            console.error('[NOTIF_OUTBOX] poll failed:', error);
        });
    }, POLL_INTERVAL_MS);
    scheduleKick();
    console.log(`[NOTIF_OUTBOX] worker started poll=${POLL_INTERVAL_MS}ms batch=${BATCH_LIMIT}`);
};

export const stopNotificationOutboxWorker = () => {
    if (!workerTimer) return;
    clearInterval(workerTimer);
    workerTimer = null;
};
