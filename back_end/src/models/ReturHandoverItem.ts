import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface ReturHandoverItemAttributes {
    id: string; // BigInt
    handover_id: number; // BIGINT (ReturHandover.id)
    retur_id: string; // UUID (Retur.id)
}

interface ReturHandoverItemCreationAttributes extends Optional<ReturHandoverItemAttributes, 'id'> { }

class ReturHandoverItem extends Model<ReturHandoverItemAttributes, ReturHandoverItemCreationAttributes> implements ReturHandoverItemAttributes {
    declare id: string;
    declare handover_id: number;
    declare retur_id: string;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

ReturHandoverItem.init(
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        handover_id: {
            type: DataTypes.BIGINT,
            allowNull: false,
        },
        retur_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
    },
    {
        sequelize,
        tableName: 'retur_handover_items',
        indexes: [
            { fields: ['handover_id'] },
            { unique: true, fields: ['retur_id'] },
        ]
    }
);

export default ReturHandoverItem;

