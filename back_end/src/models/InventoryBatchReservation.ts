import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface InventoryBatchReservationAttributes {
    id: string; // BIGINT
    order_id: string; // UUID (stored as CHAR(36))
    order_item_id: string; // BIGINT (OrderItem.id)
    product_id: string; // UUID
    batch_id: string; // BIGINT
    qty_reserved: number;
}

interface InventoryBatchReservationCreationAttributes extends Optional<InventoryBatchReservationAttributes, 'id'> { }

class InventoryBatchReservation extends Model<InventoryBatchReservationAttributes, InventoryBatchReservationCreationAttributes> implements InventoryBatchReservationAttributes {
    declare id: string;
    declare order_id: string;
    declare order_item_id: string;
    declare product_id: string;
    declare batch_id: string;
    declare qty_reserved: number;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

InventoryBatchReservation.init(
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
        order_item_id: {
            type: DataTypes.BIGINT,
            allowNull: false,
        },
        product_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        batch_id: {
            type: DataTypes.BIGINT,
            allowNull: false,
        },
        qty_reserved: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
    },
    {
        sequelize,
        tableName: 'inventory_batch_reservations',
        indexes: [
            { fields: ['order_id'] },
            { fields: ['order_item_id'] },
            { fields: ['product_id'] },
            { fields: ['batch_id'] },
            { fields: ['order_item_id', 'batch_id'], unique: true, name: 'uq_reservation_item_batch' },
        ]
    }
);

export default InventoryBatchReservation;

