import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface StockOpnameAttributes {
    id: string;
    admin_id: string;
    status: 'open' | 'completed' | 'cancelled';
    notes?: string;
    started_at: Date;
    completed_at?: Date;
}

interface StockOpnameCreationAttributes extends Optional<StockOpnameAttributes, 'id' | 'started_at'> { }

class StockOpname extends Model<StockOpnameAttributes, StockOpnameCreationAttributes> implements StockOpnameAttributes {
    declare id: string;
    declare admin_id: string;
    declare status: 'open' | 'completed' | 'cancelled';
    declare notes?: string;
    declare started_at: Date;
    declare completed_at?: Date;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

StockOpname.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        admin_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        status: {
            type: DataTypes.ENUM('open', 'completed', 'cancelled'),
            defaultValue: 'open',
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        started_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
        },
        completed_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'stock_opnames',
    }
);

export default StockOpname;
