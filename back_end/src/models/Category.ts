import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface CategoryAttributes {
    id: number;
    name: string;
    description: string | null;
    icon: string | null;
    discount_regular_pct: number | null;
    discount_gold_pct: number | null;
    discount_premium_pct: number | null;
}

interface CategoryCreationAttributes extends Optional<CategoryAttributes, 'id' | 'description' | 'icon' | 'discount_regular_pct' | 'discount_gold_pct' | 'discount_premium_pct'> { }

class Category extends Model<CategoryAttributes, CategoryCreationAttributes> implements CategoryAttributes {
    declare id: number;
    declare name: string;
    declare description: string | null;
    declare icon: string | null;
    declare discount_regular_pct: number | null;
    declare discount_gold_pct: number | null;
    declare discount_premium_pct: number | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

Category.init(
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        icon: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        discount_regular_pct: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: true,
        },
        discount_gold_pct: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: true,
        },
        discount_premium_pct: {
            type: DataTypes.DECIMAL(5, 2),
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'categories',
    }
);

export default Category;
