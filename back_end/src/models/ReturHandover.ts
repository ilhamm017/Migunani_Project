import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface ReturHandoverAttributes {
    id: number;
    invoice_id: string; // UUID
    driver_id: string; // UUID
    status: 'submitted' | 'received';
    submitted_at: Date;
    received_at?: Date | null;
    received_by?: string | null; // UUID
    note?: string | null;
    driver_debt_before?: number | null;
    driver_debt_after?: number | null;
}

interface ReturHandoverCreationAttributes extends Optional<ReturHandoverAttributes, 'id' | 'status' | 'submitted_at' | 'received_at' | 'received_by' | 'note' | 'driver_debt_before' | 'driver_debt_after'> { }

class ReturHandover extends Model<ReturHandoverAttributes, ReturHandoverCreationAttributes> implements ReturHandoverAttributes {
    declare id: number;
    declare invoice_id: string;
    declare driver_id: string;
    declare status: 'submitted' | 'received';
    declare submitted_at: Date;
    declare received_at: Date | null;
    declare received_by: string | null;
    declare note: string | null;
    declare driver_debt_before: number | null;
    declare driver_debt_after: number | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

ReturHandover.init(
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        invoice_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        driver_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        status: {
            type: DataTypes.ENUM('submitted', 'received'),
            allowNull: false,
            defaultValue: 'submitted',
        },
        submitted_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
        },
        received_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        received_by: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        note: {
            type: DataTypes.TEXT,
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
    },
    {
        sequelize,
        tableName: 'retur_handovers',
        indexes: [
            { unique: true, fields: ['invoice_id'] },
            { fields: ['driver_id'] },
            { fields: ['status'] },
            { fields: ['submitted_at'] },
        ]
    }
);

export default ReturHandover;
