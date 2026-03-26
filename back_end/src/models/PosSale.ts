import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export type PosSaleStatus = 'paid' | 'voided';

interface PosSaleAttributes {
    id: string; // UUID
    receipt_no?: string; // BIGINT (may be returned as string)
    receipt_number?: string | null; // generated column
    cashier_user_id: string; // UUID
    customer_name?: string | null;
    note?: string | null;
    status: PosSaleStatus;
    subtotal: number;
    discount_amount: number;
    discount_percent: number;
    tax_percent: number;
    tax_amount: number;
    total: number;
    amount_received: number;
    change_amount: number;
    paid_at: Date;
    voided_at?: Date | null;
    voided_by?: string | null;
    void_reason?: string | null;
    createdAt?: Date;
    updatedAt?: Date;
}

interface PosSaleCreationAttributes extends Optional<PosSaleAttributes, 'id' | 'receipt_no' | 'receipt_number' | 'customer_name' | 'note' | 'status' | 'discount_amount' | 'discount_percent' | 'tax_percent' | 'tax_amount' | 'change_amount' | 'voided_at' | 'voided_by' | 'void_reason'> { }

class PosSale extends Model<PosSaleAttributes, PosSaleCreationAttributes> implements PosSaleAttributes {
    declare id: string;
    declare receipt_no: string;
    declare receipt_number: string | null;
    declare cashier_user_id: string;
    declare customer_name: string | null;
    declare note: string | null;
    declare status: PosSaleStatus;
    declare subtotal: number;
    declare discount_amount: number;
    declare discount_percent: number;
    declare tax_percent: number;
    declare tax_amount: number;
    declare total: number;
    declare amount_received: number;
    declare change_amount: number;
    declare paid_at: Date;
    declare voided_at: Date | null;
    declare voided_by: string | null;
    declare void_reason: string | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

PosSale.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        receipt_no: {
            type: DataTypes.BIGINT.UNSIGNED,
            allowNull: false,
            autoIncrement: true,
            unique: true,
        },
        receipt_number: {
            type: DataTypes.STRING(32),
            allowNull: true,
        },
        cashier_user_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        customer_name: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
        note: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        status: {
            type: DataTypes.ENUM('paid', 'voided'),
            allowNull: false,
            defaultValue: 'paid',
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
        discount_percent: {
            type: DataTypes.DECIMAL(6, 3),
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
        amount_received: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0,
        },
        change_amount: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0,
        },
        paid_at: {
            type: DataTypes.DATE,
            allowNull: false,
        },
        voided_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        voided_by: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        void_reason: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'pos_sales',
    }
);

export default PosSale;
