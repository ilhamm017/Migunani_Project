import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface PurchaseOrderAttributes {
    id: string; // UUID
    supplier_id: number | null;
    status: 'pending' | 'received' | 'partially_received' | 'canceled';
    total_cost: number;
    created_by: string; // UUID
    verified1_by?: string | null; // UUID
    verified1_at?: Date | null;
    verified2_by?: string | null; // UUID
    verified2_at?: Date | null;
}

interface PurchaseOrderCreationAttributes extends Optional<PurchaseOrderAttributes, 'id' | 'supplier_id' | 'verified1_by' | 'verified1_at' | 'verified2_by' | 'verified2_at'> { }

class PurchaseOrder extends Model<PurchaseOrderAttributes, PurchaseOrderCreationAttributes> implements PurchaseOrderAttributes {
    declare id: string;
    declare supplier_id: number | null;
    declare status: 'pending' | 'received' | 'partially_received' | 'canceled';
    declare total_cost: number;
    declare created_by: string;
    declare verified1_by: string | null;
    declare verified1_at: Date | null;
    declare verified2_by: string | null;
    declare verified2_at: Date | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

PurchaseOrder.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        supplier_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: {
                model: 'suppliers',
                key: 'id',
            },
        },
        status: {
            type: DataTypes.ENUM('pending', 'received', 'partially_received', 'canceled'),
            defaultValue: 'pending',
        },
        total_cost: {
            type: DataTypes.DECIMAL(15, 2),
            defaultValue: 0,
        },
        created_by: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id',
            },
        },
        verified1_by: {
            type: DataTypes.UUID,
            allowNull: true,
            defaultValue: null,
            references: {
                model: 'users',
                key: 'id',
            },
        },
        verified1_at: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null,
        },
        verified2_by: {
            type: DataTypes.UUID,
            allowNull: true,
            defaultValue: null,
            references: {
                model: 'users',
                key: 'id',
            },
        },
        verified2_at: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null,
        },
    },
    {
        sequelize,
        tableName: 'purchase_orders',
        indexes: [
            { name: 'idx_purchase_orders_supplier_id', fields: ['supplier_id'] },
            { name: 'idx_purchase_orders_created_by', fields: ['created_by'] },
            { name: 'idx_purchase_orders_verified1_by', fields: ['verified1_by'] },
            { name: 'idx_purchase_orders_verified2_by', fields: ['verified2_by'] },
        ],
    }
);

export default PurchaseOrder;
