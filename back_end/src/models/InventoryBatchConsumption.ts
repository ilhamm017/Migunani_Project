import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface InventoryBatchConsumptionAttributes {
    id: string; // BIGINT
    batch_id: string; // BIGINT
    product_id: string; // UUID
    qty: number;
    unit_cost: number;
    total_cost: number;
    reference_type: string;
    reference_id: string;
    order_item_id: string | null; // BIGINT (OrderItem.id)
}

interface InventoryBatchConsumptionCreationAttributes extends Optional<InventoryBatchConsumptionAttributes, 'id' | 'order_item_id'> { }

class InventoryBatchConsumption extends Model<InventoryBatchConsumptionAttributes, InventoryBatchConsumptionCreationAttributes> implements InventoryBatchConsumptionAttributes {
    declare id: string;
    declare batch_id: string;
    declare product_id: string;
    declare qty: number;
    declare unit_cost: number;
    declare total_cost: number;
    declare reference_type: string;
    declare reference_id: string;
    declare order_item_id: string | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

InventoryBatchConsumption.init(
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        batch_id: {
            type: DataTypes.BIGINT,
            allowNull: false,
            references: {
                model: 'inventory_batches',
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
        unit_cost: {
            type: DataTypes.DECIMAL(15, 4),
            allowNull: false,
        },
        total_cost: {
            type: DataTypes.DECIMAL(15, 4),
            allowNull: false,
        },
        reference_type: {
            type: DataTypes.STRING(32),
            allowNull: false,
        },
        reference_id: {
            type: DataTypes.STRING(64),
            allowNull: false,
        },
        order_item_id: {
            type: DataTypes.BIGINT,
            allowNull: true,
            references: {
                model: 'order_items',
                key: 'id',
            },
        },
    },
    {
        sequelize,
        tableName: 'inventory_batch_consumptions',
        indexes: [
            { name: 'idx_inventory_batch_consumptions_batch_id', fields: ['batch_id'] },
            { name: 'idx_inventory_batch_consumptions_product_id', fields: ['product_id'] },
            { name: 'idx_inventory_batch_consumptions_order_item_id', fields: ['order_item_id'] },
            { fields: ['reference_type', 'reference_id'] }
        ]
    }
);

export default InventoryBatchConsumption;
