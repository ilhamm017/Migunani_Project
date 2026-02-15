import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface InvoiceAttributes {
    id: string; // UUID
    order_id: string; // UUID
    invoice_number: string;
    payment_method: 'transfer_manual' | 'cod' | 'cash_store';
    payment_status: 'unpaid' | 'paid' | 'cod_pending' | 'draft';
    amount_paid: number;
    change_amount: number;
    payment_proof_url?: string | null;
    verified_by?: string | null; // UUID
    verified_at?: Date | null;
}

interface InvoiceCreationAttributes extends Optional<InvoiceAttributes, 'id' | 'payment_status' | 'amount_paid' | 'change_amount'> { }

class Invoice extends Model<InvoiceAttributes, InvoiceCreationAttributes> implements InvoiceAttributes {
    declare id: string;
    declare order_id: string;
    declare invoice_number: string;
    declare payment_method: 'transfer_manual' | 'cod' | 'cash_store';
    declare payment_status: 'unpaid' | 'paid' | 'cod_pending' | 'draft';
    declare amount_paid: number;
    declare change_amount: number;
    declare payment_proof_url: string | null;
    declare verified_by: string | null;
    declare verified_at: Date | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

Invoice.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        order_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        invoice_number: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
        },
        payment_method: {
            type: DataTypes.ENUM('transfer_manual', 'cod', 'cash_store'),
            allowNull: false,
        },
        payment_status: {
            type: DataTypes.ENUM('unpaid', 'paid', 'cod_pending', 'draft'),
            defaultValue: 'unpaid',
        },
        amount_paid: {
            type: DataTypes.DECIMAL(15, 2),
            defaultValue: 0,
        },
        change_amount: {
            type: DataTypes.DECIMAL(15, 2),
            defaultValue: 0,
        },
        payment_proof_url: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        verified_by: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        verified_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'invoices',
        hooks: {
            beforeDestroy: (instance) => {
                if (instance.payment_status === 'paid' || instance.payment_status === 'cod_pending') {
                    throw new Error('Invoice yang sudah dibayar/pending tidak boleh dihapus.');
                }
            }
        },
        indexes: [
            {
                unique: true,
                fields: ['invoice_number']
            }
        ]
    }
);

export default Invoice;
