import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface SupplierPreorderItemAttributes {
    id: string; // BigInt
    supplier_preorder_id: string; // UUID
    product_id: string; // UUID
    qty: number;
    note?: string | null;
}

interface SupplierPreorderItemCreationAttributes extends Optional<SupplierPreorderItemAttributes, 'id' | 'note'> { }

class SupplierPreorderItem
    extends Model<SupplierPreorderItemAttributes, SupplierPreorderItemCreationAttributes>
    implements SupplierPreorderItemAttributes {
    declare id: string;
    declare supplier_preorder_id: string;
    declare product_id: string;
    declare qty: number;
    declare note: string | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

SupplierPreorderItem.init(
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        supplier_preorder_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        product_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        qty: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        note: {
            type: DataTypes.TEXT,
            allowNull: true,
            defaultValue: null,
        },
    },
    {
        sequelize,
        tableName: 'supplier_preorder_items',
        indexes: [
            { fields: ['supplier_preorder_id'] },
            { fields: ['product_id'] },
        ],
    }
);

export default SupplierPreorderItem;

