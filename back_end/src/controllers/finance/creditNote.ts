import { Request, Response } from 'express';
import { Expense, ExpenseLabel, Invoice, InvoiceItem, Order, OrderItem, Product, User, sequelize, Account, Journal, JournalLine, CodCollection, CodSettlement, OrderAllocation, AccountingPeriod, CreditNote, CreditNoteLine, Setting } from '../../models';
import { Op } from 'sequelize';
import { JournalService } from '../../services/JournalService';
import { TaxConfigService, computeInvoiceTax } from '../../services/TaxConfigService';
import { AccountingPostingService } from '../../services/AccountingPostingService';
import { emitAdminRefreshBadges, emitCodSettlementUpdated, emitOrderStatusChanged } from '../../utils/orderNotification';
import { generateInvoiceNumber } from '../../utils/invoice';
import { findLatestInvoiceByOrderId, findOrderIdsByInvoiceId } from '../../utils/invoiceLookup';


import {
    toSafeText, normalizeExpenseDetails, parseExpenseNote, buildExpenseNote, ensureDefaultExpenseLabels,
    genCreditNoteNumber, normalizeTaxNumber, buildAccountsReceivableInclude, buildAccountsReceivableContext, mapAccountsReceivableRows,
} from './utils';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';

export const createCreditNote = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { invoice_id, reason, mode = 'receivable', amount, tax_amount = 0, lines = [] } = req.body || {};
        const userId = req.user!.id;
        const invoice = await Invoice.findByPk(String(invoice_id), { transaction: t, lock: t.LOCK.UPDATE });
        if (!invoice) {
            await t.rollback();
            throw new CustomError('Invoice tidak ditemukan', 404);
        }

        const creditAmount = Math.max(0, Number(amount || 0));
        if (creditAmount <= 0) {
            await t.rollback();
            throw new CustomError('Nominal credit note tidak valid', 400);
        }

        const cn = await CreditNote.create({
            invoice_id: invoice.id,
            credit_note_number: genCreditNoteNumber(),
            amount: creditAmount,
            tax_amount: Math.max(0, Number(tax_amount || 0)),
            reason: typeof reason === 'string' ? reason.trim() : null,
            mode: mode === 'cash_refund' ? 'cash_refund' : 'receivable',
            status: 'draft'
        }, { transaction: t });

        if (Array.isArray(lines) && lines.length > 0) {
            for (const line of lines) {
                const qty = Math.max(1, Number(line?.qty || 1));
                const unitPrice = Math.max(0, Number(line?.unit_price || 0));
                const lineSubtotal = Math.max(0, Number(line?.line_subtotal ?? qty * unitPrice));
                const lineTax = Math.max(0, Number(line?.line_tax || 0));
                const lineTotal = Math.max(0, Number(line?.line_total ?? lineSubtotal + lineTax));
                await CreditNoteLine.create({
                    credit_note_id: cn.id,
                    product_id: line?.product_id || null,
                    description: line?.description || null,
                    qty,
                    unit_price: unitPrice,
                    line_subtotal: lineSubtotal,
                    line_tax: lineTax,
                    line_total: lineTotal
                }, { transaction: t });
            }
        }

        await t.commit();
        return res.status(201).json({ message: 'Credit note draft dibuat', credit_note: cn });
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Gagal membuat credit note', 500);
    }
});

export const postCreditNote = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const id = Number(req.params.id);
        const payNow = Boolean(req.body?.pay_now);
        const paymentAccountCode = String(req.body?.payment_account_code || '1101');
        const userId = req.user!.id;

        const cn = await CreditNote.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!cn) {
            await t.rollback();
            throw new CustomError('Credit note tidak ditemukan', 404);
        }
        if (cn.status !== 'draft') {
            await t.rollback();
            throw new CustomError('Credit note sudah diposting', 409);
        }

        const invoice = await Invoice.findByPk(String(cn.invoice_id), { transaction: t, lock: t.LOCK.UPDATE });
        if (!invoice) {
            await t.rollback();
            throw new CustomError('Invoice terkait tidak ditemukan', 404);
        }

        const salesReturnAcc = await Account.findOne({ where: { code: '4101' }, transaction: t });
        const ppnOutputAcc = await Account.findOne({ where: { code: '2201' }, transaction: t });
        const arAcc = await Account.findOne({ where: { code: '1103' }, transaction: t });
        const refundPayableAcc = await Account.findOne({ where: { code: '2203' }, transaction: t });
        const paymentAcc = await Account.findOne({ where: { code: paymentAccountCode }, transaction: t });

        const amount = Number(cn.amount || 0);
        const taxAmount = Number(cn.tax_amount || 0);
        const dpp = Math.max(0, amount - taxAmount);

        const creditTargetAcc = (cn.mode === 'cash_refund' && refundPayableAcc)
            ? refundPayableAcc
            : arAcc;
        const lines: any[] = [];
        if (salesReturnAcc && dpp > 0) lines.push({ account_id: salesReturnAcc.id, debit: dpp, credit: 0 });
        if (taxAmount > 0 && ppnOutputAcc) lines.push({ account_id: ppnOutputAcc.id, debit: taxAmount, credit: 0 });
        if (creditTargetAcc) lines.push({ account_id: creditTargetAcc.id, debit: 0, credit: amount });

        if (lines.length >= 2) {
            await JournalService.createEntry({
                description: `Posting Credit Note ${cn.credit_note_number}`,
                reference_type: 'credit_note',
                reference_id: String(cn.id),
                created_by: String(userId),
                idempotency_key: `credit_note_post_${cn.id}`,
                lines
            }, t);
        }

        if (payNow && cn.mode === 'cash_refund' && refundPayableAcc && paymentAcc) {
            await JournalService.createEntry({
                description: `Refund payout Credit Note ${cn.credit_note_number}`,
                reference_type: 'credit_note_refund',
                reference_id: String(cn.id),
                created_by: String(userId),
                idempotency_key: `credit_note_refund_${cn.id}`,
                lines: [
                    { account_id: refundPayableAcc.id, debit: amount, credit: 0 },
                    { account_id: paymentAcc.id, debit: 0, credit: amount }
                ]
            }, t);
            await cn.update({ status: 'refunded', posted_at: new Date(), posted_by: userId }, { transaction: t });
        } else {
            await cn.update({ status: 'posted', posted_at: new Date(), posted_by: userId }, { transaction: t });
        }

        await t.commit();
        return res.json({ message: 'Credit note berhasil diposting', credit_note: cn });
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Gagal posting credit note', 500);
    }
});
