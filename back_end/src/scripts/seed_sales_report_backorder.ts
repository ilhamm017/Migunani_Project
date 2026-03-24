import 'dotenv/config';
import { sequelize } from '../models';
import { seedPurchaseHistoryFromBackorderReport } from '../seeders/seedPurchaseHistoryFromBackorderReport';

type DbSyncMode = 'alter' | 'safe' | 'off';

const resolveDbSyncMode = (): DbSyncMode => {
    const rawMode = String(process.env.DB_SYNC_MODE || 'alter').trim().toLowerCase();
    if (rawMode === 'safe' || rawMode === 'off' || rawMode === 'alter') return rawMode;
    console.warn(`[seed:sales-report-backorder] Unknown DB_SYNC_MODE='${rawMode}', fallback to 'alter'`);
    return 'alter';
};

const main = async () => {
    try {
        await sequelize.authenticate();

        const syncMode = resolveDbSyncMode();
        if (syncMode !== 'off') {
            if (syncMode === 'safe') {
                await sequelize.sync();
            } else {
                await sequelize.sync({ alter: true });
            }
        }

        const result = await seedPurchaseHistoryFromBackorderReport({
            createMissingCustomers: String(process.env.SEED_BACKORDER_CREATE_CUSTOMERS || '').trim() === 'true'
        });
        console.log('[seed:sales-report-backorder] result:', result);
        if (result.missingCustomers.length > 0) {
            console.warn('[seed:sales-report-backorder] missing customers (skipped invoices):', result.missingCustomers);
        }

        process.exit(0);
    } catch (error) {
        console.error('[seed:sales-report-backorder] failed:', error);
        process.exit(1);
    } finally {
        try {
            await sequelize.close();
        } catch {
            // ignore
        }
    }
};

main();

