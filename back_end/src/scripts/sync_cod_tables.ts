import { CodCollection, CodSettlement, sequelize } from '../models';

async function syncCodTables() {
    try {
        console.log('🔄 Syncing COD Collection & Settlement tables...');
        await CodCollection.sync({ alter: true });
        await CodSettlement.sync({ alter: true });
        console.log('✅ COD tables synced successfully.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error syncing COD tables:', error);
        process.exit(1);
    }
}

syncCodTables();
