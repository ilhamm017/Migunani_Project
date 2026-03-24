import 'dotenv/config';
import { sequelize } from '../models';
import { seedPurchaseHistoryFromSalesReport } from '../seeders/seedPurchaseHistoryFromSalesReport';
import { seedGoldDiscountsFromSalesReport } from '../seeders/seedGoldDiscountsFromSalesReport';

type DbSyncMode = 'alter' | 'safe' | 'off';

const resolveDbSyncMode = (): DbSyncMode => {
    const rawMode = String(process.env.DB_SYNC_MODE || 'alter').trim().toLowerCase();
    if (rawMode === 'safe' || rawMode === 'off' || rawMode === 'alter') return rawMode;
    console.warn(`[seed:sales-report] Unknown DB_SYNC_MODE='${rawMode}', fallback to 'alter'`);
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
