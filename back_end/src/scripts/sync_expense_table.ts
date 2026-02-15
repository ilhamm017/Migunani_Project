import { Expense, sequelize } from '../models';

async function syncExpense() {
    try {
        console.log('🔄 Syncing Expense table...');
        await Expense.sync({ alter: true });
        console.log('✅ Expense table synced successfully.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error syncing Expense table:', error);
        process.exit(1);
    }
}

syncExpense();
