import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface ChatSessionAttributes {
    id: string; // UUID
    user_id?: string; // UUID
    whatsapp_number: string;
    platform: 'web' | 'whatsapp';
    is_bot_active: boolean;
    last_message_at: Date;
}

interface ChatSessionCreationAttributes extends Optional<ChatSessionAttributes, 'id' | 'is_bot_active' | 'last_message_at' | 'user_id'> { }

class ChatSession extends Model<ChatSessionAttributes, ChatSessionCreationAttributes> implements ChatSessionAttributes {
    declare id: string;
    declare user_id: string;
    declare whatsapp_number: string;
    declare platform: 'web' | 'whatsapp';
    declare is_bot_active: boolean;
    declare last_message_at: Date;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

ChatSession.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        user_id: {
            type: DataTypes.UUID,
            allowNull: true, // Can be anonymous/unregistered initially? Schema says Nullable.
        },
        whatsapp_number: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        platform: {
            type: DataTypes.ENUM('web', 'whatsapp'),
            allowNull: false,
        },
        is_bot_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
        last_message_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
        },
    },
    {
        sequelize,
        tableName: 'chat_sessions',
        indexes: [
            {
                fields: ['whatsapp_number']
            }
        ]
    }
);

export default ChatSession;
