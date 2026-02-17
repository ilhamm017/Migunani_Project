
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('migunani_motor_db', 'root', 'password', {
    host: 'localhost',
    dialect: 'mysql',
    logging: false
});

async function verifyMigration() {
    try {
        await sequelize.authenticate();

        // 1. Check Enum
        const [results] = await sequelize.query("DESCRIBE orders");
        const statusColumn = results.find(r => r.Field === 'status');
        console.log('Status Enum:', statusColumn.Type);

        // 2. Check the order
        const [orders] = await sequelize.query("SELECT id, status, updatedAt FROM orders WHERE id LIKE 'cb8%'");
        if (orders.length > 0) {
            console.log('Order Status:', orders[0]);
        } else {
            console.log('Order not found.');
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await sequelize.close();
    }
}

verifyMigration();
