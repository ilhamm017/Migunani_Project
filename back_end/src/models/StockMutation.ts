import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface StockMutationAttributes {
    id: string; // BigInt represented as string in JS sometimes, or number if safe. Sequelize handles BigInt as string usually to avoid overflow.
    product_id: string; // UUID
    type: 'in' | 'out' | 'adjustment' | 'initial';
    qty: number;
    reference_id?: string;
    note?: string;
}

interface StockMutationCreationAttributes extends Optional<StockMutationAttributes, 'id'> { }

class StockMutation extends Model<StockMutationAttributes, StockMutationCreationAttributes> implements StockMutationAttributes {
    declare id: string;
    declare product_id: string;
    declare type: 'in' | 'out' | 'adjustment' | 'initial';
    declare qty: number;
    declare reference_id: string;
    declare note: string;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

StockMutation.init(
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
        type: {
            type: DataTypes.ENUM('in', 'out', 'adjustment', 'initial'),
            allowNull: false,
        },
        qty: {
            type: DataTypes.INTEGER,
            allowNull: false,
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
        tableName: 'stock_mutations',
    }
);

export default StockMutation;
