import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export type ChatThreadType = 'staff_dm' | 'staff_customer' | 'support_omni' | 'wa_lead';

interface ChatThreadAttributes {
    id: string;
    thread_key: string;
    thread_type: ChatThreadType;
    last_message_at: Date;
    is_bot_active: boolean;
    customer_user_id?: string | null;
    external_whatsapp_number?: string | null;
}

interface ChatThreadCreationAttributes extends Optional<
    ChatThreadAttributes,
    'id' | 'last_message_at' | 'is_bot_active' | 'customer_user_id' | 'external_whatsapp_number'
> { }

class ChatThread extends Model<ChatThreadAttributes, ChatThreadCreationAttributes> implements ChatThreadAttributes {
    declare id: string;
    declare thread_key: string;
    declare thread_type: ChatThreadType;
    declare last_message_at: Date;
    declare is_bot_active: boolean;
    declare customer_user_id: string | null;
    declare external_whatsapp_number: string | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

ChatThread.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        thread_key: {
            type: DataTypes.STRING(255),
            allowNull: false,
            unique: true,
        },
        thread_type: {
            type: DataTypes.ENUM('staff_dm', 'staff_customer', 'support_omni', 'wa_lead'),
            allowNull: false,
        },
        last_message_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
        },
        is_bot_active: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        customer_user_id: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        external_whatsapp_number: {
            type: DataTypes.STRING(32),
            allowNull: true,
        }
    },
    {
        sequelize,
        tableName: 'chat_threads',
        indexes: [
            { unique: true, fields: ['thread_key'] },
            { fields: ['thread_type', 'last_message_at'] },
            { fields: ['customer_user_id'] },
            { fields: ['external_whatsapp_number'] },
        ]
    }
);

export default ChatThread;
