import { Transaction } from 'sequelize';
import { CodCollection, DriverDebtAdjustment, DriverBalanceAdjustment, Invoice, InvoiceItem, Order, OrderItem } from '../models';

type DriverCodExposure = {
    exposure: number;
    pendingInvoiceTotal: number;
    collectedTotal: number;
};

export const calculateDriverCodExposure = async (
    driverId: string,
    options?: { transaction?: Transaction }
): Promise<DriverCodExposure> => {
    const invoiceItems = await InvoiceItem.findAll({
        include: [{
            model: Invoice,
            required: true
        }, {
            model: OrderItem,
            required: true,
            include: [{
                model: Order,
                where: { courier_id: driverId },
                required: true,
                attributes: ['id']
            }]
        }],
        transaction: options?.transaction
    });

    const latestInvoiceByOrderId = new Map<string, any>();
    invoiceItems.forEach((item: any) => {
        const invoice = item?.Invoice;
        const orderId = item?.OrderItem?.order_id ? String(item.OrderItem.order_id) : '';
        if (!invoice || !orderId) return;

        const existing = latestInvoiceByOrderId.get(orderId);
        const invoiceTime = new Date(String(invoice.createdAt || 0)).getTime();
        const existingTime = existing ? new Date(String(existing.createdAt || 0)).getTime() : -1;
        if (!existing || invoiceTime > existingTime) {
            latestInvoiceByOrderId.set(orderId, invoice);
        }
    });

    const pendingInvoiceTotals = new Map<string, number>();
    latestInvoiceByOrderId.forEach((invoice) => {
        if (String(invoice.payment_method || '') !== 'cod' || String(invoice.payment_status || '') !== 'cod_pending') {
            return;
        }

        const invoiceId = String(invoice.id || '');
        if (!invoiceId || pendingInvoiceTotals.has(invoiceId)) return;

        const invoiceTotal = Number(invoice.total || 0);
        const paidSnapshot = Number(invoice.amount_paid || 0);
        const amount = paidSnapshot > 0 ? paidSnapshot : invoiceTotal;
        pendingInvoiceTotals.set(invoiceId, Number.isFinite(amount) ? amount : 0);
    });

    const pendingInvoiceTotal = Array.from(pendingInvoiceTotals.values())
        .reduce((sum, amount) => sum + Number(amount || 0), 0);

    const collections = await CodCollection.findAll({
        where: {
            driver_id: driverId,
            status: 'collected'
        },
        transaction: options?.transaction
    });
    const collectedTotal = collections
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);

    const openAdjustments = await DriverDebtAdjustment.findAll({
        where: {
            driver_id: driverId,
            status: 'open'
        },
        attributes: ['amount'],
        transaction: options?.transaction
    });
    const adjustmentsTotal = openAdjustments.reduce((sum, row: any) => sum + Number(row.amount || 0), 0);

    const openBalanceAdjustments = await DriverBalanceAdjustment.findAll({
        where: {
            driver_id: driverId,
            status: 'open'
        },
        attributes: ['amount', 'direction'],
        transaction: options?.transaction
    });
    const balanceNet = openBalanceAdjustments.reduce((sum, row: any) => {
        const dir = String(row?.direction || '').trim().toLowerCase();
        const amt = Number(row?.amount || 0);
        if (!Number.isFinite(amt) || amt <= 0) return sum;
        if (dir === 'credit') return sum - amt;
        return sum + amt;
    }, 0);

    return {
        exposure: Math.max(0, Math.max(pendingInvoiceTotal, collectedTotal) + Math.max(0, adjustmentsTotal) + balanceNet),
        pendingInvoiceTotal,
        collectedTotal
    };
};
