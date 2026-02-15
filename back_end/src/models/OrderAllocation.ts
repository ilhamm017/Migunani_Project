import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface OrderAllocationAttributes {
    id: string; // UUID
    order_id: string;
    product_id: string; // UUID from Product
    allocated_qty: number;
    status: 'pending' | 'picked' | 'shipped';
    picked_at?: Date;
    shipped_at?: Date;
}

interface OrderAllocationCreationAttributes extends Optional<OrderAllocationAttributes, 'id' | 'status' | 'picked_at' | 'shipped_at'> { }

class OrderAllocation extends Model<OrderAllocationAttributes, OrderAllocationCreationAttributes> implements OrderAllocationAttributes {
    declare id: string;
    declare order_id: string;
    declare product_id: string;
    declare allocated_qty: number;
    declare status: 'pending' | 'picked' | 'shipped';
    declare picked_at?: Date;
    declare shipped_at?: Date;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

OrderAllocation.init(
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
        product_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        allocated_qty: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        status: {
            type: DataTypes.ENUM('pending', 'picked', 'shipped'),
            defaultValue: 'pending',
        },
        picked_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        shipped_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'order_allocations',
        indexes: [
            { fields: ['order_id'] },
            { fields: ['product_id'] }
        ]
    }
);

export default OrderAllocation;
