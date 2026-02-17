import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface ProductCostStateAttributes {
    id: number;
    product_id: string;
    on_hand_qty: number;
    avg_cost: number;
}

interface ProductCostStateCreationAttributes extends Optional<ProductCostStateAttributes, 'id' | 'on_hand_qty' | 'avg_cost'> { }

class ProductCostState extends Model<ProductCostStateAttributes, ProductCostStateCreationAttributes> implements ProductCostStateAttributes {
    declare id: number;
    declare product_id: string;
    declare on_hand_qty: number;
    declare avg_cost: number;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

ProductCostState.init(
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        product_id: {
            type: DataTypes.UUID,
            allowNull: false,
            unique: true,
        },
        on_hand_qty: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        avg_cost: {
            type: DataTypes.DECIMAL(15, 4),
            allowNull: false,
            defaultValue: 0,
        },
    },
    {
        sequelize,
        tableName: 'product_cost_states',
    }
);

export default ProductCostState;
