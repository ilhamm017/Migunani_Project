
import { Invoice, Order, OrderItem, InvoiceItem } from '../models';
import sequelize from '../config/database';
import { Op } from 'sequelize';

async function debugInvoice() {
    const invoiceNumber = 'INV/20260311/89ACAA41-221749478277';
    try {
        console.log(`Searching for invoice: ${invoiceNumber}`);
        const invoice = await Invoice.findOne({
            where: { invoice_number: invoiceNumber },
            include: [
                {
                    model: InvoiceItem,
                    as: 'Items',
                    include: [
                        {
                            model: OrderItem,
                            include: [Order]
                        }
                    ]
                }
            ]
        });

        if (!invoice) {
            console.log('Invoice NOT found');
            return;
        }

        const invoiceAny = invoice as any;
        console.log('Invoice Details:', JSON.stringify(invoiceAny, null, 2));

        const orderIds = new Set<string>();
        invoiceAny.Items?.forEach((item: any) => {
            if (item.OrderItem?.order_id) {
                orderIds.add(item.OrderItem.order_id);
            }
        });

        console.log(`Related Order IDs from InvoiceItems: ${Array.from(orderIds).join(', ')}`);

        for (const orderId of orderIds) {
            console.log(`\n--- Checking Invoices for Order: ${orderId} ---`);
            const orderItems = await OrderItem.findAll({ where: { order_id: orderId } });
            const itemIds = orderItems.map(i => i.id);
            const invItems = await InvoiceItem.findAll({
                where: { order_item_id: { [Op.in]: itemIds } },
                include: [Invoice]
            });

            const invoices = new Set<string>();
            invItems.forEach((ii: any) => {
                if (ii.Invoice) {
                    invoices.add(`${ii.Invoice.invoice_number} (ID: ${ii.Invoice.id})`);
                }
            });
            console.log(`Invoices for this order: ${Array.from(invoices).join(' | ')}`);
        }


        console.log(`Order Count from Items: ${orderIds.size}`);

        // Also check if orders are linked via invoice_id (if that column exists and is used)
        const ordersDirectlyLinked = await Order.findAll({
            where: {
                parent_order_id: null // Assuming linked orders are not splits, or just check all
            }
        });

        // Wait, I need to check if Order table has invoice columns. 
        // Based on AdminOrdersWorkspace, it looks for order.invoice_id or order.Invoice.id

        const allOrders = await Order.findAll();
        const linkedOrders = allOrders.filter((o: any) => {
            // This is a bit slow but let's see
            return o.invoice_id === invoice.id;
        });
        console.log(`Orders directly linked via invoice_id: ${linkedOrders.map((o: any) => o.id).join(', ')}`);

    } catch (error) {
        console.error('Error debugging invoice:', error);
    } finally {
        process.exit(0);
    }
}

debugInvoice();
