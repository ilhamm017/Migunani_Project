import {
    Account,
    Journal,
    JournalLine,
    CodCollection,
    CodSettlement,
    AccountingPeriod,
    Expense,
    ExpenseLabel,
    sequelize
} from '../models';

async function syncFinanceModels() {
    try {
        console.log('🔄 Syncing all Finance models...');

        // Order matters for FK constraints
        await Account.sync({ alter: true });
        console.log('✅ Account table synced.');

        await Journal.sync({ alter: true });
        console.log('✅ Journal table synced.');

        await JournalLine.sync({ alter: true });
        console.log('✅ JournalLine table synced.');

        await AccountingPeriod.sync({ alter: true });
        console.log('✅ AccountingPeriod table synced.');

        await ExpenseLabel.sync({ alter: true });
        console.log('✅ ExpenseLabel table synced.');

        await Expense.sync({ alter: true });
        console.log('✅ Expense table synced.');

        await CodSettlement.sync({ alter: true });
        console.log('✅ CodSettlement table synced.');

        await CodCollection.sync({ alter: true });
        console.log('✅ CodCollection table synced.');

        console.log('🎉 All Finance models synced successfully.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error syncing Finance models:', error);
        process.exit(1);
    }
}

syncFinanceModels();
