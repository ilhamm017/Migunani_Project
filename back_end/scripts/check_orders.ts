
import { Order, Invoice } from '../src/models';

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

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

debug();
