import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface CartItemAttributes {
    id: bigint;
    cart_id: string; // UUID
    product_id: string; // UUID
    qty: number;
    createdAt?: Date;
    updatedAt?: Date;
}

interface CartItemCreationAttributes extends Optional<CartItemAttributes, 'id'> { }

class CartItem extends Model<CartItemAttributes, CartItemCreationAttributes> implements CartItemAttributes {
    declare id: bigint;
    declare cart_id: string;
    declare product_id: string;
    declare qty: number;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

CartItem.init(
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        cart_id: {
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
            defaultValue: 1,
        },
    },
    {
        sequelize,
        tableName: 'cart_items',
    }
);

export default CartItem;
