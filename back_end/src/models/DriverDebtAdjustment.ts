import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface DriverDebtAdjustmentAttributes {
    id: string; // UUID
    driver_id: string; // UUID (User)
    invoice_id: string; // UUID
    retur_id: string; // UUID
    amount: number;
    status: 'open' | 'settled';
    note?: string | null;
    created_by: string; // UUID (admin)
}

interface DriverDebtAdjustmentCreationAttributes extends Optional<DriverDebtAdjustmentAttributes, 'id' | 'status' | 'note'> { }

class DriverDebtAdjustment extends Model<DriverDebtAdjustmentAttributes, DriverDebtAdjustmentCreationAttributes> implements DriverDebtAdjustmentAttributes {
    declare id: string;
    declare driver_id: string;
    declare invoice_id: string;
    declare retur_id: string;
    declare amount: number;
    declare status: 'open' | 'settled';
    declare note: string | null;
    declare created_by: string;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

DriverDebtAdjustment.init(
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
        invoice_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        retur_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        amount: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0,
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
        tableName: 'driver_debt_adjustments',
        indexes: [
            { fields: ['driver_id'] },
            { fields: ['status'] },
            { unique: true, fields: ['retur_id'] }
        ]
    }
);

export default DriverDebtAdjustment;

