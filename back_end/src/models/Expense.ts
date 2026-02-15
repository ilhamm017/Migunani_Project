import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface ExpenseAttributes {
    id: number; // BigInt
    category: string;
    amount: number;
    date: Date;
    note: string;
    status: 'requested' | 'approved' | 'paid' | 'rejected';
    attachment_url?: string | null;
    account_id?: number | null; // Source of funds (Cash/Bank)
    approved_by?: string | null; // UUID
    approved_at?: Date | null;
    paid_at?: Date | null;
    created_by: string; // UUID
}

interface ExpenseCreationAttributes extends Optional<ExpenseAttributes, 'id' | 'status' | 'attachment_url' | 'account_id' | 'approved_by' | 'approved_at' | 'paid_at'> { }

class Expense extends Model<ExpenseAttributes, ExpenseCreationAttributes> implements ExpenseAttributes {
    declare id: number;
    declare category: string;
    declare amount: number;
    declare date: Date;
    declare note: string;
    declare status: 'requested' | 'approved' | 'paid' | 'rejected';
    declare attachment_url: string | null;
    declare account_id: number | null;
    declare approved_by: string | null;
    declare approved_at: Date | null;
    declare paid_at: Date | null;
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
        status: {
            type: DataTypes.ENUM('requested', 'approved', 'paid', 'rejected'),
            allowNull: false,
            defaultValue: 'requested',
        },
        attachment_url: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        account_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: {
                model: 'accounts',
                key: 'id'
            }
        },
        approved_by: {
            type: DataTypes.UUID,
            allowNull: true,
            references: {
                model: 'users',
                key: 'id'
            }
        },
        approved_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        paid_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        created_by: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'users',
                key: 'id'
            }
        },
    },
    {
        sequelize,
        tableName: 'expenses',
        hooks: {
            beforeUpdate: (instance) => {
                if (instance.previous('status') === 'paid' && instance.status !== 'rejected') { // Assuming rejected/refunded allows change
                    // Strict: Once paid, NO editing except maybe special reversal status
                    if (instance.changed('amount') || instance.changed('category')) {
                        throw new Error('Expense yang sudah dibayar tidak boleh diedit nominal/kategori.');
                    }
                }
            },
            beforeDestroy: (instance) => {
                if (instance.status !== 'requested' && instance.status !== 'rejected') {
                    throw new Error('Hanya expense status requested/rejected yang boleh dihapus.');
                }
            }
        }
    }
);

export default Expense;
