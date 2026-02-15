import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface SupplierInvoiceAttributes {
    id: number;
    supplier_id: number;
    purchase_order_id: string;
    invoice_number: string;
    total: number;
    due_date: Date;
    status: 'unpaid' | 'paid' | 'overdue';
    created_by: string; // UUID
}

interface SupplierInvoiceCreationAttributes extends Optional<SupplierInvoiceAttributes, 'id' | 'status'> { }

class SupplierInvoice extends Model<SupplierInvoiceAttributes, SupplierInvoiceCreationAttributes> implements SupplierInvoiceAttributes {
    declare id: number;
    declare supplier_id: number;
    declare purchase_order_id: string;
    declare invoice_number: string;
    declare total: number;
    declare due_date: Date;
    declare status: 'unpaid' | 'paid' | 'overdue';
    declare created_by: string;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

SupplierInvoice.init(
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        supplier_id: {
            type: DataTypes.BIGINT,
            allowNull: false,
            references: {
                model: 'suppliers',
                key: 'id'
            }
        },
        purchase_order_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'purchase_orders',
                key: 'id'
            }
        },
        invoice_number: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        total: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0,
        },
        due_date: {
            type: DataTypes.DATEONLY,
            allowNull: false,
        },
        status: {
            type: DataTypes.ENUM('unpaid', 'paid', 'overdue'),
            allowNull: false,
            defaultValue: 'unpaid',
        },
        created_by: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            }
        },
    },
    {
        sequelize,
        tableName: 'supplier_invoices',
    }
);

export default SupplierInvoice;
