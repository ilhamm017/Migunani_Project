import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface MessageAttributes {
    id: string; // BigInt
    session_id: string; // UUID
    thread_id?: string | null;
    sender_type: 'customer' | 'admin' | 'bot';
    sender_id?: string; // UUID
    body: string;
    attachment_url?: string;
    is_read: boolean;
    created_via: 'system' | 'wa_mobile_sync' | 'admin_panel';
    channel?: 'app' | 'whatsapp';
    quoted_message_id?: string | null;
    delivery_state?: 'sent' | 'delivered' | 'read' | 'failed';
    read_at?: Date | null;
}

interface MessageCreationAttributes extends Optional<MessageAttributes, 'id' | 'is_read'> { }

class Message extends Model<MessageAttributes, MessageCreationAttributes> implements MessageAttributes {
    declare id: string;
    declare session_id: string;
    declare thread_id: string | null;
    declare sender_type: 'customer' | 'admin' | 'bot';
    declare sender_id: string;
    declare body: string;
    declare attachment_url: string;
    declare is_read: boolean;
    declare created_via: 'system' | 'wa_mobile_sync' | 'admin_panel';
    declare channel: 'app' | 'whatsapp';
    declare quoted_message_id: string | null;
    declare delivery_state: 'sent' | 'delivered' | 'read' | 'failed';
    declare read_at: Date | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

Message.init(
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        session_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        thread_id: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        sender_type: {
            type: DataTypes.ENUM('customer', 'admin', 'bot'),
            allowNull: false,
        },
        sender_id: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        body: {
            type: DataTypes.TEXT,
            allowNull: false,
        },
        attachment_url: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        is_read: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
        created_via: {
            type: DataTypes.ENUM('system', 'wa_mobile_sync', 'admin_panel'),
            allowNull: false,
            defaultValue: 'system',
        },
        channel: {
            type: DataTypes.ENUM('app', 'whatsapp'),
            allowNull: false,
            defaultValue: 'app',
        },
        quoted_message_id: {
            type: DataTypes.BIGINT,
            allowNull: true,
        },
        delivery_state: {
            type: DataTypes.ENUM('sent', 'delivered', 'read', 'failed'),
            allowNull: false,
            defaultValue: 'sent',
        },
        read_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'messages',
        indexes: [
            { fields: ['thread_id', 'createdAt'] },
            { fields: ['read_at'] },
            { fields: ['quoted_message_id'] },
        ]
    }
);

export default Message;
