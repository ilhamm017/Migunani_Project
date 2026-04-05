import { Transaction } from 'sequelize';
import { Invoice } from '../models';
import { getCodCustomerDue } from './codCustomerDelta';

const norm = (v: unknown) => String(v || '').trim().toLowerCase();

export const isCodCustomerSettled = (invoiceLike: Pick<Invoice, 'payment_method' | 'cod_resolution_status'> | any): boolean => {
    const method = norm(invoiceLike?.payment_method);
    if (method !== 'cod') return true;
    const status = norm(invoiceLike?.cod_resolution_status);
    return status === 'ok';
};

export const isCodCustomerUnderpaid = (invoiceLike: Pick<Invoice, 'payment_method' | 'cod_resolution_status'> | any): boolean => {
    const method = norm(invoiceLike?.payment_method);
    if (method !== 'cod') return false;
    const status = norm(invoiceLike?.cod_resolution_status);
    return status === 'customer_underpay';
};

export const isCodCustomerNeedsRecalc = (invoiceLike: Pick<Invoice, 'payment_method' | 'cod_resolution_status'> | any): boolean => {
    const method = norm(invoiceLike?.payment_method);
    if (method !== 'cod') return false;
    const status = norm(invoiceLike?.cod_resolution_status);
    return status === 'needs_recalc';
};

export const getCodCustomerDueForInvoice = async (
    invoiceId: string,
    options?: { transaction?: Transaction }
) => getCodCustomerDue(invoiceId, options);

