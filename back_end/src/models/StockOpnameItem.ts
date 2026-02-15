import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface StockOpnameItemAttributes {
    id: string;
    opname_id: string;
    product_id: string;
    system_qty: number;
    physical_qty: number;
    difference: number;
}

interface StockOpnameItemCreationAttributes extends Optional<StockOpnameItemAttributes, 'id'> { }

class StockOpnameItem extends Model<StockOpnameItemAttributes, StockOpnameItemCreationAttributes> implements StockOpnameItemAttributes {
    declare id: string;
    declare opname_id: string;
    declare product_id: string;
    declare system_qty: number;
    declare physical_qty: number;
    declare difference: number;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

StockOpnameItem.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        opname_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        product_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        system_qty: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        physical_qty: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        difference: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
    },
    {
        sequelize,
        tableName: 'stock_opname_items',
    }
);

export default StockOpnameItem;
