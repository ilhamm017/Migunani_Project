import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface PurchaseOrderItemAttributes {
    id: string; // BigInt
    purchase_order_id: string; // UUID
    product_id: string; // UUID
    qty: number;
    unit_cost: number;
    total_cost: number;
    received_qty: number;
}

interface PurchaseOrderItemCreationAttributes extends Optional<PurchaseOrderItemAttributes, 'id' | 'received_qty'> { }

class PurchaseOrderItem extends Model<PurchaseOrderItemAttributes, PurchaseOrderItemCreationAttributes> implements PurchaseOrderItemAttributes {
    declare id: string;
    declare purchase_order_id: string;
    declare product_id: string;
    declare qty: number;
    declare unit_cost: number;
    declare total_cost: number;
    declare received_qty: number;

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
        },
        product_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        qty: {
            type: DataTypes.INTEGER,
            allowNull: false,
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
    },
    {
        sequelize,
        tableName: 'purchase_order_items',
    }
);

export default PurchaseOrderItem;
