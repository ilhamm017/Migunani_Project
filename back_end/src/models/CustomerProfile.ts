import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface CustomerProfileAttributes {
    user_id: string;
    tier: 'regular' | 'gold' | 'platinum';
    credit_limit: number;
    points: number;
    saved_addresses: any[]; // JSON
}

interface CustomerProfileCreationAttributes extends Optional<CustomerProfileAttributes, 'points'> { }

class CustomerProfile extends Model<CustomerProfileAttributes, CustomerProfileCreationAttributes> implements CustomerProfileAttributes {
    declare user_id: string;
    declare tier: 'regular' | 'gold' | 'platinum';
    declare credit_limit: number;
    declare points: number;
    declare saved_addresses: any[];

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

CustomerProfile.init(
    {
        user_id: {
            type: DataTypes.UUID,
            primaryKey: true,
            references: {
                model: 'users',
                key: 'id'
            }
        },
        tier: {
            type: DataTypes.ENUM('regular', 'gold', 'platinum'),
            defaultValue: 'regular',
        },
        credit_limit: {
            type: DataTypes.DECIMAL(15, 2),
            defaultValue: 0,
            allowNull: false,
        },
        points: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
        },
        saved_addresses: {
            type: DataTypes.JSON,
            defaultValue: [],
        },
    },
    {
        sequelize,
        tableName: 'customer_profiles',
    }
);

export default CustomerProfile;
