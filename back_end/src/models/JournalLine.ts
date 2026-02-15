import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface JournalLineAttributes {
    id: number;
    journal_id: number;
    account_id: number;
    debit: number;
    credit: number;
}

interface JournalLineCreationAttributes extends Optional<JournalLineAttributes, 'id'> { }

class JournalLine extends Model<JournalLineAttributes, JournalLineCreationAttributes> implements JournalLineAttributes {
    declare id: number;
    declare journal_id: number;
    declare account_id: number;
    declare debit: number;
    declare credit: number;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

JournalLine.init(
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        journal_id: {
            type: DataTypes.BIGINT,
            allowNull: false,
            references: {
                model: 'journals',
                key: 'id'
            },
            onDelete: 'CASCADE'
        },
        account_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'accounts',
                key: 'id'
            }
        },
        debit: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0,
        },
        credit: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
            defaultValue: 0,
        },
    },
    {
        sequelize,
        tableName: 'journal_lines',
    }
);

export default JournalLine;
