import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export type NotificationOutboxChannel = 'socket' | 'whatsapp';
export type NotificationOutboxEventName =
    | 'admin:refresh_badges'
    | 'order:status_changed'
    | 'retur:status_changed'
    | 'cod:settlement_updated'
    | 'whatsapp:send';
export type NotificationOutboxStatus = 'pending' | 'processing' | 'delivered' | 'failed_soft';

interface NotificationOutboxAttributes {
    id: string;
    channel: NotificationOutboxChannel;
    event_name: NotificationOutboxEventName;
    payload: Record<string, unknown> | null;
    status: NotificationOutboxStatus;
    request_context: string | null;
    attempts: number;
    next_retry_at: Date | null;
    delivered_at: Date | null;
    last_error: string | null;
    createdAt?: Date;
    updatedAt?: Date;
}

interface NotificationOutboxCreationAttributes extends Optional<
    NotificationOutboxAttributes,
    'id' | 'payload' | 'status' | 'request_context' | 'attempts' | 'next_retry_at' | 'delivered_at' | 'last_error'
> {}

class NotificationOutbox
    extends Model<NotificationOutboxAttributes, NotificationOutboxCreationAttributes>
    implements NotificationOutboxAttributes {
    declare id: string;
    declare channel: NotificationOutboxChannel;
    declare event_name: NotificationOutboxEventName;
    declare payload: Record<string, unknown> | null;
    declare status: NotificationOutboxStatus;
    declare request_context: string | null;
    declare attempts: number;
    declare next_retry_at: Date | null;
    declare delivered_at: Date | null;
    declare last_error: string | null;
    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

NotificationOutbox.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        channel: {
            type: DataTypes.ENUM('socket', 'whatsapp'),
            allowNull: false,
            defaultValue: 'socket',
        },
        event_name: {
            type: DataTypes.ENUM(
                'admin:refresh_badges',
                'order:status_changed',
                'retur:status_changed',
                'cod:settlement_updated',
                'whatsapp:send'
            ),
            allowNull: false,
        },
        payload: {
            type: DataTypes.JSON,
            allowNull: true,
        },
        status: {
            type: DataTypes.ENUM('pending', 'processing', 'delivered', 'failed_soft'),
            allowNull: false,
            defaultValue: 'pending',
        },
        request_context: {
            type: DataTypes.STRING(191),
            allowNull: true,
        },
        attempts: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        next_retry_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        delivered_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        last_error: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'notification_outbox',
        indexes: [
            { fields: ['status', 'next_retry_at'] },
            { fields: ['event_name'] },
            { fields: ['createdAt'] },
        ]
    }
);

export default NotificationOutbox;
