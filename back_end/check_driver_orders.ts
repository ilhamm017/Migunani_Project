import { Order, User, Invoice } from './src/models';

async function check() {
    try {
        const driver = await User.findOne({ where: { email: 'driver1@migunani.com' } });
        if (!driver) { process.exit(1); }

        const orders = await Order.findAll({
            where: { courier_id: driver.id },
            attributes: ['id', 'status', 'createdAt']
        });

        console.log(`Driver: ${driver.name} (ID: ${driver.id})`);
        console.log(`Total Orders assigned: ${orders.length}`);
        for (const o of orders) {
            console.log(`- Order: ${o.id}, Status: ${o.status}`);
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
check();
