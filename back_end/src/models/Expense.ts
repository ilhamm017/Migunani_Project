import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface ExpenseAttributes {
    id: string; // BigInt
    category: string;
    amount: number;
    date: Date;
    note: string;
    created_by: string; // UUID
}

interface ExpenseCreationAttributes extends Optional<ExpenseAttributes, 'id'> { }

class Expense extends Model<ExpenseAttributes, ExpenseCreationAttributes> implements ExpenseAttributes {
    declare id: string;
    declare category: string;
    declare amount: number;
    declare date: Date;
    declare note: string;
    declare created_by: string;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

Expense.init(
    {
        id: {
            type: DataTypes.BIGINT,
            autoIncrement: true,
            primaryKey: true,
        },
        category: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        amount: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: false,
        },
        date: {
            type: DataTypes.DATEONLY,
            allowNull: false,
        },
        note: {
            type: DataTypes.TEXT,
            allowNull: false,
        },
        created_by: {
            type: DataTypes.UUID,
            allowNull: false,
        },
    },
    {
        sequelize,
        tableName: 'expenses',
    }
);

export default Expense;
