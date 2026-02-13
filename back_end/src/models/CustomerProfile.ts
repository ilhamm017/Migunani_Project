import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface CustomerProfileAttributes {
    user_id: string;
    tier: 'regular' | 'premium' | 'gold' | 'platinum';
    points: number;
    saved_addresses: any[]; // JSON
}

interface CustomerProfileCreationAttributes extends Optional<CustomerProfileAttributes, 'points'> { }

class CustomerProfile extends Model<CustomerProfileAttributes, CustomerProfileCreationAttributes> implements CustomerProfileAttributes {
    declare user_id: string;
    declare tier: 'regular' | 'premium' | 'gold' | 'platinum';
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
            type: DataTypes.ENUM('regular', 'premium', 'gold', 'platinum'),
            defaultValue: 'regular',
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
