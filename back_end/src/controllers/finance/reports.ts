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
        const { startDate, endDate } = req.query;

        const dateFilter: any = {};
        if (startDate && endDate) {
            dateFilter[Op.between] = [new Date(startDate as string), new Date(endDate as string)];
        }

        // 1. Revenue (Completed Sales)
        // Orders where status = completed? Or just Paid invoices?
        // Revenue is recognized when delivered or when paid?
        // Simple PnL: Sales (Paid Invoices) - COGS - Expenses

        const sales = await Invoice.sum('amount_paid', {
            where: {
                payment_status: 'paid',
                verified_at: dateFilter // Using verified_at instead of updatedAt
            }
        }) || 0;

        // 2. COGS (Cost of Goods Sold)
        // Aggregate from invoice items to support multi-order invoices.
        const paidInvoices = await Invoice.findAll({
            where: { payment_status: 'paid', verified_at: dateFilter },
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
                date: dateFilter
            }
        }) || 0;

        const grossProfit = Number(sales) - cogs;
        const netProfit = grossProfit - Number(opex);

        res.json({
            period: { startDate, endDate },
            revenue: Number(sales),
            cogs,
            gross_profit: grossProfit,
            expenses: Number(opex),
            net_profit: netProfit
        });

    } catch (error) {
        throw new CustomError('Error calculating P&L', 500);
    }
});

