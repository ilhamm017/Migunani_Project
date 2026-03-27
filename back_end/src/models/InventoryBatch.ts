import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface InventoryBatchAttributes {
    id: string; // BIGINT
    product_id: string; // UUID
    unit_cost: number;
    qty_on_hand: number;
    source_type: string | null;
    source_id: string | null;
    note: string | null;
}

interface InventoryBatchCreationAttributes extends Optional<InventoryBatchAttributes, 'id' | 'source_type' | 'source_id' | 'note'> { }

class InventoryBatch extends Model<InventoryBatchAttributes, InventoryBatchCreationAttributes> implements InventoryBatchAttributes {
    declare id: string;
    declare product_id: string;
    declare unit_cost: number;
    declare qty_on_hand: number;
    declare source_type: string | null;
    declare source_id: string | null;
    declare note: string | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

InventoryBatch.init(
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        product_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        unit_cost: {
            type: DataTypes.DECIMAL(15, 4),
            allowNull: false,
        },
        qty_on_hand: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        source_type: {
            type: DataTypes.STRING(32),
            allowNull: true,
        },
        source_id: {
            type: DataTypes.STRING(64),
            allowNull: true,
        },
        note: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'inventory_batches',
        indexes: [
            { fields: ['product_id'] },
            { fields: ['product_id', 'unit_cost'] },
        ]
    }
);

export default InventoryBatch;

