import {
    enqueueNotificationEvent,
    type CodSettlementUpdatedEventPayload,
    type OrderStatusChangedEventPayload,
    type ReturStatusChangedEventPayload,
} from '../services/TransactionNotificationOutboxService';
import { Transaction } from 'sequelize';

type NotificationEmitOptions = {
    transaction?: Transaction;
    requestContext?: string | null;
};

export const emitAdminRefreshBadges = async (options?: NotificationEmitOptions) => {
    await enqueueNotificationEvent({
        eventName: 'admin:refresh_badges',
        payload: {},
        requestContext: options?.requestContext || 'admin_refresh_badges',
        transaction: options?.transaction,
    });
};

export const emitOrderStatusChanged = async (payload: OrderStatusChangedEventPayload, options?: NotificationEmitOptions) => {
    await enqueueNotificationEvent({
        eventName: 'order:status_changed',
        payload,
        requestContext: options?.requestContext || 'order_status_changed',
        transaction: options?.transaction,
    });
};

export const emitReturStatusChanged = async (payload: ReturStatusChangedEventPayload, options?: NotificationEmitOptions) => {
    await enqueueNotificationEvent({
        eventName: 'retur:status_changed',
        payload,
        requestContext: options?.requestContext || 'retur_status_changed',
        transaction: options?.transaction,
    });
};

export const emitCodSettlementUpdated = async (payload: CodSettlementUpdatedEventPayload, options?: NotificationEmitOptions) => {
    await enqueueNotificationEvent({
        eventName: 'cod:settlement_updated',
        payload,
        requestContext: options?.requestContext || 'cod_settlement_updated',
        transaction: options?.transaction,
    });
};

export type {
    OrderStatusChangedEventPayload,
    ReturStatusChangedEventPayload,
    CodSettlementUpdatedEventPayload
};
