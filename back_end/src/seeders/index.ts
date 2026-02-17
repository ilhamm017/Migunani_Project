import bcrypt from 'bcrypt';
import {
    sequelize,
    User,
    Category,
    Product,
    Supplier,
    Account,
    Setting
} from '../models';
import { acquireSchemaLock, SchemaLockError } from '../utils/schemaLock';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isDeadlockError = (error: any): boolean => {
    const code = error?.parent?.code || error?.original?.code || error?.code;
    return code === 'ER_LOCK_DEADLOCK';
};

const isSchemaLockBusyError = (error: any): boolean => {
    return error instanceof SchemaLockError && error.code === 'SCHEMA_LOCK_TIMEOUT';
};

const syncWithForceRetry = async () => {
    const isMySql = sequelize.getDialect() === 'mysql';
    const maxAttempts = 5;
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        let schemaLock: Awaited<ReturnType<typeof acquireSchemaLock>> | null = null;
        try {
            schemaLock = await acquireSchemaLock(sequelize, { timeoutSec: 10 });
            console.log(`[SchemaLock] Acquired '${schemaLock.lockName}' for seeding`);

            if (isMySql) {
                await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
            }
            await sequelize.sync({ force: true }); // WARNING: This will drop all tables!
            return;
        } catch (error) {
            lastError = error;
            if ((isDeadlockError(error) || isSchemaLockBusyError(error)) && attempt < maxAttempts) {
                const delayMs = attempt * 2000;
                const reason = isSchemaLockBusyError(error)
                    ? 'Schema lock busy'
                    : 'Deadlock during seed sync';
                console.warn(`${reason} (attempt ${attempt}/${maxAttempts}). Retrying in ${delayMs}ms...`);
                await sleep(delayMs);
                continue;
            }
            throw error;
        } finally {
            if (isMySql) {
                try {
                    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
                } catch {
                    // Ignore FK reset errors during retries; next attempt will retry sync.
                }
            }
            if (schemaLock) {
                try {
                    await schemaLock.release();
                    console.log(`[SchemaLock] Released '${schemaLock.lockName}' for seeding`);
                } catch (releaseError) {
                    console.warn('[SchemaLock] Failed to release seeding lock:', releaseError);
                }
            }
        }
    }

    throw lastError || new Error('Failed to sync database for seeding');
};

