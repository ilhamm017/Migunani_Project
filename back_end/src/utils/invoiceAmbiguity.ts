import type { Transaction } from 'sequelize';
import { Invoice } from '../models';
import { CustomError } from './CustomError';
import { findInvoicesByOrderId, findOrderIdsByInvoiceId } from './invoiceLookup';

export type InvoiceCandidate = {
    invoice_id: string;
    invoice_number: string;
    createdAt: string | null;
    shipment_status: string;
    payment_status: string;
};

const toCandidate = (invoiceLike: any): InvoiceCandidate => ({
    invoice_id: String(invoiceLike?.id || '').trim(),
    invoice_number: String(invoiceLike?.invoice_number || '').trim(),
    createdAt: invoiceLike?.createdAt ? String(invoiceLike.createdAt) : null,
    shipment_status: String(invoiceLike?.shipment_status || '').trim(),
    payment_status: String(invoiceLike?.payment_status || '').trim(),
});

export const ensureSingleInvoiceOrRequireInvoiceId = async (params: {
    order_id: string;
    invoice_id?: string | null;
    transaction?: Transaction;
    lock?: any;
    if_none?: { statusCode: number; message: string };
    if_invalid_relation?: { statusCode: number; message: string };
}) => {
    const orderId = String(params.order_id || '').trim();
    const requestedInvoiceId = String(params.invoice_id || '').trim();
    if (!orderId) {
        throw new CustomError('order_id tidak valid', 400);
    }

    const ifNone = params.if_none || { statusCode: 404, message: 'Invoice not found' };
    const ifInvalidRelation = params.if_invalid_relation || { statusCode: 400, message: 'Invoice tidak terkait dengan order ini' };

    if (requestedInvoiceId) {
        const invoice = await Invoice.findByPk(requestedInvoiceId, {
            transaction: params.transaction,
            lock: params.lock,
        });
        if (!invoice) {
            throw new CustomError(ifNone.message, ifNone.statusCode);
        }

        const relatedOrderIds = await findOrderIdsByInvoiceId(requestedInvoiceId, { transaction: params.transaction });
        const belongs = relatedOrderIds.includes(orderId) || String((invoice as any)?.order_id || '').trim() === orderId;
        if (!belongs) {
            throw new CustomError(ifInvalidRelation.message, ifInvalidRelation.statusCode);
        }

        return { invoice, candidates: [] as InvoiceCandidate[] };
    }

    const invoices = await findInvoicesByOrderId(orderId, { transaction: params.transaction });
    if (invoices.length === 0) {
        throw new CustomError(ifNone.message, ifNone.statusCode);
    }
    if (invoices.length === 1) {
        const single = invoices[0] as any;
        const invoice = await Invoice.findByPk(String(single.id), {
            transaction: params.transaction,
            lock: params.lock,
        });
        if (!invoice) {
            throw new CustomError(ifNone.message, ifNone.statusCode);
        }
        return { invoice, candidates: [] as InvoiceCandidate[] };
    }

    const candidates = invoices
        .map((row: any) => (row && typeof (row as any).get === 'function' ? (row as any).get({ plain: true }) : row))
        .map(toCandidate)
        .filter((c) => Boolean(c.invoice_id));

    throw new CustomError(
        'Order memiliki lebih dari satu invoice; invoice_id wajib dipilih.',
        409,
        undefined,
        {
            code: 'INVOICE_ID_REQUIRED',
            order_id: orderId,
            candidates,
        }
    );
};

