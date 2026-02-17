import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface InventoryCostLedgerAttributes {
    id: number;
    product_id: string;
    movement_type: 'in' | 'out' | 'adjustment_plus' | 'adjustment_minus';
    qty: number;
    unit_cost: number;
    total_cost: number;
    reference_type: string | null;
    reference_id: string | null;
    note: string | null;
}

interface InventoryCostLedgerCreationAttributes extends Optional<InventoryCostLedgerAttributes, 'id' | 'reference_type' | 'reference_id' | 'note'> { }

class InventoryCostLedger extends Model<InventoryCostLedgerAttributes, InventoryCostLedgerCreationAttributes> implements InventoryCostLedgerAttributes {
    declare id: number;
    declare product_id: string;
    declare movement_type: 'in' | 'out' | 'adjustment_plus' | 'adjustment_minus';
    declare qty: number;
    declare unit_cost: number;
    declare total_cost: number;
    declare reference_type: string | null;
    declare reference_id: string | null;
    declare note: string | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

InventoryCostLedger.init(
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
        movement_type: {
            type: DataTypes.ENUM('in', 'out', 'adjustment_plus', 'adjustment_minus'),
            allowNull: false,
        },
        qty: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        unit_cost: {
            type: DataTypes.DECIMAL(15, 4),
            allowNull: false,
            defaultValue: 0,
        },
        total_cost: {
            type: DataTypes.DECIMAL(15, 4),
            allowNull: false,
            defaultValue: 0,
        },
        reference_type: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        reference_id: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        note: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'inventory_cost_ledger',
    }
);

export default InventoryCostLedger;
