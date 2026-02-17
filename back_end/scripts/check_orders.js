
const { Order, Invoice } = require('../dist/models');

async function debug() {
    try {
        const orders = await Order.findAll({
            where: { status: 'waiting_invoice' },
            include: [{ model: Invoice }]
        });

        console.log(`Found ${orders.length} orders in waiting_invoice status.`);
        orders.forEach(o => {
            console.log(`ID: ${o.id}, Parent ID: ${o.parent_order_id}, Total Amount: ${o.total_amount}`);
            console.log(`Invoice: ${o.Invoice ? o.Invoice.invoice_number : 'MISSING'}`);
        });

        const allOrders = await Order.findAll({ limit: 5, order: [['updatedAt', 'DESC']] });
        console.log('\nLast 5 updated orders:');
        allOrders.forEach(o => {
            console.log(`ID: ${o.id}, Status: ${o.status}, Parent ID: ${o.parent_order_id}`);
        });

    } catch (e) {
        console.error(e);
    }
}

debug();
