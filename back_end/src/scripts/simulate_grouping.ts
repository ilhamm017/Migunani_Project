
import { Order, OrderItem, Invoice, InvoiceItem } from '../models';
import { attachInvoicesToOrders } from '../utils/invoiceLookup';

async function simulateFrontend() {
    const customerId = '52c0883d-a63e-4ef2-a1c1-b0dd443e2d7e';
    const invoiceNumber = 'INV/20260311/89ACAA41-221749478277';

    try {
        const orders = await Order.findAll({
            where: { customer_id: customerId },
            include: [{ model: OrderItem }]
        });
        const plainOrders = orders.map(o => o.get({ plain: true }));
        const rowsWithInvoices = await attachInvoicesToOrders(plainOrders);

        const COMPLETED_STATUSES = new Set(['completed', 'canceled', 'expired']);
        const PAYMENT_STATUSES = new Set(['waiting_admin_verification']);
        const WAREHOUSE_STATUSES = new Set(['allocated', 'partially_fulfilled', 'ready_to_ship', 'waiting_payment', 'processing', 'shipped', 'hold']);

        function normalizeOrderStatus(raw: any) {
            const status = String(raw || '').trim();
            return status === 'waiting_payment' ? 'ready_to_ship' : status;
        }

        // Mocking detail as null for now as it mostly affects backorder
        function classify(order: any) {
            const rawStatus = String(order.status || '');
            const normalizedStatus = normalizeOrderStatus(rawStatus);
            const isCompleted = COMPLETED_STATUSES.has(rawStatus);
            const isPayment = PAYMENT_STATUSES.has(rawStatus);
            const isWarehouse = WAREHOUSE_STATUSES.has(normalizedStatus);
            const isShipping = normalizedStatus === 'shipped';

            const sections: string[] = [];
            if (isCompleted) return ['selesai'];
            if (isPayment) sections.push('pembayaran');
            if (isShipping) sections.push('pengiriman');
            if (isWarehouse) sections.push('gudang');
            if (sections.length === 0) sections.push('baru');
            return sections;
        }

        const grouped: any = { gudang: [], pengiriman: [] };
        rowsWithInvoices.forEach(order => {
            const sections = classify(order);
            sections.forEach(s => {
                if (grouped[s]) grouped[s].push(order);
            });
        });

        console.log('--- Analysis per Section ---');
        ['gudang', 'pengiriman'].forEach(section => {
            console.log(`\nSection: ${section}`);
            const list = grouped[section];
            const invoiceBuckets = new Map();

            list.forEach((order: any) => {
                const inv = order.Invoice;
                if (!inv || inv.invoice_number !== invoiceNumber) return;

                const groupKey = `id:${inv.id}`;
                const bucket = invoiceBuckets.get(groupKey) || { orders: [], totalAmount: 0 };
                bucket.orders.push(order.id);
                bucket.totalAmount += Number(order.total_amount || 0);
                invoiceBuckets.set(groupKey, bucket);
            });

            invoiceBuckets.forEach((data, key) => {
                console.log(`  Bucket ${key}: ${data.orders.length} order(s), Total Amount: ${data.totalAmount}`);
                console.log(`  Orders: ${data.orders.join(', ')}`);
            });
        });

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

simulateFrontend();
