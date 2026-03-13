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

// --- Reports ---
export const getAccountsReceivable = asyncWrapper(async (req: Request, res: Response) => {
    try {
        // 1. Get AR from Invoices (payment_status != 'paid')
        const ar = await Invoice.findAll({
            where: {
                payment_status: { [Op.ne]: 'paid' } // unpaid, cod_pending
            },
            include: buildAccountsReceivableInclude(),
            order: [['createdAt', 'ASC']] // Oldest first
        });

        const context = await buildAccountsReceivableContext(ar);
        const invoiceRows = mapAccountsReceivableRows(ar, context);

        // 2. Get Driver Debts (User.debt > 0)
        const debtors = await User.findAll({
            where: {
                role: 'driver',
                debt: { [Op.gt]: 0 }
            },
            attributes: ['id', 'name', 'whatsapp_number', 'debt', 'updatedAt']
        });

        const driverRows = debtors.map(driver => {
            const debt = Number(driver.debt || 0);
            const updatedAtMs = new Date(driver.updatedAt).getTime();
            const agingDays = Math.max(0, Math.floor((Date.now() - updatedAtMs) / (24 * 60 * 60 * 1000)));

            return {
                id: `debt-${driver.id}`,
                invoice_number: `UTANG-DRIVER-${driver.name.toUpperCase().replace(/\s+/g, '-')}`,
                payment_method: 'cod_settlement',
                payment_status: 'debt',
                payment_proof_url: null,
                amount_paid: 0,
                amount_due: debt,
                aging_days: agingDays,
                createdAt: driver.updatedAt,
                updatedAt: driver.updatedAt,
                verified_at: null,
                order: {
                    id: 'DEBT',
                    customer_name: `Driver: ${driver.name}`,
                    source: 'offline',
                    status: 'active',
                    total_amount: debt,
                    createdAt: driver.updatedAt,
                    updatedAt: driver.updatedAt,
                    expiry_date: null,
                    customer: {
                        id: driver.id,
                        name: driver.name,
                        whatsapp_number: driver.whatsapp_number
                    },
                    items: []
                }
            };
        });

        res.json([...invoiceRows, ...driverRows]);
    } catch (error) {
        throw new CustomError('Error fetching AR', 500);
    }
});

export const getAccountsReceivableDetail = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const invoiceId = String(req.params.id || '').trim();
        if (!invoiceId) {
            throw new CustomError('invoice id wajib diisi', 400);
        }

        // Handle pseudo-ID for driver debt
        if (invoiceId.startsWith('debt-')) {
            const driverId = invoiceId.replace('debt-', '');
            const driver = await User.findOne({
                where: {
                    id: driverId,
                    role: 'driver',
                    debt: { [Op.gt]: 0 }
                },
                attributes: ['id', 'name', 'whatsapp_number', 'debt', 'updatedAt']
            });

            if (!driver) {
                throw new CustomError('Data piutang driver tidak ditemukan', 404);
            }

            const debt = Number(driver.debt || 0);
            const updatedAtMs = new Date(driver.updatedAt).getTime();
            const agingDays = Math.max(0, Math.floor((Date.now() - updatedAtMs) / (24 * 60 * 60 * 1000)));

            const row = {
                id: invoiceId,
                invoice_number: `UTANG-DRIVER-${driver.name.toUpperCase().replace(/\s+/g, '-')}`,
                payment_method: 'cod_settlement',
                payment_status: 'debt',
                payment_proof_url: null,
                amount_paid: 0,
                amount_due: debt,
                aging_days: agingDays,
                createdAt: driver.updatedAt,
                updatedAt: driver.updatedAt,
                verified_at: null,
                order: {
                    id: 'DEBT',
                    customer_name: `Driver: ${driver.name}`,
                    source: 'offline',
                    status: 'active',
                    total_amount: debt,
                    createdAt: driver.updatedAt,
                    updatedAt: driver.updatedAt,
                    expiry_date: null,
                    customer: {
                        id: driver.id,
                        name: driver.name,
                        whatsapp_number: driver.whatsapp_number
                    },
                    items: []
                }
            };
            return res.json(row);
        }

        const invoice = await Invoice.findOne({
            where: {
                id: invoiceId,
                payment_status: { [Op.ne]: 'paid' }
            },
            include: buildAccountsReceivableInclude()
        });

        if (!invoice) {
            throw new CustomError('Data piutang tidak ditemukan', 404);
        }

        const context = await buildAccountsReceivableContext([invoice]);
        const [row] = mapAccountsReceivableRows([invoice], context);
        if (!row) {
            throw new CustomError('Data piutang tidak ditemukan', 404);
        }
        return res.json(row);
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error fetching AR detail', 500);
    }
});
