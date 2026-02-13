// Script untuk membuat admin user test
require('dotenv').config();
const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcrypt');

const sequelize = new Sequelize(
    process.env.DB_NAME || 'migunani_wms',
    process.env.DB_USER || 'postgres',
    process.env.DB_PASSWORD || 'postgres',
    {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        dialect: 'postgres',
        logging: false
    }
);

async function createAdminUser() {
    try {
        await sequelize.authenticate();
        console.log('✅ Database connected');

        const hashedPassword = await bcrypt.hash('admin123', 10);

        const [result] = await sequelize.query(`
            INSERT INTO users (id, name, email, password, whatsapp_number, role, status, "createdAt", "updatedAt")
            VALUES (
                gen_random_uuid(),
                'Super Admin',
                'admin@migunani.com',
                '${hashedPassword}',
                '6281234567890',
                'super_admin',
                'active',
                NOW(),
                NOW()
            )
            ON CONFLICT (email) DO UPDATE SET
                password = '${hashedPassword}',
                "updatedAt" = NOW()
            RETURNING id, name, email, role;
        `);

        console.log('✅ Admin user created/updated:');
        console.log('   Email: admin@migunani.com');
        console.log('   Password: admin123');
        console.log('   Role: super_admin');
        console.log('\n📝 Login credentials:');
        console.log('   Username: admin@migunani.com');
        console.log('   Password: admin123');

        await sequelize.close();
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

createAdminUser();
