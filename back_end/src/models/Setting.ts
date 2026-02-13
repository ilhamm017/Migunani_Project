import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface SettingAttributes {
    key: string;
    value: any; // JSON
    description?: string;
    createdAt?: Date;
    updatedAt?: Date;
}

interface SettingCreationAttributes extends Optional<SettingAttributes, 'description'> { }

class Setting extends Model<SettingAttributes, SettingCreationAttributes> implements SettingAttributes {
    declare key: string;
    declare value: any;
    declare description: string;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

Setting.init(
    {
        key: {
            type: DataTypes.STRING,
            primaryKey: true,
        },
        value: {
            type: DataTypes.JSON,
            allowNull: false,
        },
        description: {
            type: DataTypes.STRING,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'settings',
    }
);

export default Setting;
