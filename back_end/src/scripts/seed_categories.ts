import 'dotenv/config';
import { Category, sequelize } from '../models';

type CategorySeedRow = {
    id: number;
    name: string;
};

const CATEGORY_SEED: CategorySeedRow[] = [
    { id: 28, name: 'NPP PARTS' },
    { id: 29, name: 'BAN DALAM ASPIRA' },
    { id: 30, name: 'OLI PERTAMINA' },
    { id: 31, name: 'OLI YAMALUBE' },
    { id: 32, name: 'OLI SHELL' },
    { id: 33, name: 'PELUMAS AHM' },
    { id: 34, name: 'PELUMAS FEDERAL' },
    { id: 35, name: 'SPAREPART AHM' },
    { id: 36, name: 'AKI AHM' },
    { id: 37, name: 'BAN LUAR ASPIRA TUBELESS' },
    { id: 38, name: 'BAN LUAR AHM' },
    { id: 39, name: 'BAN LUAR ASPIRA TUBETYPE' },
    { id: 40, name: 'BAN LUAR IRC TUBELESS' },
    { id: 41, name: 'BAN LUAR IRC TUBELESS HIGH PERFORMANCE' },
    { id: 42, name: 'BAN LUAR IRC TUBETYPE' },
    { id: 99, name: 'OLI LAIN LAIN' },
    { id: 43, name: 'AKI INDOPART' },
    { id: 44, name: 'SPAREPART INDOPART' },
    { id: 45, name: 'BAN DALAM IRC' },
    { id: 46, name: 'FEDERAL PARTS' },
    { id: 47, name: 'KAMPAS FEDERAL' },
    { id: 48, name: 'BEARING FEDERAL' },
    { id: 49, name: 'AKI ASPIRA' },
    { id: 50, name: 'BAN DALAM FEDERAL' },
    { id: 51, name: 'BAN LUAR MAXXIS' },
];

const main = async () => {
    try {
        await sequelize.authenticate();

        const t = await sequelize.transaction();
        try {
            const beforeCount = await Category.count({ transaction: t });

            await Category.bulkCreate(
                CATEGORY_SEED.map((row) => ({
                    id: row.id,
                    name: row.name.trim(),
                    description: null,
                    icon: 'tag',
                    discount_regular_pct: null,
                    discount_gold_pct: null,
                    discount_premium_pct: null,
                })) as any,
                {
                    transaction: t,
                    updateOnDuplicate: [
                        'name',
                        'description',
                        'icon',
                        'discount_regular_pct',
                        'discount_gold_pct',
                        'discount_premium_pct',
                    ],
                }
            );

            await t.commit();

            const afterCount = await Category.count();
            const maxId = Number(await Category.max('id'));
            if (Number.isFinite(maxId) && maxId > 0) {
                await sequelize.query(`ALTER TABLE categories AUTO_INCREMENT = ${maxId + 1};`);
            }

            console.log('[seed:categories] done', {
                rows: CATEGORY_SEED.length,
                beforeCount,
                afterCount,
                maxId,
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
