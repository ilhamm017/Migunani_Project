import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface PurchaseOrderAttributes {
    id: string; // UUID
    supplier_id: number;
    status: 'pending' | 'received' | 'canceled';
    total_cost: number;
    created_by: string; // UUID
}

interface PurchaseOrderCreationAttributes extends Optional<PurchaseOrderAttributes, 'id'> { }

class PurchaseOrder extends Model<PurchaseOrderAttributes, PurchaseOrderCreationAttributes> implements PurchaseOrderAttributes {
    declare id: string;
    declare supplier_id: number;
    declare status: 'pending' | 'received' | 'canceled';
    declare total_cost: number;
    declare created_by: string;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

PurchaseOrder.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        supplier_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        status: {
            type: DataTypes.ENUM('pending', 'received', 'canceled'),
            defaultValue: 'pending',
        },
        total_cost: {
            type: DataTypes.DECIMAL(15, 2),
            defaultValue: 0,
        },
        created_by: {
            type: DataTypes.UUID,
            allowNull: false,
        },
    },
    {
        sequelize,
        tableName: 'purchase_orders',
    }
);

export default PurchaseOrder;