async function seedDatabase() {
    try {
        console.log('🌱 Starting database seeding...\n');

        // Sync database (create tables)
        console.log('📊 Syncing database...');
        await syncWithForceRetry();
        console.log('✅ Database synced\n');

        // Seed Users (one account per role)
        console.log('👥 Seeding users...');
        const userSeeds: Array<{
            name: string;
            email: string;
            password: string;
            whatsapp_number: string;
            role: 'super_admin' | 'admin_gudang' | 'admin_finance' | 'kasir' | 'driver' | 'customer';
            debt?: number;
        }> = [
                {
                    name: 'Super Admin Migunani/Owner',
                    email: 'superadmin@migunani.com',
                    password: 'superadmin123',
                    whatsapp_number: '6281111111101',
                    role: 'super_admin'
                },
                {
                    name: 'Admin Gudang',
                    email: 'gudang@migunani.com',
                    password: 'gudang123',
                    whatsapp_number: '6281111111102',
                    role: 'admin_gudang'
                },
                {
                    name: 'Admin Finance',
                    email: 'finance@migunani.com',
                    password: 'finance123',
                    whatsapp_number: '6281111111103',
                    role: 'admin_finance'
                },
                {
                    name: 'Kasir Utama',
                    email: 'kasir@migunani.com',
                    password: 'kasir123',
                    whatsapp_number: '6281111111104',
                    role: 'kasir'
                },
                {
                    name: 'Driver Budi',
                    email: 'driver1@migunani.com',
                    password: 'driver123',
                    whatsapp_number: '6281111111105',
                    role: 'driver'
                },
                {
                    name: 'Driver Joko',
                    email: 'driver2@migunani.com',
                    password: 'driver123',
                    whatsapp_number: '6281111111109',
                    role: 'driver'
                },
                {
                    name: 'Customer Andi',
                    email: 'customer1@migunani.com',
                    password: 'customer123',
                    whatsapp_number: '6281111111106',
                    role: 'customer'
                },
                {
                    name: 'Customer Siti',
                    email: 'customer2@migunani.com',
                    password: 'customer123',
                    whatsapp_number: '6281111111107',
                    role: 'customer'
                },
                {
                    name: 'Bengkel Maju Jaya (Customer)',
                    email: 'bengkel@migunani.com',
                    password: 'customer123',
                    whatsapp_number: '6281111111108',
                    role: 'customer',
                    debt: 500000 // Simulasi utang awal
                },
            ];

        for (const userSeed of userSeeds) {
            const hashedPassword = await bcrypt.hash(userSeed.password, 10);
            await User.create({
                name: userSeed.name,
                email: userSeed.email,
                password: hashedPassword,
                whatsapp_number: userSeed.whatsapp_number,
                role: userSeed.role,
                status: 'active',
                debt: userSeed.debt || 0
            });
        }

        console.log('✅ Users created:');
        userSeeds.forEach((userSeed) => {
            console.log(`   - ${userSeed.role}: ${userSeed.email} / ${userSeed.password}`);
        });
        console.log('');

        // Seed Categories
        console.log('📁 Seeding categories...');
        const categoryData = [
            { name: 'Ban Motor', description: 'Ban motor berbagai ukuran', icon: 'circle-dot' },
            { name: 'Oli & Pelumas', description: 'Oli mesin dan pelumas motor', icon: 'droplets' },
            { name: 'Kampas Rem', description: 'Kampas rem depan dan belakang', icon: 'disc-3' },
            { name: 'Lampu', description: 'Lampu motor LED dan halogen', icon: 'lightbulb' },
            { name: 'Aki & Baterai', description: 'Aki motor berbagai merk', icon: 'battery-charging' },
            { name: 'Filter', description: 'Filter udara dan oli', icon: 'funnel' },
            { name: 'Suku Cadang Mesin', description: 'Komponen mesin motor', icon: 'settings' },
        ];

        const categories: Category[] = [];
        for (const data of categoryData) {
            const cat = await Category.create(data);
            categories.push(cat);
        }
        console.log(`✅ ${categories.length} categories created\n`);

        // Seed Suppliers
        console.log('🏢 Seeding suppliers...');
        const suppliers = await Supplier.bulkCreate([
            { name: 'PT Astra Motor', contact: '081234567890', address: 'Jakarta' },
            { name: 'CV Jaya Motor', contact: '081234567891', address: 'Bandung' },
            { name: 'UD Maju Jaya', contact: '081234567892', address: 'Surabaya' },
        ]);
        console.log(`✅ ${suppliers.length} suppliers created\n`);

        // Seed Accounts (Chart of Accounts)
        console.log('💳 Seeding accounts...');
        const accountsData = [
            // ASSET
            { code: '1101', name: 'Kas', type: 'asset' },
            { code: '1102', name: 'Bank', type: 'asset' },
            { code: '1103', name: 'Piutang Usaha', type: 'asset' },
            { code: '1104', name: 'Piutang Driver', type: 'asset' },
            { code: '1105', name: 'Piutang Karyawan/Driver', type: 'asset' },
            { code: '1300', name: 'Persediaan', type: 'asset' },
            // LIABILITY
            { code: '2100', name: 'Hutang Supplier', type: 'liability' },
            { code: '2201', name: 'PPN Keluaran', type: 'liability' },
            { code: '2203', name: 'Hutang Refund', type: 'liability' },
            { code: '2300', name: 'Pendapatan Ditangguhkan', type: 'liability' },
            // EQUITY
            { code: '3100', name: 'Modal', type: 'equity' },
            { code: '3200', name: 'Laba Ditahan', type: 'equity' },
            // REVENUE
            { code: '4100', name: 'Penjualan', type: 'revenue' },
            { code: '4101', name: 'Retur Penjualan', type: 'revenue' },
            { code: '4200', name: 'Keuntungan Penyesuaian Stok', type: 'revenue' },
            // EXPENSE
            { code: '5100', name: 'HPP', type: 'expense' },
            { code: '5200', name: 'Gaji', type: 'expense' },
            { code: '5300', name: 'Operasional', type: 'expense' },
            { code: '5400', name: 'Refund', type: 'expense' },
            { code: '5500', name: 'Transport', type: 'expense' },
            { code: '5600', name: 'Kerugian Penyesuaian Stok', type: 'expense' },
            { code: '2202', name: 'PPN Masukan', type: 'asset' },
        ];

        for (const acc of accountsData) {
            await Account.create({
                ...acc,
                type: acc.type as any,
                is_active: true
            });
        }
        console.log(`✅ ${accountsData.length} accounts created\n`);

        await Setting.create({
            key: 'company_tax_config',
            value: {
                company_tax_mode: 'non_pkp',
                vat_percent: 11,
                pph_final_percent: 0.5
            },
            description: 'Default tax configuration'
        });

        // Seed Products
        console.log('📦 Seeding products...');
        const products = await Product.bulkCreate([
            // Ban Motor
            {
                sku: 'BAN-001',
                barcode: '8991234560001',
                name: 'Ban Motor Tubeless 80/90-17',
                base_price: 200000,
                price: 250000,
                unit: 'Pcs',
                stock_quantity: 25,
                min_stock: 5,
                category_id: categories[0].id,
                status: 'active',
            },
            {
                sku: 'BAN-002',
                barcode: '8991234560002',
                name: 'Ban Motor Tubeless 90/90-14',
                base_price: 180000,
                price: 220000,
                unit: 'Pcs',
                stock_quantity: 20,
                min_stock: 5,
                category_id: categories[0].id,
                status: 'active',
            },
            {
                sku: 'BAN-003',
                barcode: '8991234560003',
                name: 'Ban Motor Tubeless 70/90-17',
                base_price: 190000,
                price: 240000,
                unit: 'Pcs',
                stock_quantity: 15,
                min_stock: 5,
                category_id: categories[0].id,
                status: 'active',
            },

            // Oli & Pelumas
            {
                sku: 'OLI-001',
                barcode: '8991234560011',
                name: 'Oli Mesin Synthetic 1L - SHELL',
                base_price: 70000,
                price: 85000,
                unit: 'Liter',
                stock_quantity: 50,
                min_stock: 10,
                category_id: categories[1].id,
                status: 'active',
            },
            {
                sku: 'OLI-002',
                barcode: '8991234560012',
                name: 'Oli Mesin Semi-Synthetic 1L - CASTROL',
                base_price: 55000,
                price: 70000,
                unit: 'Liter',
                stock_quantity: 40,
                min_stock: 10,
                category_id: categories[1].id,
                status: 'active',
            },
            {
                sku: 'OLI-003',
                barcode: '8991234560013',
                name: 'Oli Top 1 Action Matic 0.8L',
                base_price: 35000,
                price: 45000,
                unit: 'Liter',
                stock_quantity: 60,
                min_stock: 15,
                category_id: categories[1].id,
                status: 'active',
            },

            // Kampas Rem
            {
                sku: 'KRM-001',
                barcode: '8991234560021',
                name: 'Kampas Rem Depan Honda Beat',
                base_price: 35000,
                price: 45000,
                unit: 'Set',
                stock_quantity: 30,
                min_stock: 8,
                category_id: categories[2].id,
                status: 'active',
            },
            {
                sku: 'KRM-002',
                barcode: '8991234560022',
                name: 'Kampas Rem Belakang Yamaha Mio',
                base_price: 30000,
                price: 40000,
                unit: 'Set',
                stock_quantity: 25,
                min_stock: 8,
                category_id: categories[2].id,
                status: 'active',
            },

            // Lampu
            {
                sku: 'LMP-001',
                barcode: '8991234560031',
                name: 'Lampu LED Motor H4 6000K',
                base_price: 95000,
                price: 120000,
                unit: 'Pcs',
                stock_quantity: 18,
                min_stock: 5,
                category_id: categories[3].id,
                status: 'active',
            },
            {
                sku: 'LMP-002',
                barcode: '8991234560032',
                name: 'Lampu Senja LED T10',
                base_price: 15000,
                price: 25000,
                unit: 'Pasang',
                stock_quantity: 40,
                min_stock: 10,
                category_id: categories[3].id,
                status: 'active',
            },

            // Aki & Baterai
            {
                sku: 'AKI-001',
                barcode: '8991234560041',
                name: 'Aki Motor Yuasa 12V 5AH',
                base_price: 200000,
                price: 250000,
                unit: 'Pcs',
                stock_quantity: 12,
                min_stock: 3,
                category_id: categories[4].id,
                status: 'active',
            },
            {
                sku: 'AKI-002',
                barcode: '8991234560042',
                name: 'Aki Motor GS Astra 12V 3.5AH',
                base_price: 150000,
                price: 190000,
                unit: 'Pcs',
                stock_quantity: 15,
                min_stock: 3,
                category_id: categories[4].id,
                status: 'active',
            },

            // Filter
            {
                sku: 'FIL-001',
                barcode: '8991234560051',
                name: 'Filter Udara Honda Vario 125',
                base_price: 40000,
                price: 55000,
                unit: 'Pcs',
                stock_quantity: 22,
                min_stock: 5,
                category_id: categories[5].id,
                status: 'active',
            },
            {
                sku: 'FIL-002',
                barcode: '8991234560052',
                name: 'Filter Oli Yamaha NMAX',
                base_price: 35000,
                price: 50000,
                unit: 'Pcs',
                stock_quantity: 20,
                min_stock: 5,
                category_id: categories[5].id,
                status: 'active',
            },

            // Suku Cadang Mesin
            {
                sku: 'MSN-001',
                barcode: '8991234560061',
                name: 'Piston Kit Honda Beat',
                base_price: 180000,
                price: 230000,
                unit: 'Set',
                stock_quantity: 8,
                min_stock: 2,
                category_id: categories[6].id,
                status: 'active',
            },
            {
                sku: 'MSN-002',
                barcode: '8991234560062',
                name: 'Bearing Kruk As Yamaha Mio',
                base_price: 120000,
                price: 160000,
                unit: 'Set',
                stock_quantity: 10,
                min_stock: 2,
                category_id: categories[6].id,
                status: 'active',
            },

            // Additional products (out of stock example)
            {
                sku: 'OLI-004',
                barcode: '8991234560014',
                name: 'Oli Mesin Premium 1L - MOTUL',
                base_price: 90000,
                price: 115000,
                unit: 'Liter',
                stock_quantity: 0, // Out of stock
                min_stock: 5,
                category_id: categories[1].id,
                status: 'active',
            },
        ]);

        console.log(`✅ ${products.length} products created\n`);

        console.log('🎉 Database seeding completed successfully!\n');
        console.log('📋 Summary:');
        console.log(`   - Users: ${userSeeds.length} (semua role)`);
        console.log(`   - Categories: ${categories.length}`);
        console.log(`   - Suppliers: ${suppliers.length}`);
        console.log(`   - Accounts: ${accountsData.length}`);
        console.log(`   - Products: ${products.length}`);
        console.log('\n🔐 Login Credentials:');
        userSeeds.forEach((userSeed) => {
            console.log(`   ${userSeed.role}: ${userSeed.email} / ${userSeed.password}`);
        });
        console.log('');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error seeding database:', error);
        process.exit(1);
    }
}

// Run seeder
seedDatabase();
