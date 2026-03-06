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
export const createSupplierInvoice = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { purchase_order_id, invoice_number, total, due_date, subtotal, tax_amount, tax_percent } = req.body;
        const userId = req.user!.id;

        const po = await PurchaseOrder.findByPk(purchase_order_id, { transaction: t });
        if (!po) {
            await t.rollback();
            return res.status(404).json({ message: 'Purchase Order not found' });
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
        res.status(500).json({ message: 'Error creating supplier invoice', error });
    }
};

export const paySupplierInvoice = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { invoice_id, amount, account_id, note } = req.body;
        const userId = req.user!.id;

        const invoice = await SupplierInvoice.findByPk(invoice_id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!invoice) {
            await t.rollback();
            return res.status(404).json({ message: 'Invoice not found' });
        }

        const paymentAmount = Number(amount);
        if (paymentAmount <= 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Jumlah pembayaran tidak valid' });
        }

        const payments = await SupplierPayment.findAll({ where: { supplier_invoice_id: invoice_id }, transaction: t });
        const paidTotal = payments.reduce((sum, p) => sum + Number(p.amount), 0);

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

        if (apAcc && paymentAcc) {
            await JournalService.createEntry({
                description: `Pembayaran Tagihan Supplier #${invoice.invoice_number} (Payment #${payment.id})`,
                reference_type: 'supplier_payment',
                reference_id: payment.id.toString(),
                created_by: userId,
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
        res.status(500).json({ message: 'Error paying supplier invoice', error });
    }
};
