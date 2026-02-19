import { Op, Transaction } from 'sequelize';
import { Invoice, InvoiceItem, OrderItem } from '../models';

const uniqueInvoices = (rows: any[]): Invoice[] => {
    const map = new Map<string, Invoice>();
    rows.forEach((item: any) => {
        const invoice = item?.Invoice as Invoice | undefined;
        if (!invoice) return;
        map.set(String(invoice.id), invoice);
    });
    return Array.from(map.values());
};

export const findInvoicesByOrderId = async (
    orderId: string,
    options?: { transaction?: Transaction }
): Promise<Invoice[]> => {
    const orderItems = await OrderItem.findAll({
        where: { order_id: orderId },
        attributes: ['id'],
        transaction: options?.transaction
    });
    const orderItemIds = orderItems.map((item) => String(item.id));
    if (orderItemIds.length === 0) return [];

    const invoiceItems = await InvoiceItem.findAll({
        where: { order_item_id: { [Op.in]: orderItemIds } },
        include: [{ model: Invoice }],
        transaction: options?.transaction
    });
    return uniqueInvoices(invoiceItems as any[]);
};

export const findLatestInvoiceByOrderId = async (
    orderId: string,
    options?: { transaction?: Transaction }
): Promise<Invoice | null> => {
    const invoices = await findInvoicesByOrderId(orderId, options);
    if (invoices.length === 0) return null;
    const sorted = [...invoices].sort((a, b) => {
        const aTime = new Date(a.createdAt || 0).getTime();
        const bTime = new Date(b.createdAt || 0).getTime();
        return bTime - aTime;
    });
    return sorted[0] || null;
};

export const findOrderIdsByInvoiceId = async (
    invoiceId: string,
    options?: { transaction?: Transaction }
): Promise<string[]> => {
    const invoiceItems = await InvoiceItem.findAll({
        where: { invoice_id: invoiceId },
        include: [{ model: OrderItem, attributes: ['order_id'] }],
        transaction: options?.transaction
    });
    const ids = new Set<string>();
    invoiceItems.forEach((item: any) => {
        const orderId = item?.OrderItem?.order_id;
        if (orderId) ids.add(String(orderId));
    });
    return Array.from(ids);
};

export const attachInvoicesToOrders = async (
    orders: any[],
    options?: { transaction?: Transaction }
): Promise<any[]> => {
    if (!Array.isArray(orders) || orders.length === 0) return orders;
    const orderIds = orders.map((order) => String(order.id));
    const orderItems = await OrderItem.findAll({
        where: { order_id: { [Op.in]: orderIds } },
        attributes: ['id', 'order_id'],
        transaction: options?.transaction
    });
    const orderItemIds = orderItems.map((item: any) => String(item.id));
    const orderItemToOrderId = new Map<string, string>();
    orderItems.forEach((item: any) => {
        orderItemToOrderId.set(String(item.id), String(item.order_id));
    });

    if (orderItemIds.length === 0) {
        return orders.map((order) => ({ ...order, Invoice: null, Invoices: [] }));
    }

    const invoiceItems = await InvoiceItem.findAll({
        where: { order_item_id: { [Op.in]: orderItemIds } },
        include: [{
            model: Invoice,
            attributes: ['id', 'invoice_number', 'payment_status', 'payment_method', 'total', 'payment_proof_url', 'createdAt', 'updatedAt', 'expiry_date']
        }],
        transaction: options?.transaction
    });

    const orderInvoicesMap = new Map<string, Map<string, any>>();
    for (const item of invoiceItems as any[]) {
        const orderId = orderItemToOrderId.get(String(item.order_item_id));
        if (!orderId) continue;
        const invoice = item.Invoice ? item.Invoice.get({ plain: true }) : null;
        if (!invoice) continue;
        const bucket = orderInvoicesMap.get(orderId) || new Map<string, any>();
        bucket.set(String(invoice.id), invoice);
        orderInvoicesMap.set(orderId, bucket);
    }

    return orders.map((order) => {
        const map = orderInvoicesMap.get(String(order.id));
        const invoices = map ? Array.from(map.values()) : [];
        const sorted = [...invoices].sort((a, b) => {
            const aTime = new Date(a.createdAt || 0).getTime();
            const bTime = new Date(b.createdAt || 0).getTime();
            return bTime - aTime;
        });
        return {
            ...order,
            Invoice: sorted[0] || null,
            Invoices: sorted
        };
    });
};
