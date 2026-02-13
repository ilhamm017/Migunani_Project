import sequelize from './src/config/database';
import User from './src/models/User';
import bcrypt from 'bcrypt';

async function createAdminUser() {
    try {
        await sequelize.authenticate();
        console.log('✅ Database connected');

        // Sync User model
        await User.sync();

        const hashedPassword = await bcrypt.hash('admin123', 10);

        // Check if admin exists
        const existingAdmin = await User.findOne({
            where: { email: 'admin@migunani.com' }
        });

        if (existingAdmin) {
            // Update password
            existingAdmin.password = hashedPassword;
            await existingAdmin.save();
            console.log('✅ Admin user updated');
        } else {
            // Create new admin
            await User.create({
                name: 'Super Admin',
                email: 'admin@migunani.com',
                password: hashedPassword,
                whatsapp_number: '6281234567890',
                role: 'super_admin',
                status: 'active'
            });
            console.log('✅ Admin user created');
        }

        console.log('\n📝 Login Credentials:');
        console.log('   Email/Username: admin@migunani.com');
        console.log('   Password: admin123');
        console.log('   Role: super_admin');
        console.log('\n🔗 Login URL: http://localhost:3000/auth/login');

        await sequelize.close();
    } catch (error: any) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

createAdminUser();
