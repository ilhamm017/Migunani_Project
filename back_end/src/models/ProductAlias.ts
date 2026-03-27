import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface ProductAliasAttributes {
    id: number;
    product_id: string; // UUID from Product
    alias: string;
    alias_normalized: string;
}

interface ProductAliasCreationAttributes extends Optional<ProductAliasAttributes, 'id'> { }

class ProductAlias extends Model<ProductAliasAttributes, ProductAliasCreationAttributes> implements ProductAliasAttributes {
    declare id: number;
    declare product_id: string;
    declare alias: string;
    declare alias_normalized: string;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

ProductAlias.init(
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            autoIncrement: true,
            primaryKey: true,
        },
        product_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        alias: {
            type: DataTypes.STRING(120),
            allowNull: false,
        },
        alias_normalized: {
            type: DataTypes.STRING(120),
            allowNull: false,
        },
    },
    {
        sequelize,
        tableName: 'product_aliases',
        indexes: [
            { fields: ['product_id'] },
            { fields: ['alias_normalized'] },
            { unique: true, fields: ['product_id', 'alias_normalized'] },
        ],
    }
);

export default ProductAlias;

