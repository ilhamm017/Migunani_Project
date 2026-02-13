import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface ShiftAttributes {
    id: number;
    user_id: string; // UUID (Kasir)
    start_time: Date;
    end_time?: Date;
    start_cash: number;
    end_cash?: number; // Actual cash counted
    expected_cash?: number; // System calculated
    difference?: number;
    status: 'open' | 'closed';
}

interface ShiftCreationAttributes extends Optional<ShiftAttributes, 'id' | 'end_time' | 'end_cash' | 'expected_cash' | 'difference'> { }

class Shift extends Model<ShiftAttributes, ShiftCreationAttributes> implements ShiftAttributes {
    declare id: number;
    declare user_id: string;
    declare start_time: Date;
    declare end_time: Date;
    declare start_cash: number;
    declare end_cash: number;
    declare expected_cash: number;
    declare difference: number;
    declare status: 'open' | 'closed';

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

Shift.init(
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        user_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        start_time: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
        },
        end_time: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        start_cash: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0,
        },
        end_cash: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: true,
        },
        expected_cash: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: true,
        },
        difference: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: true,
        },
        status: {
            type: DataTypes.ENUM('open', 'closed'),
            defaultValue: 'open',
        },
    },
    {
        sequelize,
        tableName: 'shifts',
    }
);

export default Shift;
