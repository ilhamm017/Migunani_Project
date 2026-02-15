
import { Account, Journal, Expense, Invoice, Order, User, Product } from '../models';
import sequelize from '../config/database';

async function checkSystem() {
    try {
        console.log('🔍 Checking System Status...');

        await sequelize.authenticate();
        console.log('✅ Database Connection: OK');

        const accountCount = await Account.count();
        console.log(`📊 Accounts: ${accountCount}`);

        const journalCount = await Journal.count();
        console.log(`📒 Journals: ${journalCount}`);

        const expenseCount = await Expense.count();
        console.log(`💸 Expenses: ${expenseCount}`);

        const invoiceCount = await Invoice.count();
        console.log(`🧾 Invoices: ${invoiceCount}`);

        const orderCount = await Order.count();
        console.log(`📦 Orders: ${orderCount}`);

        const productCount = await Product.count();
        console.log(`🏭 Products: ${productCount}`);

        const userCount = await User.count();
        console.log(`👥 Users: ${userCount}`);

        if (accountCount === 0) {
            console.warn('⚠️ No accounts found! Run seed_accounts.ts');
        } else {
            console.log('✅ Chart of Accounts is populated.');
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ System Check Failed:', error);
        process.exit(1);
    }
}

checkSystem();
