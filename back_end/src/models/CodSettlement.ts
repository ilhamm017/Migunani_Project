import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface CodSettlementAttributes {
    id: number;
    driver_id: string; // UUID
    total_amount: number;
    total_expected?: number | null;
    diff_amount?: number | null;
    driver_debt_before?: number | null;
    driver_debt_after?: number | null;
    invoice_ids_json?: string | null;
    received_by: string; // UUID (Finance Staff)
    settled_at: Date;
    note?: string;
}

interface CodSettlementCreationAttributes extends Optional<CodSettlementAttributes, 'id' | 'note' | 'total_expected' | 'diff_amount' | 'driver_debt_before' | 'driver_debt_after' | 'invoice_ids_json'> { }

class CodSettlement extends Model<CodSettlementAttributes, CodSettlementCreationAttributes> implements CodSettlementAttributes {
    declare id: number;
    declare driver_id: string;
    declare total_amount: number;
    declare total_expected: number | null;
    declare diff_amount: number | null;
    declare driver_debt_before: number | null;
    declare driver_debt_after: number | null;
    declare invoice_ids_json: string | null;
    declare received_by: string;
    declare settled_at: Date;
    declare note: string | undefined;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

CodSettlement.init(
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        driver_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            }
        },
        total_amount: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0,
        },
        total_expected: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: true,
        },
        diff_amount: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: true,
        },
        driver_debt_before: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: true,
        },
        driver_debt_after: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: true,
        },
        invoice_ids_json: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        received_by: {
            type: DataTypes.UUID, // Finance Staff ID
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            }
        },
        settled_at: {
            type: DataTypes.DATE, // When the money changes hands
            allowNull: false,
            defaultValue: DataTypes.NOW,
        },
        note: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'cod_settlements',
    }
);

export default CodSettlement;
