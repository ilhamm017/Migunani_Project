import { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { Product, Category, ProductCategory, StockMutation, PurchaseOrder, PurchaseOrderItem, Supplier, sequelize, SupplierInvoice, SupplierPayment, Account, Journal, JournalLine } from '../../models';
import { JournalService } from '../../services/JournalService';
import { Op, Transaction } from 'sequelize';
import { InventoryCostService } from '../../services/InventoryCostService';
import { TaxConfigService } from '../../services/TaxConfigService';
import { asyncWrapper } from '../../utils/asyncWrapper';
import { CustomError } from '../../utils/CustomError';

export const createSupplierInvoice = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { purchase_order_id, invoice_number, total, due_date, subtotal, tax_amount, tax_percent } = req.body;
        const userId = req.user!.id;

        const po = await PurchaseOrder.findByPk(purchase_order_id, { transaction: t });
        if (!po) {
            await t.rollback();
            throw new CustomError('Purchase Order not found', 404);
        }

        const subtotalNum = Number.isFinite(Number(subtotal)) ? Number(subtotal) : Number(total || 0);
        const taxAmountNum = Number.isFinite(Number(tax_amount)) ? Number(tax_amount) : 0;
        const totalNum = Number(total || 0);
        const taxPercentNum = Number.isFinite(Number(tax_percent)) ? Number(tax_percent) : 0;

        const supplierInvoice = await SupplierInvoice.create({
            supplier_id: po.supplier_id,
            purchase_order_id: po.id,
            invoice_number,
            total: totalNum,
            subtotal: subtotalNum,
            tax_amount: taxAmountNum,
            tax_percent: taxPercentNum,
            due_date: new Date(due_date),
            status: 'unpaid',
            created_by: userId
        }, { transaction: t });

        // --- Journal: Persediaan + PPN Masukan (D) vs Hutang Supplier (K) ---
        const inventoryAcc = await Account.findOne({ where: { code: '1300' }, transaction: t });
        const apAcc = await Account.findOne({ where: { code: '2100' }, transaction: t }); // Hutang Supplier
        const ppnInputAcc = await Account.findOne({ where: { code: '2202' }, transaction: t });
        const taxCfg = await TaxConfigService.getConfig();

        if (inventoryAcc && apAcc) {
            const lines: any[] = [
                { account_id: inventoryAcc.id, debit: Number(subtotalNum), credit: 0 }
            ];
            if (taxCfg.company_tax_mode === 'pkp' && Number(taxAmountNum) > 0 && ppnInputAcc) {
                lines.push({ account_id: ppnInputAcc.id, debit: Number(taxAmountNum), credit: 0 });
            }
            lines.push({ account_id: apAcc.id, debit: 0, credit: Number(totalNum) });
            await JournalService.createEntry({
                description: `Tagihan Supplier #${supplierInvoice.invoice_number} (PO #${po.id})`,
                reference_type: 'supplier_invoice',
                reference_id: supplierInvoice.id.toString(),
                created_by: userId,
                idempotency_key: `supplier_invoice_${supplierInvoice.id}`,
                lines
            }, t);
        }

        await t.commit();
        res.status(201).json(supplierInvoice);
    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error creating supplier invoice', 500);
    }
});

export const paySupplierInvoice = asyncWrapper(async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { invoice_id, amount, account_id, note } = req.body;
        const userId = req.user!.id;

        const invoice = await SupplierInvoice.findByPk(invoice_id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!invoice) {
            await t.rollback();
            throw new CustomError('Invoice not found', 404);
        }
        if (invoice.status === 'paid') {
            await t.rollback();
            throw new CustomError('Invoice supplier sudah lunas', 409);
        }

        const paymentAmount = Number(amount);
        if (paymentAmount <= 0) {
            await t.rollback();
            throw new CustomError('Jumlah pembayaran tidak valid', 400);
        }

        const payments = await SupplierPayment.findAll({ where: { supplier_invoice_id: invoice_id }, transaction: t });
        const paidTotal = payments.reduce((sum, p) => sum + Number(p.amount), 0);
        const remainingBalance = Math.max(0, Number(invoice.total || 0) - paidTotal);
        if (paymentAmount > remainingBalance) {
            await t.rollback();
            throw new CustomError(`Jumlah pembayaran melebihi sisa tagihan (${remainingBalance})`, 400);
        }

        const payment = await SupplierPayment.create({
            supplier_invoice_id: invoice.id,
            amount: paymentAmount,
            account_id,
            paid_at: new Date(),
            note,
            created_by: userId
        }, { transaction: t });

        const newPaidTotal = paidTotal + paymentAmount;
        if (newPaidTotal >= Number(invoice.total)) {
            await invoice.update({ status: 'paid' }, { transaction: t });
        }

        // --- Journal: Hutang Supplier (D) vs Kas/Bank (K) ---
        const apAcc = await Account.findOne({ where: { code: '2100' }, transaction: t });
        const paymentAcc = await Account.findByPk(account_id, { transaction: t }); // 1101 or 1102
        if (!paymentAcc) {
            await t.rollback();
            throw new CustomError('Payment account not found', 404);
        }

        if (apAcc && paymentAcc) {
            await JournalService.createEntry({
                description: `Pembayaran Tagihan Supplier #${invoice.invoice_number} (Payment #${payment.id})`,
                reference_type: 'supplier_payment',
                reference_id: payment.id.toString(),
                created_by: userId,
                idempotency_key: `supplier_payment_${payment.id}`,
                lines: [
                    { account_id: apAcc.id, debit: paymentAmount, credit: 0 },
                    { account_id: paymentAcc.id, debit: 0, credit: paymentAmount }
                ]
            }, t);
        }

        await t.commit();
        res.json({ message: 'Pembayaran berhasil', payment });

    } catch (error) {
        try { await t.rollback(); } catch { }
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error paying supplier invoice', 500);
    }
});

