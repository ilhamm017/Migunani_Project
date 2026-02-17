
const { Sequelize } = require('sequelize');

// Load environment variables if necessary, or just hardcode for this script since it's temporary
const sequelize = new Sequelize('migunani_db', 'migunani_user', 'migunani_pass', {
    host: 'localhost',
    dialect: 'mysql',
    logging: false
});

async function checkEnum() {
    try {
        await sequelize.authenticate();
        console.log('Connection has been established successfully.');

        const [results, metadata] = await sequelize.query("DESCRIBE orders");
        const statusColumn = results.find((r: any) => r.Field === 'status');

        if (statusColumn) {
            console.log('Status column type:', statusColumn.Type);
            if (statusColumn.Type.includes('processing')) {
                console.log('SUCCESS: "processing" is in the enum.');
            } else {
                console.log('FAILURE: "processing" is NOT in the enum.');
            }
        } else {
            console.log('FAILURE: Could not find status column.');
        }

        // Also check the specific order from the screenshot (or latest order)
        const [orders] = await sequelize.query("SELECT id, status, updatedAt FROM orders ORDER BY updatedAt DESC LIMIT 1");
        if (orders.length > 0) {
            console.log('Latest Order:', orders[0]);
        }

    } catch (error) {
        console.error('Unable to connect to the database:', error);
    } finally {
        await sequelize.close();
    }
}

checkEnum();
