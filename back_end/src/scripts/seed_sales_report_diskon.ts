import 'dotenv/config';
import { sequelize } from '../models';
import { seedPurchaseHistoryFromSalesReport } from '../seeders/seedPurchaseHistoryFromSalesReport';
import { seedGoldDiscountsFromSalesReport } from '../seeders/seedGoldDiscountsFromSalesReport';

type DbSyncMode = 'alter' | 'safe' | 'off';

const resolveDbSyncMode = (): DbSyncMode => {
    // Default to 'safe' to avoid any destructive/DDL-altering behavior during seeding unless explicitly requested.
    const rawMode = String(process.env.DB_SYNC_MODE || 'safe').trim().toLowerCase();
    if (rawMode === 'safe' || rawMode === 'off' || rawMode === 'alter') return rawMode;
    console.warn(`[seed:sales-report] Unknown DB_SYNC_MODE='${rawMode}', fallback to 'safe'`);
    return 'safe';
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

        const purchase = await seedPurchaseHistoryFromSalesReport();
        console.log('[seed:sales-report] purchase history:', purchase);

        const discounts = await seedGoldDiscountsFromSalesReport();
        console.log('[seed:sales-report] gold discounts:', discounts);

        process.exit(0);
    } catch (error) {
        console.error('[seed:sales-report] failed:', error);
        process.exit(1);
    }
};

main();
