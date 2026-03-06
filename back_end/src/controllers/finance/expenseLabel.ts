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

export const getExpenseLabels = async (_req: Request, res: Response) => {
    try {
        await ensureDefaultExpenseLabels();
        const labels = await ExpenseLabel.findAll({
            order: [['name', 'ASC']]
        });
        res.json({ labels });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching expense labels', error });
    }
};

export const createExpenseLabel = async (req: Request, res: Response) => {
    try {
        const name = toSafeText(req.body?.name);
        const description = toSafeText(req.body?.description);

        if (!name) {
            return res.status(400).json({ message: 'Nama label wajib diisi' });
        }

        const existingLabels = await ExpenseLabel.findAll({ attributes: ['name'] });
        const hasDuplicate = existingLabels.some((item) => item.name.toLowerCase() === name.toLowerCase());
        if (hasDuplicate) {
            return res.status(409).json({ message: 'Label sudah ada' });
        }

        const label = await ExpenseLabel.create({
            name,
            description: description || null
        });
        res.status(201).json({ message: 'Label created', label });
    } catch (error) {
        res.status(500).json({ message: 'Error creating expense label', error });
    }
};

export const updateExpenseLabel = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ message: 'ID label tidak valid' });
        }

        const label = await ExpenseLabel.findByPk(id);
        if (!label) {
            return res.status(404).json({ message: 'Label tidak ditemukan' });
        }

        const nextName = toSafeText(req.body?.name);
        const description = toSafeText(req.body?.description);
        if (!nextName) {
            return res.status(400).json({ message: 'Nama label wajib diisi' });
        }

        const existingLabels = await ExpenseLabel.findAll({
            where: { id: { [Op.ne]: id } },
            attributes: ['name']
        });
        const hasDuplicate = existingLabels.some((item) => item.name.toLowerCase() === nextName.toLowerCase());
        if (hasDuplicate) {
            return res.status(409).json({ message: 'Nama label sudah digunakan' });
        }

        await label.update({
            name: nextName,
            description: description || null
        });
        res.json({ message: 'Label updated', label });
    } catch (error) {
        res.status(500).json({ message: 'Error updating expense label', error });
    }
};

export const deleteExpenseLabel = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ message: 'ID label tidak valid' });
        }

        const label = await ExpenseLabel.findByPk(id);
        if (!label) {
            return res.status(404).json({ message: 'Label tidak ditemukan' });
        }

        await label.destroy();
        res.json({ message: 'Label deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting expense label', error });
    }
};

