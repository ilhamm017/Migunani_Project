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

export const getExpenseLabels = asyncWrapper(async (_req: Request, res: Response) => {
    try {
        await ensureDefaultExpenseLabels();
        const labels = await ExpenseLabel.findAll({
            order: [['name', 'ASC']]
        });
        res.json({ labels });
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error fetching expense labels', 500);
    }
});

export const createExpenseLabel = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const name = toSafeText(req.body?.name);
        const description = toSafeText(req.body?.description);

        if (!name) {
            throw new CustomError('Nama label wajib diisi', 400);
        }

        const existingLabels = await ExpenseLabel.findAll({ attributes: ['name'] });
        const hasDuplicate = existingLabels.some((item) => item.name.toLowerCase() === name.toLowerCase());
        if (hasDuplicate) {
            throw new CustomError('Label sudah ada', 409);
        }

        const label = await ExpenseLabel.create({
            name,
            description: description || null
        });
        res.status(201).json({ message: 'Label created', label });
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error creating expense label', 500);
    }
});

export const updateExpenseLabel = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            throw new CustomError('ID label tidak valid', 400);
        }

        const label = await ExpenseLabel.findByPk(id);
        if (!label) {
            throw new CustomError('Label tidak ditemukan', 404);
        }

        const nextName = toSafeText(req.body?.name);
        const description = toSafeText(req.body?.description);
        if (!nextName) {
            throw new CustomError('Nama label wajib diisi', 400);
        }

        const existingLabels = await ExpenseLabel.findAll({
            where: { id: { [Op.ne]: id } },
            attributes: ['name']
        });
        const hasDuplicate = existingLabels.some((item) => item.name.toLowerCase() === nextName.toLowerCase());
        if (hasDuplicate) {
            throw new CustomError('Nama label sudah digunakan', 409);
        }

        await label.update({
            name: nextName,
            description: description || null
        });
        res.json({ message: 'Label updated', label });
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error updating expense label', 500);
    }
});

export const deleteExpenseLabel = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            throw new CustomError('ID label tidak valid', 400);
        }

        const label = await ExpenseLabel.findByPk(id);
        if (!label) {
            throw new CustomError('Label tidak ditemukan', 404);
        }

        await label.destroy();
        res.json({ message: 'Label deleted' });
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error deleting expense label', 500);
    }
});
