import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface PosSaleItemAttributes {
    id: string; // BIGINT
    pos_sale_id: string; // UUID
    product_id: string; // UUID
    sku_snapshot: string;
    name_snapshot: string;
    unit_snapshot: string;
    qty: number;
    unit_price_normal_snapshot: number;
    unit_price_override?: number | null;
    override_reason?: string | null;
    unit_price: number;
    line_total: number;
    unit_cost: number;
    cogs_total: number;
    createdAt?: Date;
    updatedAt?: Date;
}

interface PosSaleItemCreationAttributes extends Optional<PosSaleItemAttributes, 'id' | 'unit_snapshot' | 'unit_cost' | 'cogs_total' | 'unit_price_override' | 'override_reason'> { }

class PosSaleItem extends Model<PosSaleItemAttributes, PosSaleItemCreationAttributes> implements PosSaleItemAttributes {
    declare id: string;
    declare pos_sale_id: string;
    declare product_id: string;
    declare sku_snapshot: string;
    declare name_snapshot: string;
    declare unit_snapshot: string;
    declare qty: number;
    declare unit_price_normal_snapshot: number;
    declare unit_price_override: number | null;
    declare override_reason: string | null;
    declare unit_price: number;
    declare line_total: number;
    declare unit_cost: number;
    declare cogs_total: number;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

PosSaleItem.init(
    {
        id: {
            type: DataTypes.BIGINT.UNSIGNED,
            autoIncrement: true,
            primaryKey: true,
        },
        pos_sale_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        product_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        sku_snapshot: {
            type: DataTypes.STRING(64),
            allowNull: false,
        },
        name_snapshot: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        unit_snapshot: {
            type: DataTypes.STRING(32),
            allowNull: false,
            defaultValue: 'Pcs',
        },
        qty: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        unit_price_normal_snapshot: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0,
        },
        unit_price_override: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: true,
        },
        override_reason: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        unit_price: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
        },
        line_total: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
        },
        unit_cost: {
            type: DataTypes.DECIMAL(15, 4),
            allowNull: false,
            defaultValue: 0,
        },
        cogs_total: {
            type: DataTypes.DECIMAL(15, 4),
            allowNull: false,
            defaultValue: 0,
        },
    },
    {
        sequelize,
        tableName: 'pos_sale_items',
    }
);

export default PosSaleItem;
