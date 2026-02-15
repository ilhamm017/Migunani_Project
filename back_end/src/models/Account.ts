import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface AccountAttributes {
    id: number;
    code: string;
    name: string;
    type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
    parent_id: number | null;
    is_active: boolean;
}

interface AccountCreationAttributes extends Optional<AccountAttributes, 'id' | 'parent_id' | 'is_active'> { }

class Account extends Model<AccountAttributes, AccountCreationAttributes> implements AccountAttributes {
    declare id: number;
    declare code: string;
    declare name: string;
    declare type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
    declare parent_id: number | null;
    declare is_active: boolean;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

Account.init(
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
        },
        code: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        type: {
            type: DataTypes.ENUM('asset', 'liability', 'equity', 'revenue', 'expense'),
            allowNull: false,
        },
        parent_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: {
                model: 'accounts',
                key: 'id',
            },
        },
        is_active: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
    },
    {
        sequelize,
        tableName: 'accounts',
    }
);

export default Account;
