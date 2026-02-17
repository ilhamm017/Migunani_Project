import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface BackorderAttributes {
    id: string;
    order_item_id: string;
    qty_pending: number;
    status: 'waiting_stock' | 'ready' | 'fulfilled' | 'canceled';
    notes?: string;
    createdAt?: Date;
    updatedAt?: Date;
}

interface BackorderCreationAttributes extends Optional<BackorderAttributes, 'id' | 'status'> { }

class Backorder extends Model<BackorderAttributes, BackorderCreationAttributes> implements BackorderAttributes {
    declare id: string;
    declare order_item_id: string;
    declare qty_pending: number;
    declare status: 'waiting_stock' | 'ready' | 'fulfilled' | 'canceled';
    declare notes: string | undefined;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

Backorder.init(
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        order_item_id: {
            type: DataTypes.BIGINT,
            allowNull: false,
            references: {
                model: 'order_items',
                key: 'id'
            }
        },
        qty_pending: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        status: {
            type: DataTypes.ENUM('waiting_stock', 'ready', 'fulfilled', 'canceled'),
            allowNull: false,
            defaultValue: 'waiting_stock',
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'backorders',
    }
);

export default Backorder;
