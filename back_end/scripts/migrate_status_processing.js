
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('migunani_motor_db', 'root', 'password', {
    host: 'localhost',
    dialect: 'mysql',
    logging: false
});

async function migrateStatus() {
    try {
        await sequelize.authenticate();
        console.log('Connected to DB.');

        // 1. Get current enum values
        const [results] = await sequelize.query("DESCRIBE orders");
        const statusColumn = results.find(r => r.Field === 'status');
        const currentType = statusColumn.Type;
        console.log('Current Status Enum:', currentType);

        if (!currentType.includes('waiting_admin_verification')) {
            console.log('Adding "waiting_admin_verification" to enum...');
            // Construct new enum list strictly based on server.ts logic or manually include all
            // Ideally we just APPEND the new one to be safe, but we need to match the new definition.

            // Extract existing values
            const values = currentType.match(/'([^']+)'/g).map(v => v.replace(/'/g, ''));
            if (!values.includes('waiting_admin_verification')) {
                values.push('waiting_admin_verification');
            }

            const newEnumSql = values.map(v => `'${v}'`).join(',');
            await sequelize.query(`ALTER TABLE orders MODIFY COLUMN status ENUM(${newEnumSql}) DEFAULT 'pending'`);
            console.log('Enum updated.');
        } else {
            console.log('"waiting_admin_verification" already in enum.');
        }

        // 2. Migrate Data
        console.log('Migrating orders from "processing" to "waiting_admin_verification"...');
        const [updateResult] = await sequelize.query(`UPDATE orders SET status = 'waiting_admin_verification' WHERE status = 'processing'`);
        // updateResult usually contains affected rows info depending on dialect options
        console.log('Data migration query executed.');

        // Check if any remain
        const [remaining] = await sequelize.query(`SELECT count(*) as count FROM orders WHERE status = 'processing'`);
        console.log(`Remaining "processing" orders: ${remaining[0].count}`);

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await sequelize.close();
    }
}

migrateStatus();
