import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface UserAttributes {
    id: string;
    name: string;
    email?: string | null;
    password?: string | null;
    whatsapp_number: string;
    role: 'super_admin' | 'admin_gudang' | 'admin_finance' | 'kasir' | 'driver' | 'customer';
    status: 'active' | 'banned';
}

interface UserCreationAttributes extends Optional<UserAttributes, 'id'> { }

class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
    declare id: string;
    declare name: string;
    declare email: string | null;
    declare password: string | null;
    declare whatsapp_number: string;
    declare role: 'super_admin' | 'admin_gudang' | 'admin_finance' | 'kasir' | 'driver' | 'customer';
    declare status: 'active' | 'banned';

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

User.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        email: {
            type: DataTypes.STRING,
            allowNull: true,
            unique: true,
            validate: {
                isEmail: true,
            },
        },
        password: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        whatsapp_number: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
        },
        role: {
            type: DataTypes.ENUM('super_admin', 'admin_gudang', 'admin_finance', 'kasir', 'driver', 'customer'),
            defaultValue: 'customer',
        },
        status: {
            type: DataTypes.ENUM('active', 'banned'),
            defaultValue: 'active',
        },
    },
    {
        sequelize,
        tableName: 'users',
        indexes: [
            {
                unique: true,
                fields: ['whatsapp_number']
            }
        ]
    }
);

export default User;
