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

// --- Journals ---
export const getJournals = async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 50, startDate, endDate } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const where: any = {};
        if (startDate && endDate) {
            where.date = { [Op.between]: [startDate, endDate] };
        }

        const journals = await Journal.findAndCountAll({
            where,
            include: [{ model: JournalLine, as: 'Lines', include: [{ model: Account, as: 'Account' }] }],
            limit: Number(limit),
            offset: Number(offset),
            order: [['date', 'DESC'], ['id', 'DESC']]
        });

        res.json({
            total: journals.count,
            totalPages: Math.ceil(journals.count / Number(limit)),
            currentPage: Number(page),
            journals: journals.rows
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching journals', error });
    }
};

