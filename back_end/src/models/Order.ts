import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface OrderAttributes {
    id: string; // UUID
    customer_id?: string; // UUID
    customer_name?: string;
    source: 'web' | 'whatsapp';
    status: 'pending' | 'waiting_invoice' | 'waiting_payment' | 'ready_to_ship' | 'allocated' | 'partially_fulfilled' | 'debt_pending' | 'shipped' | 'delivered' | 'completed' | 'canceled' | 'expired' | 'hold' | 'waiting_admin_verification';
    payment_method?: 'transfer_manual' | 'cod' | 'cash_store' | null;
    total_amount: number;
    discount_amount: number;
    shipping_method_code?: string | null;
    shipping_method_name?: string | null;
    shipping_fee?: number | null;
    shipping_address?: string | null;
    customer_note?: string | null;
    courier_id?: string; // UUID
    expiry_date?: Date | null;
    delivery_proof_url?: string;
    createdAt?: Date;
    updatedAt?: Date;
    stock_released: boolean;
    parent_order_id?: string | null; // UUID linking to original order if split
    goods_out_posted_at?: Date | null;
    goods_out_posted_by?: string | null;
}

interface OrderCreationAttributes extends Optional<OrderAttributes, 'id' | 'discount_amount' | 'stock_released' | 'delivery_proof_url'> { }

class Order extends Model<OrderAttributes, OrderCreationAttributes> implements OrderAttributes {
    declare id: string;
    declare customer_id: string;
    declare customer_name: string;
    declare source: 'web' | 'whatsapp';
    declare status: 'pending' | 'waiting_invoice' | 'waiting_payment' | 'ready_to_ship' | 'allocated' | 'partially_fulfilled' | 'debt_pending' | 'shipped' | 'delivered' | 'completed' | 'canceled' | 'expired' | 'hold' | 'waiting_admin_verification';
    declare payment_method: 'transfer_manual' | 'cod' | 'cash_store' | null;
    declare total_amount: number;
    declare discount_amount: number;
    declare shipping_method_code: string | null;
    declare shipping_method_name: string | null;
    declare shipping_fee: number | null;
    declare shipping_address: string | null;
    declare customer_note: string | null;
    declare courier_id: string;
    declare expiry_date: Date | null;
    declare delivery_proof_url: string;
    declare stock_released: boolean;
    declare parent_order_id: string | null;
    declare goods_out_posted_at: Date | null;
    declare goods_out_posted_by: string | null;

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
            type: DataTypes.ENUM('web', 'whatsapp'),
            allowNull: false,
        },
        status: {
            type: DataTypes.ENUM('pending', 'waiting_invoice', 'waiting_payment', 'ready_to_ship', 'allocated', 'partially_fulfilled', 'debt_pending', 'shipped', 'delivered', 'completed', 'canceled', 'expired', 'hold', 'waiting_admin_verification'),
            defaultValue: 'pending',
        },
        payment_method: {
            type: DataTypes.ENUM('transfer_manual', 'cod', 'cash_store'),
            allowNull: true,
        },
        total_amount: {
            type: DataTypes.DECIMAL(15, 2),
            defaultValue: 0,
        },
        discount_amount: {
            type: DataTypes.DECIMAL(15, 2),
            defaultValue: 0,
        },
        shipping_method_code: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        shipping_method_name: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        shipping_fee: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: true,
            defaultValue: 0,
        },
        shipping_address: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        customer_note: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        courier_id: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        expiry_date: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        delivery_proof_url: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        stock_released: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
        parent_order_id: {
            type: DataTypes.UUID,
            allowNull: true,
            references: {
                model: 'orders',
                key: 'id'
            }
        },
        goods_out_posted_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        goods_out_posted_by: {
            type: DataTypes.UUID,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'orders',
    }
);

export default Order;
