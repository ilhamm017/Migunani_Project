import { AccountingPeriod, sequelize } from '../models';

async function syncPeriod() {
    try {
        console.log('🔄 Syncing AccountingPeriod table...');
        await AccountingPeriod.sync({ alter: true });
        console.log('✅ AccountingPeriod table synced successfully.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error syncing AccountingPeriod table:', error);
        process.exit(1);
    }
}

syncPeriod();
