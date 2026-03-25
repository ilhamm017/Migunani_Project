import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface ReturAttributes {
    id: string; // UUID
    retur_type: 'customer_request' | 'delivery_refusal' | 'delivery_damage';
    order_id: string; // UUID
    product_id: string; // UUID
    qty: number;
    qty_received?: number | null;
    reason: string;
    evidence_img?: string | null;
    status: 'pending' | 'approved' | 'pickup_assigned' | 'picked_up' | 'handed_to_warehouse' | 'received' | 'completed' | 'rejected';
    admin_response?: string | null;
    courier_id?: string | null;
    refund_amount?: number | null;
    is_back_to_stock?: boolean | null;
    refund_disbursed_at?: Date | null;
    refund_disbursed_by?: string | null;
    refund_note?: string | null;
    created_by: string; // User ID (Customer)
}

interface ReturCreationAttributes extends Optional<ReturAttributes, 'id' | 'retur_type' | 'status' | 'evidence_img' | 'admin_response' | 'courier_id' | 'refund_amount' | 'is_back_to_stock' | 'qty_received'> { }

class Retur extends Model<ReturAttributes, ReturCreationAttributes> implements ReturAttributes {
    declare id: string;
    declare retur_type: 'customer_request' | 'delivery_refusal' | 'delivery_damage';
    declare order_id: string;
    declare product_id: string;
    declare qty: number;
    declare qty_received: number | null;
    declare reason: string;
    declare evidence_img: string | null;
    declare status: 'pending' | 'approved' | 'pickup_assigned' | 'picked_up' | 'handed_to_warehouse' | 'received' | 'completed' | 'rejected';
    declare admin_response: string | null;
    declare courier_id: string | null;
    declare refund_amount: number | null;
    declare is_back_to_stock: boolean | null;
    declare refund_disbursed_at: Date | null;
    declare refund_disbursed_by: string | null;
    declare refund_note: string | null;
    declare created_by: string;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

Retur.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        retur_type: {
            type: DataTypes.ENUM('customer_request', 'delivery_refusal', 'delivery_damage'),
            allowNull: false,
            defaultValue: 'customer_request',
        },
        order_id: {
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
        qty_received: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        reason: {
            type: DataTypes.TEXT,
            allowNull: false,
        },
        evidence_img: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        status: {
            type: DataTypes.ENUM(
                'pending',
                'approved',
                'pickup_assigned',
                'picked_up',
                'handed_to_warehouse',
                'received',
                'completed',
                'rejected'
            ),
            defaultValue: 'pending',
        },
        admin_response: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        courier_id: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        refund_amount: {
            type: DataTypes.DECIMAL(15, 2),
            defaultValue: 0,
        },
        is_back_to_stock: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
        },
        refund_disbursed_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        refund_disbursed_by: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        refund_note: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        created_by: {
            type: DataTypes.UUID,
            allowNull: false,
        }
    },
    {
        sequelize,
        tableName: 'returs',
    }
);

export default Retur;
