import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface OrderIssueAttributes {
    id: string;
    order_id: string;
    issue_type: 'shortage' | 'missing_item';
    status: 'open' | 'resolved';
    note: string | null;
    due_at: Date;
    resolved_at: Date | null;
    created_by: string | null;
    resolved_by: string | null;
}

interface OrderIssueCreationAttributes extends Optional<OrderIssueAttributes, 'id' | 'status' | 'note' | 'resolved_at' | 'created_by' | 'resolved_by'> { }

class OrderIssue extends Model<OrderIssueAttributes, OrderIssueCreationAttributes> implements OrderIssueAttributes {
    declare id: string;
    declare order_id: string;
    declare issue_type: 'shortage' | 'missing_item';
    declare status: 'open' | 'resolved';
    declare note: string | null;
    declare due_at: Date;
    declare resolved_at: Date | null;
    declare created_by: string | null;
    declare resolved_by: string | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

OrderIssue.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        order_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        issue_type: {
            type: DataTypes.ENUM('shortage', 'missing_item'),
            allowNull: false,
        },
        status: {
            type: DataTypes.ENUM('open', 'resolved'),
            allowNull: false,
            defaultValue: 'open',
        },
        note: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        due_at: {
            type: DataTypes.DATE,
            allowNull: false,
        },
        resolved_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        created_by: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        resolved_by: {
            type: DataTypes.UUID,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'order_issues',
        indexes: [
            { fields: ['order_id'] },
            { fields: ['status'] },
            { fields: ['due_at'] },
        ],
    }
);

export default OrderIssue;
