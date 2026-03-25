import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export type DeliveryHandoverStatus =
    | 'checked_passed'
    | 'checked_failed'
    | 'handed_over'
    | 'canceled';

interface DeliveryHandoverAttributes {
    id: number;
    invoice_id: string; // UUID
    courier_id: string | null; // UUID (driver)
    checker_id: string; // UUID
    status: DeliveryHandoverStatus;
    checked_at: Date;
    handed_over_at: Date | null;
    note: string | null;
    evidence_url: string | null;
}

interface DeliveryHandoverCreationAttributes extends Optional<DeliveryHandoverAttributes, 'id' | 'courier_id' | 'handed_over_at' | 'note' | 'evidence_url'> { }

class DeliveryHandover extends Model<DeliveryHandoverAttributes, DeliveryHandoverCreationAttributes> implements DeliveryHandoverAttributes {
    declare id: number;
    declare invoice_id: string;
    declare courier_id: string | null;
    declare checker_id: string;
    declare status: DeliveryHandoverStatus;
    declare checked_at: Date;
    declare handed_over_at: Date | null;
    declare note: string | null;
    declare evidence_url: string | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

DeliveryHandover.init(
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
        courier_id: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        checker_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        status: {
            type: DataTypes.ENUM('checked_passed', 'checked_failed', 'handed_over', 'canceled'),
            allowNull: false,
            defaultValue: 'checked_passed',
        },
        checked_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
        },
        handed_over_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        note: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        evidence_url: {
            type: DataTypes.STRING,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'delivery_handovers',
        indexes: [
            { fields: ['invoice_id'] },
            { fields: ['courier_id'] },
            { fields: ['checker_id'] },
            { fields: ['status'] },
            { fields: ['checked_at'] },
        ],
    }
);

export default DeliveryHandover;

