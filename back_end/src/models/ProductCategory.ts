import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/database';

interface ProductCategoryAttributes {
    product_id: string;
    category_id: number;
}

class ProductCategory extends Model<ProductCategoryAttributes> implements ProductCategoryAttributes {
    declare product_id: string;
    declare category_id: number;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

ProductCategory.init(
    {
        product_id: {
            type: DataTypes.UUID,
            allowNull: false,
            primaryKey: true,
        },
        category_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            primaryKey: true,
        },
    },
    {
        sequelize,
        tableName: 'product_categories',
        indexes: [
            { unique: true, fields: ['product_id', 'category_id'] },
            { fields: ['category_id'] }
        ]
    }
);

export default ProductCategory;
