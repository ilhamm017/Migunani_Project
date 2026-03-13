import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface IdempotencyKeyAttributes {
    id: string;
    idempotency_key: string;
    scope: string;
    status: 'in_progress' | 'done';
    status_code?: number | null;
    response_payload?: Record<string, unknown> | null;
    expires_at: Date;
    createdAt?: Date;
    updatedAt?: Date;
}

interface IdempotencyKeyCreationAttributes extends Optional<
    IdempotencyKeyAttributes,
    'id' | 'status' | 'status_code' | 'response_payload'
> { }

class IdempotencyKey
    extends Model<IdempotencyKeyAttributes, IdempotencyKeyCreationAttributes>
    implements IdempotencyKeyAttributes {
    declare id: string;
    declare idempotency_key: string;
    declare scope: string;
    declare status: 'in_progress' | 'done';
    declare status_code: number | null;
    declare response_payload: Record<string, unknown> | null;
    declare expires_at: Date;
    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

IdempotencyKey.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        idempotency_key: {
            type: DataTypes.STRING(255),
            allowNull: false,
            unique: true,
        },
        scope: {
            type: DataTypes.STRING(191),
            allowNull: false,
        },
        status: {
            type: DataTypes.ENUM('in_progress', 'done'),
            allowNull: false,
            defaultValue: 'in_progress',
        },
        status_code: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        response_payload: {
            type: DataTypes.JSON,
            allowNull: true,
        },
        expires_at: {
            type: DataTypes.DATE,
            allowNull: false,
        },
    },
    {
        sequelize,
        tableName: 'idempotency_keys',
        indexes: [
            { unique: true, fields: ['idempotency_key'] },
            { fields: ['expires_at'] },
            { fields: ['status'] },
        ]
    }
);

export default IdempotencyKey;

