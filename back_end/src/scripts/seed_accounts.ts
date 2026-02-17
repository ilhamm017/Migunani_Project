
import { Account } from '../models';
import sequelize from '../config/database';

async function seedAccounts() {
    try {
        console.log('🌱 Seeding Accounts...');

        await Account.sync({ alter: true });

        const accounts = [
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
            { code: '2202', name: 'PPN Masukan', type: 'asset' },
            { code: '2203', name: 'Hutang Refund', type: 'liability' },
            { code: '2300', name: 'Pendapatan Ditangguhkan', type: 'liability' },
            // EQUITY
            { code: '3100', name: 'Modal', type: 'equity' },
            { code: '3200', name: 'Laba Ditahan', type: 'equity' },
            // REVENUE
            { code: '4100', name: 'Penjualan', type: 'revenue' },
            { code: '4101', name: 'Retur Penjualan', type: 'revenue' },
            // EXPENSE
            { code: '5100', name: 'HPP', type: 'expense' },
            { code: '5200', name: 'Gaji', type: 'expense' },
            { code: '5300', name: 'Operasional', type: 'expense' },
            { code: '5400', name: 'Refund', type: 'expense' },
            { code: '5500', name: 'Transport', type: 'expense' },
            { code: '5600', name: 'Kerugian Penyesuaian Stok', type: 'expense' },
            { code: '4200', name: 'Keuntungan Penyesuaian Stok', type: 'revenue' },
        ];

        for (const acc of accounts) {
            const [account, created] = await Account.findOrCreate({
                where: { code: acc.code },
                defaults: {
                    ...acc,
                    type: acc.type as any,
                    is_active: true
                }
            });

            if (created) {
                console.log(`✅ Created account: ${acc.code} - ${acc.name}`);
            } else {
                console.log(`ℹ️ Account already exists: ${acc.code} - ${acc.name}`);
            }
        }

        console.log('✅ Accounts seeding completed.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error seeding accounts:', error);
        process.exit(1);
    }
}

seedAccounts();
