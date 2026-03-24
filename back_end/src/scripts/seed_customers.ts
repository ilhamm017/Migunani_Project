import fs from 'fs';
import path from 'path';
import { sequelize } from '../models';
import { seedCustomersFromData } from '../seeders/seedCustomersFromData';
import { seedCustomersFromExcel } from '../seeders/seedCustomersFromExcel';

const pickExistingPath = (candidates: Array<string | undefined | null>): string | null => {
    for (const candidate of candidates) {
        const next = typeof candidate === 'string' ? candidate.trim() : '';
        if (!next) continue;
        if (fs.existsSync(next)) return next;
    }
    return null;
};

async function run() {
    const excelArg = process.argv[2];
    const envExcelPath = process.env.SEED_CUSTOMERS_EXCEL_PATH;
    const source = String(process.env.SEED_CUSTOMERS_SOURCE || 'data').trim().toLowerCase();
    const defaultExcelPath = '../Pelanggan.xlsx';

    const resolvedExcelPath = pickExistingPath([
        excelArg,
        envExcelPath,
        source === 'excel' ? defaultExcelPath : null,
        excelArg ? path.resolve(process.cwd(), excelArg) : null,
        envExcelPath ? path.resolve(process.cwd(), envExcelPath) : null,
        source === 'excel' ? path.resolve(process.cwd(), defaultExcelPath) : null,
    ]);

    const chunkSize = process.env.SEED_CUSTOMERS_CHUNK_SIZE
        ? Number(process.env.SEED_CUSTOMERS_CHUNK_SIZE)
        : undefined;

    try {
        await sequelize.authenticate();

        if (source === 'excel') {
            if (!resolvedExcelPath) {
                console.error('❌ Excel file not found.');
                console.error('   Provide a path arg, or set SEED_CUSTOMERS_EXCEL_PATH.');
                process.exit(1);
            }

            console.log('👤 Importing customers from Excel (no table drop)...');
            console.log(`   - Excel: ${resolvedExcelPath}`);

            const result = await seedCustomersFromExcel({
                excelPath: resolvedExcelPath,
                chunkSize: Number.isFinite(chunkSize as number) ? (chunkSize as number) : undefined,
            });

            console.log('✅ Customer import completed:');
            console.log(`   - Worksheet: ${result.worksheetName}`);
            console.log(`   - Total rows: ${result.totalRows}`);
            console.log(`   - Parsed: ${result.parsed}`);
            console.log(`   - Inserted: ${result.inserted}`);
            console.log(`   - Deduped: ${result.deduped}`);
            console.log(`   - Skipped existing: ${result.skippedExisting}`);
            console.log(`   - Skipped existing (non-customer): ${result.skippedExistingNonCustomer}`);
            console.log(`   - Skipped(no name): ${result.skippedNoName}`);
            console.log(`   - Invalid phones blanked: ${result.invalidPhonesBlanked}`);
            console.log(`   - Invalid emails blanked: ${result.invalidEmailsBlanked}`);
        } else {
            console.log('👤 Importing customers from embedded seeder data (no table drop)...');
            const result = await seedCustomersFromData();
            console.log('✅ Customer import completed:');
            console.log(`   - Source: ${result.source}`);
            console.log(`   - Parsed: ${result.parsed}`);
            console.log(`   - Inserted: ${result.inserted}`);
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Customer import failed:', error);
        process.exit(1);
    } finally {
        try {
            await sequelize.close();
        } catch {
            // ignore
        }
    }
}

run();
