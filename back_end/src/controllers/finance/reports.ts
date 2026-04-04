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

export const getProfitAndLoss = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { startDate, endDate, limit } = req.query;
        const rowLimit = Math.min(Math.max(Number(limit || 200), 1), 2000);
        const verifiedAtFilter = (startDate && endDate)
            ? { [Op.between]: [new Date(String(startDate)), new Date(String(endDate))] }
            : undefined;

        // 1. Revenue (Completed Sales)
        // Orders where status = completed? Or just Paid invoices?
        // Revenue is recognized when delivered or when paid?
        // Simple PnL: Sales (Paid Invoices) - COGS - Expenses

        const sales = await Invoice.sum('amount_paid', {
            where: {
                payment_status: 'paid',
                ...(verifiedAtFilter ? { verified_at: verifiedAtFilter } : {}) // Using verified_at instead of updatedAt
            }
        }) || 0;

        // 2. COGS (Cost of Goods Sold)
        // Aggregate from invoice items to support multi-order invoices.
        const paidInvoices = await Invoice.findAll({
            where: { payment_status: 'paid', ...(verifiedAtFilter ? { verified_at: verifiedAtFilter } : {}) },
            attributes: ['id']
        });

        const paidInvoiceIds = paidInvoices.map((invoice) => String(invoice.id));
        let cogs = 0;
        if (paidInvoiceIds.length > 0) {
            const invoiceItems = await InvoiceItem.findAll({
                where: { invoice_id: { [Op.in]: paidInvoiceIds } },
                attributes: ['qty', 'unit_cost']
            });
            invoiceItems.forEach((item: any) => {
                cogs += Number(item.unit_cost || 0) * Number(item.qty || 0);
            });
        }

        // 3. Expenses
        const opex = await Expense.sum('amount', {
            where: {
                ...(verifiedAtFilter ? { date: verifiedAtFilter } : {})
            }
        }) || 0;

        // 4. Invoice-level rows (for PnL detail table)
        const invoiceRows = paidInvoiceIds.length > 0
            ? await Invoice.findAll({
                where: { id: { [Op.in]: paidInvoiceIds } },
                attributes: ['id', 'invoice_number', 'subtotal', 'verified_at'],
                include: [
                    { model: InvoiceItem, as: 'Items', attributes: ['qty', 'unit_cost'] },
                    {
                        model: Order,
                        attributes: ['id'],
                        include: [{ model: User, as: 'Customer', attributes: ['id', 'name'] }]
                    },
                ],
                order: [['verified_at', 'DESC']],
                limit: rowLimit,
            })
            : [];

        const invoices = invoiceRows.map((inv: any) => {
            const items = Array.isArray(inv?.Items) ? inv.Items : [];
            const modal = items.reduce((sum: number, it: any) => sum + (Number(it?.unit_cost || 0) * Number(it?.qty || 0)), 0);
            const subtotal = Number(inv?.subtotal || 0);
            const customerName = String(inv?.Order?.Customer?.name || '').trim() || '-';
            return {
                invoice_id: String(inv?.id),
                invoice_number: String(inv?.invoice_number || ''),
                customer_name: customerName,
                subtotal,
                modal,
                laba: subtotal - modal,
            };
        });

        const grossProfit = Number(sales) - cogs;
        const netProfit = grossProfit - Number(opex);

        res.json({
            period: { startDate, endDate },
            revenue: Number(sales),
            cogs,
            gross_profit: grossProfit,
            expenses: Number(opex),
            net_profit: netProfit,
            invoices,
        });

    } catch (error) {
        throw new CustomError('Error calculating P&L', 500);
    }
});
