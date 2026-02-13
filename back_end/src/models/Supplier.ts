import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface SupplierAttributes {
    id: number;
    name: string;
    contact: string | null;
    address: string | null;
}

interface SupplierCreationAttributes extends Optional<SupplierAttributes, 'id' | 'contact' | 'address'> { }

class Supplier extends Model<SupplierAttributes, SupplierCreationAttributes> implements SupplierAttributes {
    declare id: number;
    declare name: string;
    declare contact: string | null;
    declare address: string | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

Supplier.init(
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
        contact: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        address: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'suppliers',
    }
);

export default Supplier;
