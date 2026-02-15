import { Journal, JournalLine, sequelize } from '../models';

async function syncNewModels() {
    try {
        console.log('🔄 Syncing Journal models...');
        await Journal.sync({ alter: true });
        await JournalLine.sync({ alter: true });
        console.log('✅ Journal models synced successfully.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error syncing models:', error);
        process.exit(1);
    }
}

syncNewModels();
