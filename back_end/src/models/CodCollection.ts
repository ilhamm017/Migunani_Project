import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface CodCollectionAttributes {
    id: number;
    invoice_id: string; // UUID
    driver_id: string; // UUID
    settlement_id: number | null;
    amount: number;
    status: 'collected' | 'settled';
}

interface CodCollectionCreationAttributes extends Optional<CodCollectionAttributes, 'id' | 'settlement_id'> { }

class CodCollection extends Model<CodCollectionAttributes, CodCollectionCreationAttributes> implements CodCollectionAttributes {
    declare id: number;
    declare invoice_id: string;
    declare driver_id: string;
    declare settlement_id: number | null;
    declare amount: number;
    declare status: 'collected' | 'settled';

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

CodCollection.init(
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        invoice_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'invoices',
                key: 'id'
            }
        },
        driver_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            }
        },
        settlement_id: {
            type: DataTypes.BIGINT,
            allowNull: true,
            references: {
                model: 'cod_settlements',
                key: 'id'
            }
        },
        amount: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0,
        },
        status: {
            type: DataTypes.ENUM('collected', 'settled'),
            allowNull: false,
            defaultValue: 'collected',
        },
    },
    {
        sequelize,
        tableName: 'cod_collections',
    }
);

export default CodCollection;
