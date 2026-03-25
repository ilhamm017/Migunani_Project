import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface SupplierPreorderAttributes {
    id: string; // UUID
    supplier_id: number;
    status: 'draft' | 'finalized' | 'canceled';
    notes?: string | null;
    created_by: string; // UUID
    finalized_by?: string | null; // UUID
    finalized_at?: Date | null;
}

interface SupplierPreorderCreationAttributes
    extends Optional<SupplierPreorderAttributes, 'id' | 'status' | 'notes' | 'finalized_by' | 'finalized_at'> { }

class SupplierPreorder
    extends Model<SupplierPreorderAttributes, SupplierPreorderCreationAttributes>
    implements SupplierPreorderAttributes {
    declare id: string;
    declare supplier_id: number;
    declare status: 'draft' | 'finalized' | 'canceled';
    declare notes: string | null;
    declare created_by: string;
    declare finalized_by: string | null;
    declare finalized_at: Date | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

SupplierPreorder.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        supplier_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        status: {
            type: DataTypes.ENUM('draft', 'finalized', 'canceled'),
            allowNull: false,
            defaultValue: 'draft',
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true,
            defaultValue: null,
        },
        created_by: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        finalized_by: {
            type: DataTypes.UUID,
            allowNull: true,
            defaultValue: null,
        },
        finalized_at: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null,
        },
    },
    {
        sequelize,
        tableName: 'supplier_preorders',
        indexes: [
            { fields: ['supplier_id'] },
            { fields: ['status'] },
            { fields: ['created_by'] },
        ],
    }
);

export default SupplierPreorder;

