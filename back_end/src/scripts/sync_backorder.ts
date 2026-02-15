import { Backorder, sequelize } from '../models';

async function syncBackorder() {
    try {
        console.log('🔄 Syncing Backorder table...');
        await Backorder.sync({ alter: true });
        console.log('✅ Backorder table synced successfully.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error syncing Backorder table:', error);
        process.exit(1);
    }
}

syncBackorder();
