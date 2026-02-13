import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface ExpenseLabelAttributes {
    id: number;
    name: string;
    description: string | null;
}

interface ExpenseLabelCreationAttributes extends Optional<ExpenseLabelAttributes, 'id' | 'description'> { }

class ExpenseLabel extends Model<ExpenseLabelAttributes, ExpenseLabelCreationAttributes> implements ExpenseLabelAttributes {
    declare id: number;
    declare name: string;
    declare description: string | null;

    declare readonly createdAt: Date;
    declare readonly updatedAt: Date;
}

ExpenseLabel.init(
    {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
        },
        name: {
            type: DataTypes.STRING(100),
            allowNull: false,
            unique: true,
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'expense_labels',
    }
);

export default ExpenseLabel;
