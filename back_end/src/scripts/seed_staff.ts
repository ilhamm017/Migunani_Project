import 'dotenv/config';
import bcrypt from 'bcrypt';
import { sequelize, User } from '../models';

type SeedStaffUser = {
    name: string;
    email: string;
    password: string;
    role: User['role'];
};

const STAFF_USERS: SeedStaffUser[] = [
    { name: 'Super Admin', email: 'superadmin@migunani.com', password: 'superadmin123', role: 'super_admin' },
    { name: 'Admin Gudang', email: 'gudang@migunani.com', password: 'gudang123', role: 'admin_gudang' },
    { name: 'Admin Finance', email: 'finance@migunani.com', password: 'finance123', role: 'admin_finance' },
    { name: 'Kasir', email: 'kasir@migunani.com', password: 'kasir123', role: 'kasir' },
    { name: 'Driver', email: 'driver@migunani.com', password: 'driver123', role: 'driver' },
    { name: 'Customer', email: 'customer@migunani.com', password: 'customer123', role: 'customer' },
];

async function run() {
    try {
        await sequelize.authenticate();
        const syncMode = String(process.env.DB_SYNC_MODE || 'safe').trim().toLowerCase();
        if (syncMode !== 'off') {
            await sequelize.sync();
        } else {
            console.log('[seed:staff] DB_SYNC_MODE=off: skipping sequelize.sync() (expects schema from migrations)');
        }

        console.log('🌱 Seeding Staff Users...');

        for (const staff of STAFF_USERS) {
            const existing = await User.findOne({ where: { email: staff.email } });
            if (existing) {
                console.log(`ℹ️ User already exists: ${staff.email} (${existing.role})`);
                continue;
            }

            const hashedPassword = await bcrypt.hash(staff.password, 10);
            const created = await User.create({
                name: staff.name,
                email: staff.email,
                password: hashedPassword,
                whatsapp_number: null,
                role: staff.role,
                status: 'active',
                debt: 0,
            } as any);

            console.log(`✅ Created user: ${created.email} (${created.role})`);
        }

        console.log('✅ Staff users seeding completed.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error seeding staff users:', error);
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
