import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface OrderItemAttributes {
    id: string; // BigInt
    order_id: string; // UUID
    product_id: string; // UUID
    qty: number;
    ordered_qty_original: number;
    qty_canceled_backorder: number;
    price_at_purchase: number;
    cost_at_purchase: number;
    pricing_snapshot: unknown | null;
}

interface OrderItemCreationAttributes extends Optional<OrderItemAttributes, 'id'> { }

class OrderItem extends Model<OrderItemAttributes, OrderItemCreationAttributes> implements OrderItemAttributes {
    declare id: string;
    declare order_id: string;
    declare product_id: string;
    declare qty: number;
    declare ordered_qty_original: number;
    declare qty_canceled_backorder: number;
    declare price_at_purchase: number;
    declare cost_at_purchase: number;
    declare pricing_snapshot: unknown | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

OrderItem.init(
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        order_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        product_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        qty: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        ordered_qty_original: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        qty_canceled_backorder: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        price_at_purchase: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
        },
        cost_at_purchase: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
        },
        pricing_snapshot: {
            type: DataTypes.JSON,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'order_items',
    }
);

export default OrderItem;
