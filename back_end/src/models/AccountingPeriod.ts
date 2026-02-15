import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface AccountingPeriodAttributes {
    id: number;
    month: number;
    year: number;
    is_closed: boolean;
    closed_at?: Date;
    closed_by?: string; // UUID
}

interface AccountingPeriodCreationAttributes extends Optional<AccountingPeriodAttributes, 'id' | 'is_closed' | 'closed_at' | 'closed_by'> { }

class AccountingPeriod extends Model<AccountingPeriodAttributes, AccountingPeriodCreationAttributes> implements AccountingPeriodAttributes {
    declare id: number;
    declare month: number;
    declare year: number;
    declare is_closed: boolean;
    declare closed_at: Date | undefined;
    declare closed_by: string | undefined;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

AccountingPeriod.init(
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
        },
        month: {
            type: DataTypes.INTEGER,
            allowNull: false,
            validate: { min: 1, max: 12 }
        },
        year: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        is_closed: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
        closed_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        closed_by: {
            type: DataTypes.UUID,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'accounting_periods',
        indexes: [
            {
                unique: true,
                fields: ['month', 'year']
            }
        ]
    }
);

export default AccountingPeriod;
