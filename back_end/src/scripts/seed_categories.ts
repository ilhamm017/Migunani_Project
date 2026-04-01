import 'dotenv/config';
import { Category, sequelize } from '../models';

const CATEGORY_NAMES: string[] = [
    'NPP PARTS',
    'KAMPAS FEDERAL',
    'AKI INDOPART',
    'BAN LUAR IRC TUBETYPE',
    'OLI SHELL',
    'BAN LUAR IRC TUBELESS HIGH PERFORMANCE',
    'OLI YAMALUBE',
    'BAN LUAR AHM',
    'OLI LAIN LAIN',
    'BAN DALAM FEDERAL',
    'PELUMAS FEDERAL',
    'AKI ASPIRA',
    'BAN LUAR IRC TUBELESS',
    'BEARING FEDERAL',
    'FEDERAL PARTS',
    'PELUMAS AHM',
    'BAN LUAR ASPIRA TUBELESS',
    'BAN DALAM ASPIRA',
    'BAN DALAM IRC',
    'BAN LUAR ASPIRA TUBRTYPE',
    'AKI AHM',
    'OLI PERTAMINA',
    'BAN LUAR MAXXIS',
    'SPAREPART AHM',
    'INDOPART SPAREPART',
];

const main = async () => {
    try {
        await sequelize.authenticate();

        const t = await sequelize.transaction();
        try {
            const beforeCount = await Category.count({ transaction: t });

            const existing = await Category.findAll({
                attributes: ['name'],
                transaction: t,
            });
            const existingNames = new Set(
                existing
                    .map((row) => String(row.get('name') || '').trim())
                    .filter(Boolean)
            );

            const rowsToInsert = CATEGORY_NAMES.map((name) => String(name || '').trim())
                .filter(Boolean)
                .filter((name) => !existingNames.has(name))
                .map((name) => ({
                    name,
                    description: null,
                    icon: 'tag',
                    discount_regular_pct: null,
                    discount_gold_pct: null,
                    discount_premium_pct: null,
                }));

            if (rowsToInsert.length > 0) {
                await Category.bulkCreate(rowsToInsert as any, { transaction: t });
            }

            await t.commit();

            const afterCount = await Category.count();

            console.log('[seed:categories] done', {
                rows: CATEGORY_NAMES.length,
                inserted: rowsToInsert.length,
                beforeCount,
                afterCount,
            });
            process.exit(0);
        } catch (err) {
            try { await t.rollback(); } catch { }
            throw err;
        }
    } catch (error) {
        console.error('[seed:categories] failed:', error);
        process.exit(1);
    } finally {
        try { await sequelize.close(); } catch { }
    }
};

main();
