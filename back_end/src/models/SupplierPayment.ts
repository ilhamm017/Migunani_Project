import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface SupplierPaymentAttributes {
    id: number;
    supplier_invoice_id: number;
    amount: number;
    account_id: number; // Kas/Bank used for payment
    paid_at: Date;
    note?: string;
    created_by: string; // UUID
}

interface SupplierPaymentCreationAttributes extends Optional<SupplierPaymentAttributes, 'id' | 'paid_at' | 'note'> { }

class SupplierPayment extends Model<SupplierPaymentAttributes, SupplierPaymentCreationAttributes> implements SupplierPaymentAttributes {
    declare id: number;
    declare supplier_invoice_id: number;
    declare amount: number;
    declare account_id: number;
    declare paid_at: Date;
    declare note: string | undefined;
    declare created_by: string;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

SupplierPayment.init(
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        supplier_invoice_id: {
            type: DataTypes.BIGINT,
            allowNull: false,
            references: {
                model: 'supplier_invoices',
                key: 'id'
            }
        },
        amount: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0,
        },
        account_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'accounts',
                key: 'id'
            }
        },
        paid_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
        },
        note: {
            type: DataTypes.TEXT,
            allowNull: true,
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
        tableName: 'supplier_payments',
    }
);

export default SupplierPayment;
