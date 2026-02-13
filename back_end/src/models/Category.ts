import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface CategoryAttributes {
    id: number;
    name: string;
    description: string | null;
    icon: string | null;
}

interface CategoryCreationAttributes extends Optional<CategoryAttributes, 'id' | 'description' | 'icon'> { }

class Category extends Model<CategoryAttributes, CategoryCreationAttributes> implements CategoryAttributes {
    declare id: number;
    declare name: string;
    declare description: string | null;
    declare icon: string | null;

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
    },
    {
        sequelize,
        tableName: 'categories',
    }
);

export default Category;
