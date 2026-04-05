import { Op, Transaction } from 'sequelize';
import { CustomerBalanceEntry, Invoice, InvoiceItem, Order, OrderItem, User } from '../models';
import { computeInvoiceNetTotalsBulk } from './invoiceNetTotals';
import { round2 } from './codAllocation';

const normalizeId = (value: unknown) => {
    const s = String(value || '').trim();
    return s || '';
};

export const resolveSingleCustomerIdForInvoice = async (
    invoiceId: string,
    options?: { transaction?: Transaction }
): Promise<string> => {
    const invId = normalizeId(invoiceId);
    if (!invId) throw new Error('invoiceId tidak valid');

    const invoice = await Invoice.findByPk(invId, {
        attributes: ['id', 'customer_id'],
        transaction: options?.transaction
    }) as any;
    const directCustomerId = normalizeId(invoice?.customer_id);
    if (directCustomerId) return directCustomerId;

    const invoiceItems = await InvoiceItem.findAll({
        where: { invoice_id: invId },
        attributes: ['id'],
        include: [{
            model: OrderItem,
            required: true,
            attributes: ['order_id'],
        }],
        transaction: options?.transaction,
    }) as any[];

    const orderIds = Array.from(new Set(invoiceItems.map((row) => normalizeId(row?.OrderItem?.order_id)).filter(Boolean)));
    if (orderIds.length === 0) throw new Error('Invoice tidak memiliki order terkait untuk resolve customer');

    const orders = await Order.findAll({
        where: { id: { [Op.in]: orderIds } },
        attributes: ['id', 'customer_id'],
        transaction: options?.transaction,
    }) as any[];

    const customerIds = Array.from(new Set(orders.map((o) => normalizeId(o?.customer_id)).filter(Boolean)));
    if (customerIds.length !== 1) {
        throw new Error('Invoice tidak bisa resolve 1 customer (kosong atau lebih dari 1 customer)');
    }

    // ensure exists & role customer
    const customerId = customerIds[0]!;
    const customer = await User.findOne({
        where: { id: customerId, role: 'customer' },
        attributes: ['id'],
        transaction: options?.transaction,
    });
    if (!customer) throw new Error('Customer tidak ditemukan untuk invoice');
    return customerId;
};

export const computeDesiredCustomerCodInvoiceDelta = async (
    invoiceId: string,
    options?: { transaction?: Transaction }
): Promise<{ desiredDelta: number; expectedFinal: number }> => {
    const invId = normalizeId(invoiceId);
    if (!invId) return { desiredDelta: 0, expectedFinal: 0 };

    const invoice = await Invoice.findByPk(invId, {
        attributes: ['id', 'amount_paid', 'payment_method'],
        transaction: options?.transaction
    }) as any;
    if (!invoice) throw new Error('Invoice tidak ditemukan');
    const method = String(invoice.payment_method || '').trim().toLowerCase();
    if (method !== 'cod') return { desiredDelta: 0, expectedFinal: 0 };

    const netTotals = await computeInvoiceNetTotalsBulk([invId], { transaction: options?.transaction });
    const expectedFinal = round2(netTotals.get(invId)?.net_total || 0);
    const collected = round2(invoice.amount_paid || 0);

    return { desiredDelta: round2(collected - expectedFinal), expectedFinal };
};

export const syncCustomerCodInvoiceDelta = async (params: {
    invoiceId: string;
    customerId: string;
    desiredDelta: number;
    createdBy?: string | null;
    note?: string | null;
    transaction?: Transaction;
}): Promise<{ postedBefore: number; postedAfter: number; appliedAdjustment: number }> => {
    const invoiceId = normalizeId(params.invoiceId);
    const customerId = normalizeId(params.customerId);
    if (!invoiceId) throw new Error('invoiceId tidak valid');
    if (!customerId) throw new Error('customerId tidak valid');

    const desired = round2(params.desiredDelta);
    const postedBeforeRaw = await CustomerBalanceEntry.sum('amount', {
        where: {
            customer_id: customerId,
            entry_type: 'cod_invoice_delta',
            reference_type: 'invoice',
            reference_id: invoiceId,
        },
        transaction: params.transaction,
    });
    const postedBefore = round2(postedBeforeRaw || 0);
    const adjustment = round2(desired - postedBefore);
    if (adjustment !== 0) {
        await CustomerBalanceEntry.create({
            customer_id: customerId,
            amount: adjustment,
            entry_type: 'cod_invoice_delta',
            reference_type: 'invoice',
            reference_id: invoiceId,
            note: params.note ?? null,
            created_by: params.createdBy ?? null,
            idempotency_key: null,
        } as any, { transaction: params.transaction });
    }

    const postedAfter = round2(postedBefore + adjustment);
    return { postedBefore, postedAfter, appliedAdjustment: adjustment };
};

export const toCodResolutionStatus = (delta: number): 'ok' | 'customer_underpay' | 'customer_overpay' => {
    const d = round2(delta);
    if (d < 0) return 'customer_underpay';
    if (d > 0) return 'customer_overpay';
    return 'ok';
};

