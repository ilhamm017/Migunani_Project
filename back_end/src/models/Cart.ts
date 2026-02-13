import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface CartAttributes {
    id: string; // UUID
    user_id: string; // UUID
    createdAt?: Date;
    updatedAt?: Date;
}

interface CartCreationAttributes extends Optional<CartAttributes, 'id'> { }

import CartItem from './CartItem';

class Cart extends Model<CartAttributes, CartCreationAttributes> implements CartAttributes {
    declare id: string;
    declare user_id: string;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;

    declare readonly CartItems?: CartItem[];
}

Cart.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        user_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
    },
    {
        sequelize,
        tableName: 'carts',
    }
);

export default Cart;
