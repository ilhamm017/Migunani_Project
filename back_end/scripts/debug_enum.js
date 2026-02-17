
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('migunani_motor_db', 'root', 'password', {
    host: 'localhost',
    dialect: 'mysql',
    logging: false
});

async function checkInvoice() {
    try {
        await sequelize.authenticate();

        const orderId = 'cb8ed707-e744-442a-bab4-6dc168b8d871';

        const [invoices] = await sequelize.query(`SELECT id, order_id, invoice_number, payment_proof_url, payment_status, updatedAt FROM invoices WHERE order_id = '${orderId}'`);

        if (invoices.length > 0) {
            console.log('Invoice for Order:', invoices[0]);
        } else {
            console.log('No invoice found for this order.');
        }

    } catch (error) {
        console.error('Unable to connect to the database:', error);
    } finally {
        await sequelize.close();
    }
}

checkInvoice();
