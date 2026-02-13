import sequelize from '../config/database';
import bcrypt from 'bcrypt';
import User from '../models/User';
import Category from '../models/Category';
import Product from '../models/Product';
import Supplier from '../models/Supplier';

async function seedDatabase() {
    try {
        console.log('🌱 Starting database seeding...\n');

        // Sync database (create tables)
        console.log('📊 Syncing database...');
        await sequelize.sync({ force: true }); // WARNING: This will drop all tables!
        console.log('✅ Database synced\n');

        // Seed Users (one account per role)
        console.log('👥 Seeding users...');
        const userSeeds: Array<{
            name: string;
            email: string;
            password: string;
            whatsapp_number: string;
            role: 'super_admin' | 'admin_gudang' | 'admin_finance' | 'kasir' | 'driver' | 'customer';
        }> = [
                {
                    name: 'Super Admin Migunani',
                    email: 'superadmin@migunani.com',
                    password: 'superadmin123',
                    whatsapp_number: '6281111111101',
                    role: 'super_admin'
                },
                {
                    name: 'Admin Gudang Migunani',
                    email: 'gudang@migunani.com',
                    password: 'gudang123',
                    whatsapp_number: '6281111111102',
                    role: 'admin_gudang'
                },
                {
                    name: 'Admin Finance Migunani',
                    email: 'finance@migunani.com',
                    password: 'finance123',
                    whatsapp_number: '6281111111103',
                    role: 'admin_finance'
                },
                {
                    name: 'Kasir Migunani',
                    email: 'kasir@migunani.com',
                    password: 'kasir123',
                    whatsapp_number: '6281111111104',
                    role: 'kasir'
                },
                {
                    name: 'Driver Migunani',
                    email: 'driver@migunani.com',
                    password: 'driver123',
                    whatsapp_number: '6281111111105',
                    role: 'driver'
                },
                {
                    name: 'Customer Test',
                    email: 'customer@migunani.com',
                    password: 'customer123',
                    whatsapp_number: '6281111111106',
                    role: 'customer'
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
