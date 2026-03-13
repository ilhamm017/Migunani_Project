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

// --- Tax Settings ---
export const getTaxSettings = asyncWrapper(async (_req: Request, res: Response) => {
    try {
        const config = await TaxConfigService.getConfig();
        return res.json(config);
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error fetching tax settings', 500);
    }
});

export const updateTaxSettings = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const current = await TaxConfigService.getConfig();
        const modeRaw = typeof req.body?.company_tax_mode === 'string'
            ? req.body.company_tax_mode.trim().toLowerCase()
            : '';
        const nextMode = modeRaw === 'pkp' || modeRaw === 'non_pkp'
            ? (modeRaw as 'pkp' | 'non_pkp')
            : null;

        const vatPercent = normalizeTaxNumber(req.body?.vat_percent);
        const pphPercent = normalizeTaxNumber(req.body?.pph_final_percent);

        if (!nextMode && vatPercent === null && pphPercent === null) {
            await t.rollback();
            throw new CustomError('Tidak ada perubahan pada pengaturan pajak.', 400);
        }

        if (modeRaw && !nextMode) {
            await t.rollback();
            throw new CustomError('company_tax_mode harus pkp atau non_pkp.', 400);
        }

        const nextConfig = {
            company_tax_mode: nextMode || current.company_tax_mode,
            vat_percent: vatPercent !== null ? vatPercent : current.vat_percent,
            pph_final_percent: pphPercent !== null ? pphPercent : current.pph_final_percent
        };

        await Setting.upsert({
            key: 'company_tax_config',
            value: nextConfig,
            description: 'Tax mode and rates for company (Indonesia)'
        }, { transaction: t });

        await t.commit();
        return res.json(nextConfig);
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error updating tax settings', 500);
    }
});
