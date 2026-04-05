import { Request, Response } from 'express';
import { Expense, ExpenseLabel, Invoice, InvoiceItem, Order, OrderItem, Product, User, sequelize, Account, Journal, JournalLine, CodCollection, CodSettlement, OrderAllocation, AccountingPeriod, CreditNote, CreditNoteLine, Setting, PosSale, PosSaleItem, CustomerBalanceEntry } from '../../models';
import { Op, QueryTypes } from 'sequelize';
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
import { computeInvoiceNetTotalsBulk } from '../../utils/invoiceNetTotals';

// --- Reports ---
export const getAccountsReceivable = asyncWrapper(async (req: Request, res: Response) => {
    try {
        // 1. Get AR from Invoices (non-paid invoices)
        const ar = await Invoice.findAll({
            where: {
                payment_status: { [Op.ne]: 'paid' }, // unpaid, cod_pending
                sales_channel: 'app'
            },
            include: buildAccountsReceivableInclude(),
            order: [['createdAt', 'ASC']] // Oldest first
        });

        // 2. Include COD customer underpay invoices even when invoice.payment_status = 'paid'.
        // Source of truth: customer_balance_entries (cod_invoice_delta) per invoice reference.
        const codDeltaRows = await sequelize.query(
            `SELECT reference_id AS invoice_id, SUM(amount) AS delta
             FROM customer_balance_entries
             WHERE entry_type = 'cod_invoice_delta'
               AND reference_type = 'invoice'
             GROUP BY reference_id
             HAVING SUM(amount) < 0`,
            { type: QueryTypes.SELECT }
        ) as Array<{ invoice_id: string; delta: number }>;
        const codUnderpayInvoiceIds = Array.from(new Set(
            (Array.isArray(codDeltaRows) ? codDeltaRows : [])
                .map((row) => String((row as any)?.invoice_id || '').trim())
                .filter(Boolean)
        ));
        const codUnderpayInvoices = codUnderpayInvoiceIds.length > 0
            ? await Invoice.findAll({
                where: {
                    id: { [Op.in]: codUnderpayInvoiceIds },
                    sales_channel: 'app',
                    payment_method: 'cod',
                },
                include: buildAccountsReceivableInclude(),
                order: [['createdAt', 'ASC']]
            })
            : [];

        const byId = new Map<string, Invoice>();
        (ar as any[]).forEach((inv: any) => {
            const id = String(inv?.id || '').trim();
            if (id) byId.set(id, inv);
        });
        (codUnderpayInvoices as any[]).forEach((inv: any) => {
            const id = String(inv?.id || '').trim();
            if (id && !byId.has(id)) byId.set(id, inv);
        });
        const combined = Array.from(byId.values());

        const context = await buildAccountsReceivableContext(combined);
        const invoiceIds = combined.map((row: any) => String(row?.id || '').trim()).filter(Boolean);
        const netTotals = await computeInvoiceNetTotalsBulk(invoiceIds);
        const collectibleByInvoiceId = new Map<string, number>();
        netTotals.forEach((row, id) => collectibleByInvoiceId.set(id, Number(row.net_total || 0)));
        const invoiceRows = mapAccountsReceivableRows(combined, context, {
            collectible_total_by_invoice_id: collectibleByInvoiceId
        });
        // For COD rows with amount_due > 0, mark as unpaid in AR report so UI doesn't show "Lunas".
        (invoiceRows as any[]).forEach((row: any) => {
            const method = String(row?.payment_method || '').trim().toLowerCase();
            const due = Number(row?.amount_due || 0);
            if (method === 'cod' && Number.isFinite(due) && due > 0) {
                row.payment_status = 'unpaid';
            }
        });

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

        // 3. Get POS underpay (change_amount < 0)
        const posSales = await PosSale.findAll({
            where: {
                status: 'paid',
                change_amount: { [Op.lt]: 0 }
            },
            include: [{
                association: 'Customer' as any,
                attributes: ['id', 'name', 'whatsapp_number', 'email'],
                required: false,
            }],
            order: [['paid_at', 'ASC'], ['createdAt', 'ASC']],
        });

        const posRows = (posSales as any[]).map((sale) => {
            const total = Number(sale.total || 0);
            const received = Number(sale.amount_received || 0);
            const due = Math.max(0, Math.round((total - received) * 100) / 100);
            const paidAt = sale.paid_at ? new Date(sale.paid_at) : new Date(sale.createdAt || Date.now());
            const agingDays = Math.max(0, Math.floor((Date.now() - paidAt.getTime()) / (24 * 60 * 60 * 1000)));
            const receipt = String(sale.receipt_number || '').trim() || `POS-${String(sale.id || '').slice(-8)}`;
            const customerName = String(sale.Customer?.name || sale.customer_name || '').trim() || 'Walk-in';

            return {
                id: `pos-${sale.id}`,
                invoice_number: receipt,
                payment_method: 'cash_store',
                payment_status: 'unpaid',
                payment_proof_url: null,
                amount_paid: received,
                amount_due: due,
                aging_days: agingDays,
                createdAt: paidAt,
                updatedAt: sale.updatedAt || paidAt,
                verified_at: null,
                order: {
                    id: String(sale.id),
                    customer_name: customerName,
                    source: 'pos_store',
                    status: String(sale.status || 'paid'),
                    total_amount: total,
                    createdAt: paidAt,
                    updatedAt: sale.updatedAt || paidAt,
                    expiry_date: null,
                    customer: sale.Customer ? {
                        id: String(sale.Customer.id || ''),
                        name: sale.Customer.name || null,
                        email: sale.Customer.email || null,
                        whatsapp_number: sale.Customer.whatsapp_number || null,
                    } : null,
                    courier: null,
                    items: []
                }
            };
        });

        res.json([...invoiceRows, ...driverRows, ...posRows]);
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

        // Handle pseudo-ID for POS underpay
        if (invoiceId.startsWith('pos-')) {
            const posId = invoiceId.replace('pos-', '');
            if (!posId.trim()) throw new CustomError('pos id tidak valid', 400);

            const sale = await PosSale.findByPk(posId, {
                include: [{
                    association: 'Customer' as any,
                    attributes: ['id', 'name', 'whatsapp_number', 'email'],
                    required: false,
                }]
            });
            if (!sale) throw new CustomError('Data piutang POS tidak ditemukan', 404);

            const total = Number((sale as any).total || 0);
            const received = Number((sale as any).amount_received || 0);
            const due = Math.max(0, Math.round((total - received) * 100) / 100);
            if (due <= 0) {
                throw new CustomError('Transaksi POS ini tidak memiliki sisa piutang.', 409);
            }

            const paidAt = (sale as any).paid_at ? new Date((sale as any).paid_at) : new Date((sale as any).createdAt || Date.now());
            const agingDays = Math.max(0, Math.floor((Date.now() - paidAt.getTime()) / (24 * 60 * 60 * 1000)));
            const receipt = String((sale as any).receipt_number || '').trim() || `POS-${String(posId).slice(-8)}`;
            const customerName = String((sale as any).Customer?.name || (sale as any).customer_name || '').trim() || 'Walk-in';

            const items = await PosSaleItem.findAll({
                where: { pos_sale_id: posId },
                order: [['id', 'ASC']]
            });

            const row = {
                id: invoiceId,
                invoice_number: receipt,
                payment_method: 'cash_store',
                payment_status: 'unpaid',
                payment_proof_url: null,
                amount_paid: received,
                amount_due: due,
                aging_days: agingDays,
                createdAt: paidAt,
                updatedAt: (sale as any).updatedAt || paidAt,
                verified_at: null,
                order: {
                    id: String(posId),
                    customer_name: customerName,
                    source: 'pos_store',
                    status: String((sale as any).status || 'paid'),
                    total_amount: total,
                    createdAt: paidAt,
                    updatedAt: (sale as any).updatedAt || paidAt,
                    expiry_date: null,
                    customer: (sale as any).Customer ? {
                        id: String((sale as any).Customer.id || ''),
                        name: (sale as any).Customer.name || null,
                        email: (sale as any).Customer.email || null,
                        whatsapp_number: (sale as any).Customer.whatsapp_number || null,
                    } : null,
                    courier: null,
                    items: (items as any[]).map((it) => ({
                        id: String(it.id),
                        qty: Number(it.qty || 0),
                        price_at_purchase: Number(it.unit_price || 0),
                        subtotal: Number(it.line_total || 0),
                        product: {
                            id: String(it.product_id),
                            sku: String(it.sku_snapshot || ''),
                            name: String(it.name_snapshot || ''),
                        }
                    }))
                }
            };
            return res.json(row);
        }

        const invoice = await Invoice.findOne({
            where: {
                id: invoiceId,
                sales_channel: 'app'
            },
            include: buildAccountsReceivableInclude()
        });

        if (!invoice) {
            throw new CustomError('Data piutang tidak ditemukan', 404);
        }

        const context = await buildAccountsReceivableContext([invoice]);
        const netTotals = await computeInvoiceNetTotalsBulk([invoiceId]);
        const collectibleByInvoiceId = new Map<string, number>();
        netTotals.forEach((row, id) => collectibleByInvoiceId.set(id, Number(row.net_total || 0)));
        const [row] = mapAccountsReceivableRows([invoice], context, {
            collectible_total_by_invoice_id: collectibleByInvoiceId
        });
        if (!row) {
            throw new CustomError('Data piutang tidak ditemukan', 404);
        }
        const method = String((row as any)?.payment_method || '').trim().toLowerCase();
        const status = String((row as any)?.payment_status || '').trim().toLowerCase();
        const due = Number((row as any)?.amount_due || 0);
        const isCod = method === 'cod';
        const isArEligible = isCod
            ? (Number.isFinite(due) && due > 0) || status !== 'paid'
            : status !== 'paid';
        if (!isArEligible) {
            throw new CustomError('Data piutang tidak ditemukan', 404);
        }
        if (isCod && Number.isFinite(due) && due > 0) {
            (row as any).payment_status = 'unpaid';
        }
        return res.json(row);
    } catch (error) {
        if (error instanceof CustomError) {
            throw error;
        }
        throw new CustomError('Error fetching AR detail', 500);
    }
});
