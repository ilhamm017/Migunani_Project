import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface InvoiceCostOverrideAttributes {
    id: number;
    invoice_id: string; // UUID
    product_id: string; // UUID
    unit_cost_override: number;
    reason: string;
    created_by: string; // UUID
    updated_by: string; // UUID
}

interface InvoiceCostOverrideCreationAttributes extends Optional<InvoiceCostOverrideAttributes, 'id'> { }

class InvoiceCostOverride extends Model<InvoiceCostOverrideAttributes, InvoiceCostOverrideCreationAttributes> implements InvoiceCostOverrideAttributes {
    declare id: number;
    declare invoice_id: string;
    declare product_id: string;
    declare unit_cost_override: number;
    declare reason: string;
    declare created_by: string;
    declare updated_by: string;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

InvoiceCostOverride.init(
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
        product_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        unit_cost_override: {
            type: DataTypes.DECIMAL(15, 4),
            allowNull: false,
            defaultValue: 0,
        },
        reason: {
            type: DataTypes.TEXT,
            allowNull: false,
        },
        created_by: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        updated_by: {
            type: DataTypes.UUID,
            allowNull: false,
        },
    },
    {
        sequelize,
        tableName: 'invoice_cost_overrides',
        indexes: [
            { fields: ['invoice_id'] },
            { fields: ['product_id'] },
            { unique: true, fields: ['invoice_id', 'product_id'] }
        ]
    }
);

export default InvoiceCostOverride;

