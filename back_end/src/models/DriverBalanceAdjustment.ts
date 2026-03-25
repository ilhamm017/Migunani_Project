import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface DriverBalanceAdjustmentAttributes {
    id: string; // UUID
    driver_id: string; // UUID (User)
    direction: 'debt' | 'credit';
    amount: number;
    reason: 'cod_shortage' | 'cod_surplus';
    status: 'open' | 'settled';
    note?: string | null;
    created_by: string; // UUID (admin)
}

interface DriverBalanceAdjustmentCreationAttributes extends Optional<DriverBalanceAdjustmentAttributes, 'id' | 'status' | 'note'> { }

class DriverBalanceAdjustment extends Model<DriverBalanceAdjustmentAttributes, DriverBalanceAdjustmentCreationAttributes> implements DriverBalanceAdjustmentAttributes {
    declare id: string;
    declare driver_id: string;
    declare direction: 'debt' | 'credit';
    declare amount: number;
    declare reason: 'cod_shortage' | 'cod_surplus';
    declare status: 'open' | 'settled';
    declare note: string | null;
    declare created_by: string;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

DriverBalanceAdjustment.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        driver_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        direction: {
            type: DataTypes.ENUM('debt', 'credit'),
            allowNull: false,
        },
        amount: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0,
        },
        reason: {
            type: DataTypes.ENUM('cod_shortage', 'cod_surplus'),
            allowNull: false,
        },
        status: {
            type: DataTypes.ENUM('open', 'settled'),
            allowNull: false,
            defaultValue: 'open',
        },
        note: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        created_by: {
            type: DataTypes.UUID,
            allowNull: false,
        },
    },
    {
        sequelize,
        tableName: 'driver_balance_adjustments',
        indexes: [
            { fields: ['driver_id'] },
            { fields: ['status'] },
            { fields: ['reason'] },
            { fields: ['created_by'] },
        ]
    }
);

export default DriverBalanceAdjustment;

