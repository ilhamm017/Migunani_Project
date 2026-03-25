import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface OrderEventAttributes {
    id: string;
    order_id: string;
    order_item_id?: string | null;
    invoice_id?: string | null;
    event_type:
    | 'allocation_set'
    | 'invoice_issued'
    | 'invoice_item_billed'
    | 'backorder_opened'
    | 'backorder_reallocated'
    | 'backorder_canceled'
    | 'order_pricing_adjusted'
    | 'order_status_changed';
    payload: unknown | null;
    reason?: string | null;
    actor_user_id?: string | null;
    actor_role?: string | null;
    occurred_at: Date;
}

interface OrderEventCreationAttributes extends Optional<OrderEventAttributes, 'id' | 'order_item_id' | 'invoice_id' | 'payload' | 'reason' | 'actor_user_id' | 'actor_role' | 'occurred_at'> { }

class OrderEvent extends Model<OrderEventAttributes, OrderEventCreationAttributes> implements OrderEventAttributes {
    declare id: string;
    declare order_id: string;
    declare order_item_id: string | null;
    declare invoice_id: string | null;
    declare event_type:
    | 'allocation_set'
    | 'invoice_issued'
    | 'invoice_item_billed'
    | 'backorder_opened'
    | 'backorder_reallocated'
    | 'backorder_canceled'
    | 'order_pricing_adjusted'
    | 'order_status_changed';
    declare payload: unknown | null;
    declare reason: string | null;
    declare actor_user_id: string | null;
    declare actor_role: string | null;
    declare occurred_at: Date;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

OrderEvent.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        order_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        order_item_id: {
            type: DataTypes.BIGINT,
            allowNull: true,
        },
        invoice_id: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        event_type: {
            type: DataTypes.ENUM(
                'allocation_set',
                'invoice_issued',
                'invoice_item_billed',
                'backorder_opened',
                'backorder_reallocated',
                'backorder_canceled',
                'order_pricing_adjusted',
                'order_status_changed'
            ),
            allowNull: false,
        },
        payload: {
            type: DataTypes.JSON,
            allowNull: true,
        },
        reason: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        actor_user_id: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        actor_role: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        occurred_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
        },
    },
    {
        sequelize,
        tableName: 'order_events',
        indexes: [
            { fields: ['order_id'] },
            { fields: ['order_item_id'] },
            { fields: ['invoice_id'] },
            { fields: ['event_type'] },
            { fields: ['occurred_at'] },
        ],
    }
);

export default OrderEvent;
