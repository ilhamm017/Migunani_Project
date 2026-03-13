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

// --- Expenses ---
export const getExpenses = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const { page = 1, limit = 10, startDate, endDate, category } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const whereClause: any = {};
        if (startDate && endDate) {
            whereClause.date = {
                [Op.between]: [new Date(startDate as string), new Date(endDate as string)]
            };
        }
        if (typeof category === 'string' && category.trim()) {
            whereClause.category = category.trim();
        }

        const expenses = await Expense.findAndCountAll({
            where: whereClause,
            limit: Number(limit),
            offset: Number(offset),
            order: [['date', 'DESC']]
        });

        const rows = expenses.rows.map((row) => {
            const plain = row.get({ plain: true }) as any;
            const parsed = parseExpenseNote(plain.note);
            return {
                ...plain,
                note: parsed.text,
                details: parsed.details,
            };
        });

        res.json({
            total: expenses.count,
            totalPages: Math.ceil(expenses.count / Number(limit)),
            currentPage: Number(page),
            expenses: rows
        });
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error fetching expenses', 500);
    }
});

export const createExpense = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { category, amount, date, note, details, payment_method } = req.body;
        const userId = req.user!.id;

        const safeCategory = toSafeText(category);
        const numericAmount = Number(amount);
        if (!safeCategory) {
            await t.rollback();
            throw new CustomError('Kategori wajib diisi', 400);
        }
        if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
            await t.rollback();
            throw new CustomError('Amount harus lebih besar dari 0', 400);
        }

        if (!req.file) {
            await t.rollback();
            throw new CustomError('Attachment/Bukti pengeluaran wajib diupload', 400);
        }

        let parsedDetails = details;
        if (typeof details === 'string') {
            try {
                parsedDetails = JSON.parse(details);
            } catch (e) {
                // Ignore, use as is or empty
            }
        }

        const expense = await Expense.create({
            category: safeCategory,
            amount: numericAmount,
            date: date || new Date(),
            note: buildExpenseNote(note, parsedDetails),
            status: 'requested',
            attachment_url: req.file.path,
            created_by: userId
        }, { transaction: t });

        // No journal entry at creation - moved to payment

        await t.commit();
        res.status(201).json(expense);

    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error creating expense', 500);
    }
});

export const approveExpense = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params as { id: string };
        const userId = req.user!.id;

        const expense = await Expense.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!expense) {
            await t.rollback();
            throw new CustomError('Expense not found', 404);
        }

        if (expense.status !== 'requested') {
            await t.rollback();
            throw new CustomError(`Expense status is ${expense.status}, cannot approve`, 400);
        }

        await expense.update({
            status: 'approved',
            approved_by: userId,
            approved_at: new Date()
        }, { transaction: t });

        await t.commit();
        res.json({ message: 'Expense approved', expense });
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error approving expense', 500);
    }
});

export const payExpense = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params as { id: string };
        const { account_id } = req.body;
        const userId = req.user!.id;

        const expense = await Expense.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!expense) {
            await t.rollback();
            throw new CustomError('Expense not found', 404);
        }

        if (expense.status !== 'approved') {
            await t.rollback();
            throw new CustomError(`Expense must be approved before payment. Current status: ${expense.status}`, 400);
        }

        if (!account_id) {
            await t.rollback();
            throw new CustomError('Account ID (source of funds) is required', 400);
        }

        const paymentAcc = await Account.findByPk(account_id, { transaction: t });
        if (!paymentAcc) {
            await t.rollback();
            throw new CustomError('Payment account not found', 404);
        }

        await expense.update({
            status: 'paid',
            account_id: account_id,
            paid_at: new Date()
        }, { transaction: t });

        // --- Create Journal Entry (Expense vs Cash/Bank) ---
        // Map category to COA code
        let expenseAccountCode = '5300'; // Default: Operasional
        const catLower = expense.category.toLowerCase();
        // Simple mapping based on keywords, ideally stored in config or ExpenseLabel
        if (catLower.includes('gaji')) expenseAccountCode = '5200';
        else if (catLower.includes('listrik') || catLower.includes('utility')) expenseAccountCode = '5300'; // Or specific code
        else if (catLower.includes('transport') || catLower.includes('ongkir')) expenseAccountCode = '5500';
        else if (catLower.includes('hpp') || catLower.includes('modal')) expenseAccountCode = '5100';
        else if (catLower.includes('refund')) expenseAccountCode = '4100-REFUND'; // Example, handle carefully

        let expenseAcc = await Account.findOne({ where: { code: expenseAccountCode }, transaction: t });

        // Fallback if specific account not found, use General Expense (5900 if created?) or just keep 5300
        if (!expenseAcc) {
            expenseAcc = await Account.findOne({ where: { code: '5300' }, transaction: t });
        }

        if (expenseAcc) {
            await JournalService.createEntry({
                description: `Expense Payment: ${expense.category} - ${expense.note || ''}`,
                reference_type: 'expense',
                reference_id: expense.id.toString(),
                created_by: userId,
                date: new Date(),
                lines: [
                    { account_id: expenseAcc.id, debit: Number(expense.amount), credit: 0 },
                    { account_id: paymentAcc.id, debit: 0, credit: Number(expense.amount) }
                ]
            }, t);
        }

        await t.commit();
        res.json({ message: 'Expense paid', expense });
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error paying expense', 500);
    }
});

