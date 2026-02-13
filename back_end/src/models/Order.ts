import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface OrderAttributes {
    id: string; // UUID
    customer_id?: string; // UUID
    customer_name?: string;
    source: 'web' | 'whatsapp' | 'pos_store';
    status: 'pending' | 'waiting_payment' | 'processing' | 'debt_pending' | 'shipped' | 'delivered' | 'completed' | 'canceled' | 'expired' | 'hold';
    total_amount: number;
    discount_amount: number;
    courier_id?: string; // UUID
    expiry_date?: Date;
    createdAt?: Date;
    updatedAt?: Date;
    stock_released: boolean;
}

interface OrderCreationAttributes extends Optional<OrderAttributes, 'id' | 'discount_amount' | 'stock_released'> { }

class Order extends Model<OrderAttributes, OrderCreationAttributes> implements OrderAttributes {
    declare id: string;
    declare customer_id: string;
    declare customer_name: string;
    declare source: 'web' | 'whatsapp' | 'pos_store';
    declare status: 'pending' | 'waiting_payment' | 'processing' | 'debt_pending' | 'shipped' | 'delivered' | 'completed' | 'canceled' | 'expired' | 'hold';
    declare total_amount: number;
    declare discount_amount: number;
    declare courier_id: string;
    declare expiry_date: Date;
    declare stock_released: boolean;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
    declare readonly OrderItems?: any[]; // Using any[] to avoid circular dependency import issues or defined OrderItem[] if imported
}

Order.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        customer_id: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        customer_name: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        source: {
            type: DataTypes.ENUM('web', 'whatsapp', 'pos_store'),
            allowNull: false,
        },
        status: {
            type: DataTypes.ENUM('pending', 'waiting_payment', 'processing', 'debt_pending', 'shipped', 'delivered', 'completed', 'canceled', 'expired', 'hold'),
            defaultValue: 'pending',
        },
        total_amount: {
            type: DataTypes.DECIMAL(15, 2),
            defaultValue: 0,
        },
        discount_amount: {
            type: DataTypes.DECIMAL(15, 2),
            defaultValue: 0,
        },
        courier_id: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        expiry_date: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        stock_released: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
    },
    {
        sequelize,
        tableName: 'orders',
    }
);

export default Order;
