import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface CreditNoteAttributes {
    id: number;
    invoice_id: string;
    credit_note_number: string;
    amount: number;
    tax_amount: number;
    reason: string | null;
    mode: 'receivable' | 'cash_refund';
    status: 'draft' | 'posted' | 'refunded';
    posted_at: Date | null;
    posted_by: string | null;
}

interface CreditNoteCreationAttributes extends Optional<CreditNoteAttributes, 'id' | 'tax_amount' | 'reason' | 'status' | 'posted_at' | 'posted_by'> { }

class CreditNote extends Model<CreditNoteAttributes, CreditNoteCreationAttributes> implements CreditNoteAttributes {
    declare id: number;
    declare invoice_id: string;
    declare credit_note_number: string;
    declare amount: number;
    declare tax_amount: number;
    declare reason: string | null;
    declare mode: 'receivable' | 'cash_refund';
    declare status: 'draft' | 'posted' | 'refunded';
    declare posted_at: Date | null;
    declare posted_by: string | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

CreditNote.init(
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
        credit_note_number: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
        },
        amount: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0,
        },
        tax_amount: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0,
        },
        reason: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        mode: {
            type: DataTypes.ENUM('receivable', 'cash_refund'),
            allowNull: false,
            defaultValue: 'receivable',
        },
        status: {
            type: DataTypes.ENUM('draft', 'posted', 'refunded'),
            allowNull: false,
            defaultValue: 'draft',
        },
        posted_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        posted_by: {
            type: DataTypes.UUID,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'credit_notes',
    }
);

export default CreditNote;
