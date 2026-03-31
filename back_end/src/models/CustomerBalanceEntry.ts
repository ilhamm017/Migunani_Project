import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export type CustomerBalanceEntryType =
    | 'payment_delta_non_cod'
    | 'cod_settlement_delta'
    | 'pos_underpay'
    | 'pos_underpay_refund'
    | 'credit_note_posted'
    | 'credit_note_refund_paid'
    | 'manual_payment'
    | 'manual_refund'
    | 'manual_adjustment';

interface CustomerBalanceEntryAttributes {
    id: number;
    customer_id: string;
    amount: number;
    entry_type: CustomerBalanceEntryType;
    reference_type?: string | null;
    reference_id?: string | null;
    note?: string | null;
    created_by?: string | null;
    idempotency_key?: string | null;
}

interface CustomerBalanceEntryCreationAttributes extends Optional<
    CustomerBalanceEntryAttributes,
    'id' | 'reference_type' | 'reference_id' | 'note' | 'created_by' | 'idempotency_key'
> { }

class CustomerBalanceEntry
    extends Model<CustomerBalanceEntryAttributes, CustomerBalanceEntryCreationAttributes>
    implements CustomerBalanceEntryAttributes {
    declare id: number;
    declare customer_id: string;
    declare amount: number;
    declare entry_type: CustomerBalanceEntryType;
    declare reference_type: string | null;
    declare reference_id: string | null;
    declare note: string | null;
    declare created_by: string | null;
    declare idempotency_key: string | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

CustomerBalanceEntry.init(
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        customer_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            }
        },
        amount: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0,
        },
        entry_type: {
            type: DataTypes.ENUM(
                'payment_delta_non_cod',
                'cod_settlement_delta',
                'pos_underpay',
                'pos_underpay_refund',
                'credit_note_posted',
                'credit_note_refund_paid',
                'manual_payment',
                'manual_refund',
                'manual_adjustment'
            ),
            allowNull: false,
        },
        reference_type: {
            type: DataTypes.STRING(64),
            allowNull: true,
        },
        reference_id: {
            type: DataTypes.STRING(191),
            allowNull: true,
        },
        note: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        created_by: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        idempotency_key: {
            type: DataTypes.STRING(255),
            allowNull: true,
            unique: true,
        },
    },
    {
        sequelize,
        tableName: 'customer_balance_entries',
        indexes: [
            { fields: ['customer_id', 'createdAt'] },
            { fields: ['reference_type', 'reference_id'] },
            { fields: ['entry_type', 'createdAt'] },
        ]
    }
);

export default CustomerBalanceEntry;
