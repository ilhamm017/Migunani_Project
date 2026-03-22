import { Product, Setting, sequelize } from '../models';
import {
    VEHICLE_TYPES_SETTING_KEY,
    dedupeCaseInsensitive,
    parseVehicleCompatibilityDbString,
    toVehicleCompatibilityDbValue
} from '../utils/vehicleCompatibility';

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    console.log(`[backfill_vehicle_compatibility] start dryRun=${dryRun}`);

    const products = await Product.findAll({
        attributes: ['id', 'vehicle_compatibility'],
        where: {}
    });

    let updatedProducts = 0;
    const allTokens: string[] = [];

    for (const product of products) {
        const tokens = parseVehicleCompatibilityDbString(product.vehicle_compatibility);
        allTokens.push(...tokens);
        const nextValue = toVehicleCompatibilityDbValue(tokens);
        if (nextValue === product.vehicle_compatibility) continue;

        updatedProducts += 1;
        if (!dryRun) {
            await Product.update(
                { vehicle_compatibility: nextValue },
                { where: { id: product.id } }
            );
        }
    }

    const masterList = dedupeCaseInsensitive(allTokens);
    if (!dryRun) {
        await Setting.upsert({
            key: VEHICLE_TYPES_SETTING_KEY,
            value: masterList,
            description: 'Master list aplikasi/jenis kendaraan untuk field products.vehicle_compatibility'
        });
    }

    console.log(`[backfill_vehicle_compatibility] products_updated=${updatedProducts} master_count=${masterList.length}`);
    console.log('[backfill_vehicle_compatibility] done');
}

main()
    .then(() => sequelize.close())
    .then(() => process.exit(0))
    .catch(async (err) => {
        console.error('[backfill_vehicle_compatibility] failed', err);
        try { await sequelize.close(); } catch { }
        process.exit(1);
    });

