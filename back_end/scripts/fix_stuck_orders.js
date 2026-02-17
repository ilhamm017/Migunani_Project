
const { Sequelize, DataTypes } = require('sequelize');

const sequelize = new Sequelize('migunani_motor_db', 'root', 'password', {
    host: 'localhost',
    dialect: 'mysql',
    logging: false
});

async function fixStuckOrders() {
    try {
        await sequelize.authenticate();
        console.log('Connected to DB.');

        // Find stuck orders: Status is 'waiting_payment' but have an Invoice with 'payment_proof_url'
        const [results] = await sequelize.query(`
            SELECT o.id, o.status, i.payment_proof_url
            FROM orders o
            JOIN invoices i ON o.id = i.order_id
            WHERE o.status = 'waiting_payment'
            AND i.payment_proof_url IS NOT NULL
            AND i.payment_proof_url != ''
        `);

        console.log(`Found ${results.length} stuck orders.`);

        if (results.length > 0) {
            for (const order of results) {
                console.log(`Fixing Order #${order.id}...`);
                await sequelize.query(`UPDATE orders SET status = 'processing' WHERE id = '${order.id}'`);
            }
            console.log('All stuck orders fixed.');
        } else {
            console.log('No stuck orders found.');
        }

    } catch (error) {
        console.error('Error fixing orders:', error);
    } finally {
        await sequelize.close();
    }
}

fixStuckOrders();
