import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface InvoiceItemAttributes {
    id: string; // UUID
    invoice_id: string; // UUID
    order_item_id: string; // BIGINT (OrderItem.id)
    qty: number;
    unit_price: number;
    unit_cost: number;
    line_total: number;
}

interface InvoiceItemCreationAttributes extends Optional<InvoiceItemAttributes, 'id'> { }

class InvoiceItem extends Model<InvoiceItemAttributes, InvoiceItemCreationAttributes> implements InvoiceItemAttributes {
    declare id: string;
    declare invoice_id: string;
    declare order_item_id: string;
    declare qty: number;
    declare unit_price: number;
    declare unit_cost: number;
    declare line_total: number;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

InvoiceItem.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        invoice_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        order_item_id: {
            type: DataTypes.BIGINT,
            allowNull: false,
        },
        qty: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        unit_price: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
        },
        unit_cost: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
        },
        line_total: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
        },
    },
    {
        sequelize,
        tableName: 'invoice_items',
        indexes: [
            { fields: ['invoice_id'] },
            { fields: ['order_item_id'] }
        ]
    }
);

export default InvoiceItem;
