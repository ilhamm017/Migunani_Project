import { CustomerProfile, User, sequelize } from '../models';
import { pelangganSeedMeta, pelangganSeedRows } from './data/pelanggan_2026_03_24';

type SeedCustomersFromDataResult = {
    source: string;
    parsed: number;
    inserted: number;
    meta: typeof pelangganSeedMeta;
};

export const seedCustomersFromData = async (): Promise<SeedCustomersFromDataResult> => {
    const t = await sequelize.transaction();
    try {
        let inserted = 0;
        for (const row of pelangganSeedRows) {
            const user = await User.create({
                name: row.name,
                email: row.email,
                password: null,
                whatsapp_number: row.whatsapp_number as any,
                role: 'customer',
                status: 'active',
                debt: 0,
            }, { transaction: t });

            await CustomerProfile.create({
                user_id: user.id,
                tier: 'regular',
                credit_limit: 0,
                points: 0,
                saved_addresses: row.saved_addresses,
            }, { transaction: t });
            inserted += 1;
        }

        await t.commit();
        return {
            source: 'seeders/data/pelanggan_2026_03_24.ts',
            parsed: pelangganSeedRows.length,
            inserted,
            meta: pelangganSeedMeta,
        };
    } catch (error) {
        try { await t.rollback(); } catch { }
        throw error;
    }
};

