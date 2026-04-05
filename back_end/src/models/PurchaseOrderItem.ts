import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface PurchaseOrderItemAttributes {
    id: string; // BigInt
    purchase_order_id: string; // UUID
    product_id: string; // UUID
    qty: number;
    expected_unit_cost?: number | null;
    unit_cost: number;
    total_cost: number;
    received_qty: number;
    cost_note?: string | null;
}

interface PurchaseOrderItemCreationAttributes extends Optional<PurchaseOrderItemAttributes, 'id' | 'received_qty' | 'expected_unit_cost' | 'cost_note'> { }

class PurchaseOrderItem extends Model<PurchaseOrderItemAttributes, PurchaseOrderItemCreationAttributes> implements PurchaseOrderItemAttributes {
    declare id: string;
    declare purchase_order_id: string;
    declare product_id: string;
    declare qty: number;
    declare expected_unit_cost: number | null;
    declare unit_cost: number;
    declare total_cost: number;
    declare received_qty: number;
    declare cost_note: string | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

PurchaseOrderItem.init(
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        purchase_order_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'purchase_orders',
                key: 'id',
            },
        },
        product_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'products',
                key: 'id',
            },
        },
        qty: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        expected_unit_cost: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: true,
            defaultValue: null,
        },
        unit_cost: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
        },
        total_cost: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
        },
        received_qty: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
            allowNull: false,
        },
        cost_note: {
            type: DataTypes.TEXT,
            allowNull: true,
            defaultValue: null,
        },
    },
    {
        sequelize,
        tableName: 'purchase_order_items',
        indexes: [
            { name: 'idx_purchase_order_items_purchase_order_id', fields: ['purchase_order_id'] },
            { name: 'idx_purchase_order_items_product_id', fields: ['product_id'] },
        ],
    }
);

export default PurchaseOrderItem;
