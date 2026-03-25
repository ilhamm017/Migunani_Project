import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export type DeliveryHandoverItemCondition = 'ok' | 'damaged' | 'missing';

interface DeliveryHandoverItemAttributes {
    id: number;
    handover_id: number; // BIGINT (DeliveryHandover.id)
    product_id: string; // UUID
    qty_expected: number;
    qty_checked: number;
    condition: DeliveryHandoverItemCondition;
    note: string | null;
}

interface DeliveryHandoverItemCreationAttributes extends Optional<DeliveryHandoverItemAttributes, 'id' | 'note'> { }

class DeliveryHandoverItem extends Model<DeliveryHandoverItemAttributes, DeliveryHandoverItemCreationAttributes> implements DeliveryHandoverItemAttributes {
    declare id: number;
    declare handover_id: number;
    declare product_id: string;
    declare qty_expected: number;
    declare qty_checked: number;
    declare condition: DeliveryHandoverItemCondition;
    declare note: string | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

DeliveryHandoverItem.init(
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        handover_id: {
            type: DataTypes.BIGINT,
            allowNull: false,
        },
        product_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        qty_expected: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        qty_checked: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        condition: {
            type: DataTypes.ENUM('ok', 'damaged', 'missing'),
            allowNull: false,
            defaultValue: 'ok',
        },
        note: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'delivery_handover_items',
        indexes: [
            { fields: ['handover_id'] },
            { fields: ['product_id'] },
        ],
    }
);

export default DeliveryHandoverItem;

