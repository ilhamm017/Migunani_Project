import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface AuditLogAttributes {
    id: number;
    actor_user_id?: string | null;
    actor_role?: string | null;
    method: string;
    path: string;
    action: string;
    status_code: number;
    success: boolean;
    ip_address?: string | null;
    user_agent?: string | null;
    request_payload?: unknown | null;
    response_payload?: unknown | null;
    error_message?: string | null;
}

interface AuditLogCreationAttributes extends Optional<AuditLogAttributes, 'id' | 'actor_user_id' | 'actor_role' | 'ip_address' | 'user_agent' | 'request_payload' | 'response_payload' | 'error_message'> { }

class AuditLog extends Model<AuditLogAttributes, AuditLogCreationAttributes> implements AuditLogAttributes {
    declare id: number;
    declare actor_user_id: string | null;
    declare actor_role: string | null;
    declare method: string;
    declare path: string;
    declare action: string;
    declare status_code: number;
    declare success: boolean;
    declare ip_address: string | null;
    declare user_agent: string | null;
    declare request_payload: unknown | null;
    declare response_payload: unknown | null;
    declare error_message: string | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

AuditLog.init(
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        actor_user_id: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        actor_role: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        method: {
            type: DataTypes.STRING(16),
            allowNull: false,
        },
        path: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        action: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        status_code: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        success: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
        },
        ip_address: {
            type: DataTypes.STRING(64),
            allowNull: true,
        },
        user_agent: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
        request_payload: {
            type: DataTypes.JSON,
            allowNull: true,
        },
        response_payload: {
            type: DataTypes.JSON,
            allowNull: true,
        },
        error_message: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'audit_logs',
        indexes: [
            { fields: ['createdAt'] },
            { fields: ['actor_user_id'] },
            { fields: ['actor_role'] },
            { fields: ['status_code'] },
            { fields: ['method'] },
        ],
    }
);

export default AuditLog;
