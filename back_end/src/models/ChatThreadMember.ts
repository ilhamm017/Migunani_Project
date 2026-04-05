import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export type ChatThreadMemberRole = 'participant' | 'support_agent';

interface ChatThreadMemberAttributes {
    id: number;
    thread_id: string;
    user_id: string;
    member_role: ChatThreadMemberRole;
    joined_at: Date;
}

interface ChatThreadMemberCreationAttributes extends Optional<ChatThreadMemberAttributes, 'id' | 'joined_at' | 'member_role'> { }

class ChatThreadMember extends Model<ChatThreadMemberAttributes, ChatThreadMemberCreationAttributes> implements ChatThreadMemberAttributes {
    declare id: number;
    declare thread_id: string;
    declare user_id: string;
    declare member_role: ChatThreadMemberRole;
    declare joined_at: Date;
}

ChatThreadMember.init(
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        thread_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'chat_threads',
                key: 'id',
            },
        },
        user_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id',
            },
        },
        member_role: {
            type: DataTypes.ENUM('participant', 'support_agent'),
            allowNull: false,
            defaultValue: 'participant',
        },
        joined_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
        }
    },
    {
        sequelize,
        tableName: 'chat_thread_members',
        timestamps: false,
        indexes: [
            { unique: true, fields: ['thread_id', 'user_id'] },
            { name: 'idx_chat_thread_members_user_id', fields: ['user_id'] },
            { name: 'idx_chat_thread_members_thread_id', fields: ['thread_id'] },
        ]
    }
);

export default ChatThreadMember;
