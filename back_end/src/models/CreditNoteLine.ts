import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface CreditNoteLineAttributes {
    id: number;
    credit_note_id: number;
    product_id: string | null;
    description: string | null;
    qty: number;
    unit_price: number;
    line_subtotal: number;
    line_tax: number;
    line_total: number;
}

interface CreditNoteLineCreationAttributes extends Optional<CreditNoteLineAttributes, 'id' | 'product_id' | 'description' | 'line_tax'> { }

class CreditNoteLine extends Model<CreditNoteLineAttributes, CreditNoteLineCreationAttributes> implements CreditNoteLineAttributes {
    declare id: number;
    declare credit_note_id: number;
    declare product_id: string | null;
    declare description: string | null;
    declare qty: number;
    declare unit_price: number;
    declare line_subtotal: number;
    declare line_tax: number;
    declare line_total: number;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

CreditNoteLine.init(
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        credit_note_id: {
            type: DataTypes.BIGINT,
            allowNull: false,
        },
        product_id: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        qty: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 1,
        },
        unit_price: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0,
        },
        line_subtotal: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0,
        },
        line_tax: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0,
        },
        line_total: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0,
        },
    },
    {
        sequelize,
        tableName: 'credit_note_lines',
    }
);

export default CreditNoteLine;
