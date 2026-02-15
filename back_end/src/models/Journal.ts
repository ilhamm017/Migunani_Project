import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface JournalAttributes {
    id: number;
    date: Date;
    reference_type: string | null;
    reference_id: string | null;
    description: string;
    created_by: string; // UUID
    posted_at: Date | null;
}

interface JournalCreationAttributes extends Optional<JournalAttributes, 'id' | 'reference_type' | 'reference_id' | 'posted_at'> { }

class Journal extends Model<JournalAttributes, JournalCreationAttributes> implements JournalAttributes {
    declare id: number;
    declare date: Date;
    declare reference_type: string | null;
    declare reference_id: string | null;
    declare description: string;
    declare created_by: string;
    declare posted_at: Date | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

Journal.init(
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        date: {
            type: DataTypes.DATEONLY,
            allowNull: false,
            defaultValue: DataTypes.NOW,
        },
        reference_type: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        reference_id: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: false,
        },
        created_by: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        posted_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'journals',
        hooks: {
            beforeUpdate: () => {
                throw new Error('Journal entries are immutable. Create a reversal entry instead.');
            },
            beforeDestroy: () => {
                throw new Error('Journal entries cannot be deleted. Create a reversal entry instead.');
            }
        }
    }
);

export default Journal;
