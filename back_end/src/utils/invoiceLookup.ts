import { Op, Transaction } from 'sequelize';
import { Invoice, InvoiceItem, OrderItem, Order } from '../models';

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

export const findOrderIdsByInvoiceIds = async (
    invoiceIds: string[],
    options?: { transaction?: Transaction }
): Promise<Map<string, string[]>> => {
    const uniqueIds = Array.from(new Set((invoiceIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
    const result = new Map<string, Set<string>>();
    uniqueIds.forEach((id) => result.set(id, new Set<string>()));
    if (uniqueIds.length === 0) return new Map<string, string[]>();

    const invoiceItems = await InvoiceItem.findAll({
        where: { invoice_id: { [Op.in]: uniqueIds } },
        attributes: ['invoice_id'],
        include: [{ model: OrderItem, attributes: ['order_id'] }],
        transaction: options?.transaction
    });

    (invoiceItems as any[]).forEach((row: any) => {
        const invoiceId = String(row?.invoice_id || '').trim();
        if (!invoiceId) return;
        const orderId = String(row?.OrderItem?.order_id || '').trim();
        if (!orderId) return;
        const bucket = result.get(invoiceId) || new Set<string>();
        bucket.add(orderId);
        result.set(invoiceId, bucket);
    });

    const flattened = new Map<string, string[]>();
    result.forEach((set, invoiceId) => {
        flattened.set(invoiceId, Array.from(set));
    });
    return flattened;
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
            attributes: ['id', 'invoice_number', 'payment_status', 'payment_method', 'total', 'amount_paid', 'payment_proof_url', 'shipment_status', 'courier_id', 'createdAt', 'updatedAt', 'expiry_date']
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
export const findOrderByIdOrInvoiceId = async (
    id: string,
    courierId?: string,
    options?: { transaction?: Transaction; lock?: any }
): Promise<Order | null> => {
    // 1. Try as Order ID
    const query: any = { id };
    if (courierId) query.courier_id = courierId;

    let order = await Order.findOne({
        where: query,
        transaction: options?.transaction,
        lock: options?.lock
    });

    if (order) return order;

    // 2. Try as Invoice ID
    const invoice = await Invoice.findByPk(id, { transaction: options?.transaction });
    if (invoice) {
        // If it has order_id link direct
        if (invoice.order_id) {
            const query2: any = { id: invoice.order_id };
            if (courierId) query2.courier_id = courierId;
            order = await Order.findOne({
                where: query2,
                transaction: options?.transaction,
                lock: options?.lock
            });
            if (order) return order;
        }

        // Linked via InvoiceItem -> OrderItem -> Order
        const invoiceItem = await InvoiceItem.findOne({
            where: { invoice_id: id },
            include: [{
                model: OrderItem,
                include: [{
                    model: Order
                }]
            }],
            transaction: options?.transaction
        });

        const linkedOrder = (invoiceItem as any)?.OrderItem?.Order as Order | undefined;
        if (linkedOrder) {
            if (courierId && linkedOrder.courier_id !== courierId) return null;
            return linkedOrder;
        }
    }

    return null;
};

export const findDriverInvoiceContextByOrderOrInvoiceId = async (
    id: string,
    courierId?: string,
    options?: { transaction?: Transaction; lock?: any }
): Promise<{ invoice: Invoice | null; orders: Order[] }> => {
    const transaction = options?.transaction;
    const lock = options?.lock;

    const directOrderWhere: any = { id };
    if (courierId) directOrderWhere.courier_id = courierId;

    const directOrder = await Order.findOne({
        where: directOrderWhere,
        transaction,
        lock
    });

    if (directOrder) {
        const invoices = await findInvoicesByOrderId(String(directOrder.id), { transaction });
        const latestInvoice = invoices
            .slice()
            .sort((a, b) => new Date(String(b.createdAt || 0)).getTime() - new Date(String(a.createdAt || 0)).getTime())[0] || null;
        if (!latestInvoice) {
            return { invoice: null, orders: [directOrder] };
        }

        const relatedOrderIds = await findOrderIdsByInvoiceId(String(latestInvoice.id), { transaction });
        if (relatedOrderIds.length === 0) {
            return { invoice: latestInvoice, orders: [directOrder] };
        }

        const invoiceOrderWhere: any = { id: { [Op.in]: relatedOrderIds } };
        if (courierId) invoiceOrderWhere.courier_id = courierId;
        const invoiceOrders = await Order.findAll({
            where: invoiceOrderWhere,
            transaction,
            lock
        });
        return {
            invoice: latestInvoice,
            orders: invoiceOrders.length > 0 ? invoiceOrders : [directOrder]
        };
    }

    const invoice = await Invoice.findByPk(id, { transaction, lock });
    if (!invoice) {
        return { invoice: null, orders: [] };
    }

    const relatedOrderIds = await findOrderIdsByInvoiceId(String(invoice.id), { transaction });
    if (relatedOrderIds.length === 0) {
        if (invoice.order_id) {
            const orderWhere: any = { id: String(invoice.order_id) };
            if (courierId) orderWhere.courier_id = courierId;
            const fallbackOrder = await Order.findOne({
                where: orderWhere,
                transaction,
                lock
            });
            return { invoice, orders: fallbackOrder ? [fallbackOrder] : [] };
        }
        return { invoice, orders: [] };
    }

    const invoiceOrderWhere: any = { id: { [Op.in]: relatedOrderIds } };
    if (courierId) invoiceOrderWhere.courier_id = courierId;
    const invoiceOrders = await Order.findAll({
        where: invoiceOrderWhere,
        transaction,
        lock
    });

    return { invoice, orders: invoiceOrders };
};