export const listSupplierInvoices = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const {
            page = 1,
            limit = 20,
            status,
            supplier_id,
            q,
            startDate,
            endDate,
            dueBefore,
            dueAfter,
        } = req.query;

        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.min(200, Math.max(1, Number(limit) || 20));
        const offset = (pageNum - 1) * limitNum;

        const where: any = {};
        const statusStr = String(status || '').trim();
        if (statusStr && statusStr !== 'all') where.status = statusStr;
        if (supplier_id) where.supplier_id = Number(supplier_id);

        const queryTerm = String(q || '').trim();
        if (queryTerm) {
            where[Op.or] = [
                { invoice_number: { [Op.like]: `%${queryTerm}%` } },
            ];
        }

        if (startDate && endDate) {
            where.createdAt = { [Op.between]: [new Date(String(startDate)), new Date(String(endDate))] };
        }

        if (dueAfter && dueBefore) {
            where.due_date = { [Op.between]: [String(dueAfter), String(dueBefore)] };
        } else if (dueAfter) {
            where.due_date = { [Op.gte]: String(dueAfter) };
        } else if (dueBefore) {
            where.due_date = { [Op.lte]: String(dueBefore) };
        }

        const { count, rows } = await SupplierInvoice.findAndCountAll({
            where,
            include: [
                { model: Supplier, as: 'Supplier', attributes: ['id', 'name'] },
                { model: PurchaseOrder, as: 'PurchaseOrder', attributes: ['id', 'total_cost', 'status', 'createdAt'] },
                { model: SupplierPayment, as: 'Payments', attributes: ['id', 'amount', 'paid_at', 'account_id', 'note', 'createdAt'] },
            ],
            limit: limitNum,
            offset,
            order: [['due_date', 'ASC'], ['createdAt', 'DESC']],
        });

        const invoices = rows.map((row) => {
            const plain = row.toJSON() as any;
            const payments = Array.isArray(plain.Payments) ? plain.Payments : [];
            const paidTotal = payments.reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
            const total = Number(plain.total || 0);
            const amountDue = Math.max(0, total - paidTotal);
            return {
                ...plain,
                paid_total: paidTotal,
                amount_due: amountDue,
            };
        });

        res.json({
            total: count,
            totalPages: Math.ceil(count / limitNum),
            currentPage: pageNum,
            invoices,
        });
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error fetching supplier invoices', 500);
    }
});

export const getSupplierInvoiceDetail = asyncWrapper(async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            throw new CustomError('Invoice id tidak valid', 400);
        }

        const invoice = await SupplierInvoice.findByPk(id, {
            include: [
                { model: Supplier, as: 'Supplier', attributes: ['id', 'name', 'contact', 'address'] },
                {
                    model: PurchaseOrder,
                    as: 'PurchaseOrder',
                    attributes: ['id', 'total_cost', 'status', 'createdAt', 'updatedAt'],
                    include: [
                        { model: PurchaseOrderItem, as: 'Items', include: [{ model: Product, attributes: ['id', 'sku', 'name', 'unit'] }] },
                    ]
                },
                { model: SupplierPayment, as: 'Payments', attributes: ['id', 'amount', 'paid_at', 'account_id', 'note', 'createdAt'] },
            ],
            order: [[{ model: SupplierPayment, as: 'Payments' }, 'paid_at', 'DESC']],
        });

        if (!invoice) {
            throw new CustomError('Invoice not found', 404);
        }

        const plain = invoice.toJSON() as any;
        const payments = Array.isArray(plain.Payments) ? plain.Payments : [];
        const paidTotal = payments.reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
        const total = Number(plain.total || 0);
        const amountDue = Math.max(0, total - paidTotal);

        res.json({
            ...plain,
            paid_total: paidTotal,
            amount_due: amountDue,
        });
    } catch (error) {
        if (error instanceof CustomError) throw error;
        throw new CustomError('Error fetching supplier invoice detail', 500);
    }
});
