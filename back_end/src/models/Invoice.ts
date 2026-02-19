import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface InvoiceAttributes {
    id: string; // UUID
    order_id?: string | null; // UUID (legacy primary order)
    customer_id?: string | null; // UUID
    invoice_number: string;
    payment_method: 'pending' | 'transfer_manual' | 'cod' | 'cash_store';
    payment_status: 'unpaid' | 'paid' | 'cod_pending' | 'draft';
    amount_paid: number;
    change_amount: number;
    payment_proof_url?: string | null;
    verified_by?: string | null; // UUID
    verified_at?: Date | null;
    subtotal: number;
    discount_amount?: number;
    shipping_fee_total?: number;
    tax_percent: number;
    tax_amount: number;
    total: number;
    tax_mode_snapshot: 'pkp' | 'non_pkp';
    pph_final_amount?: number | null;
    shipping_method_code?: string | null;
    shipping_method_name?: string | null;
    courier_id?: string | null;
    shipment_status?: 'ready_to_ship' | 'shipped' | 'delivered' | 'canceled';
    shipped_at?: Date | null;
    delivered_at?: Date | null;
    delivery_proof_url?: string | null;
    expiry_date?: Date | null;
}

interface InvoiceCreationAttributes extends Optional<InvoiceAttributes, 'id' | 'payment_status' | 'amount_paid' | 'change_amount' | 'tax_percent' | 'tax_amount' | 'pph_final_amount'> { }

class Invoice extends Model<InvoiceAttributes, InvoiceCreationAttributes> implements InvoiceAttributes {
    declare id: string;
    declare order_id: string | null;
    declare customer_id: string | null;
    declare invoice_number: string;
    declare payment_method: 'pending' | 'transfer_manual' | 'cod' | 'cash_store';
    declare payment_status: 'unpaid' | 'paid' | 'cod_pending' | 'draft';
    declare amount_paid: number;
    declare change_amount: number;
    declare payment_proof_url: string | null;
    declare verified_by: string | null;
    declare verified_at: Date | null;
    declare subtotal: number;
    declare discount_amount: number;
    declare shipping_fee_total: number;
    declare tax_percent: number;
    declare tax_amount: number;
    declare total: number;
    declare tax_mode_snapshot: 'pkp' | 'non_pkp';
    declare pph_final_amount: number | null;
    declare shipping_method_code: string | null;
    declare shipping_method_name: string | null;
    declare courier_id: string | null;
    declare shipment_status: 'ready_to_ship' | 'shipped' | 'delivered' | 'canceled';
    declare shipped_at: Date | null;
    declare delivered_at: Date | null;
    declare delivery_proof_url: string | null;
    declare expiry_date: Date | null;

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
            allowNull: true,
        },
        customer_id: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        invoice_number: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
        },
        payment_method: {
            type: DataTypes.ENUM('pending', 'transfer_manual', 'cod', 'cash_store'),
            allowNull: false,
            defaultValue: 'pending',
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
        subtotal: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0,
        },
        discount_amount: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0,
        },
        shipping_fee_total: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0,
        },
        tax_percent: {
            type: DataTypes.DECIMAL(6, 3),
            allowNull: false,
            defaultValue: 0,
        },
        tax_amount: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0,
        },
        total: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0,
        },
        tax_mode_snapshot: {
            type: DataTypes.ENUM('pkp', 'non_pkp'),
            allowNull: false,
            defaultValue: 'non_pkp',
        },
        pph_final_amount: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: true,
        },
        shipping_method_code: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        shipping_method_name: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        courier_id: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        shipment_status: {
            type: DataTypes.ENUM('ready_to_ship', 'shipped', 'delivered', 'canceled'),
            allowNull: false,
            defaultValue: 'ready_to_ship',
        },
        shipped_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        delivered_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        delivery_proof_url: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        expiry_date: {
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
