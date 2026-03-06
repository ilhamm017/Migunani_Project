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
export const createStockMutation = async (req: Request, res: Response) => {
    const t = await sequelize.transaction();
    try {
        const { product_id, type, qty, note, reference_id } = req.body;
        // type: 'in' | 'out' | 'adjustment'

        const product = await Product.findByPk(product_id, { transaction: t });
        if (!product) {
            await t.rollback();
            return res.status(404).json({ message: 'Product not found' });
        }

        let newStock = product.stock_quantity;
        if (type === 'in' || (type === 'adjustment' && qty > 0)) {
            newStock += qty;
        } else if (type === 'out' || (type === 'adjustment' && qty < 0)) {
            newStock -= Math.abs(qty); // Ensure subtraction
        }

        if (newStock < 0) {
            await t.rollback();
            return res.status(400).json({ message: 'Insufficient stock' });
        }

        await StockMutation.create({
            product_id,
            type,
            qty: type === 'out' ? -Math.abs(qty) : Math.abs(qty), // Store logic based on type, ensuring adjustments follow sign logic or explicit type
            note,
            reference_id
        }, { transaction: t });

        const effectiveQty = type === 'out' ? -Math.abs(Number(qty)) : Number(qty);
        if (type === 'in' && effectiveQty > 0) {
            await InventoryCostService.recordInbound({
                product_id,
                qty: effectiveQty,
                unit_cost: Number(product.base_price || 0),
                reference_type: 'stock_mutation',
                reference_id: reference_id ? String(reference_id) : undefined,
                note: note || 'Manual stock in',
                transaction: t
            });
        } else if (type === 'out' && effectiveQty < 0) {
            await InventoryCostService.consumeOutbound({
                product_id,
                qty: Math.abs(effectiveQty),
                reference_type: 'stock_mutation',
                reference_id: reference_id ? String(reference_id) : undefined,
                note: note || 'Manual stock out',
                transaction: t
            });
        } else if (type === 'adjustment' && effectiveQty !== 0) {
            await InventoryCostService.recordAdjustment({
                product_id,
                qty_diff: effectiveQty,
                reference_type: 'stock_mutation',
                reference_id: reference_id ? String(reference_id) : undefined,
                note: note || 'Manual stock adjustment',
                transaction: t
            });
        }

        await product.update({ stock_quantity: newStock }, { transaction: t });

        await t.commit();
        res.json({ message: 'Stock mutation recorded', current_stock: newStock });
    } catch (error) {
        await t.rollback();
        res.status(500).json({ message: 'Error creating mutation', error });
    }
};

export const getProductMutations = async (req: Request, res: Response) => {
    try {
        const { product_id } = req.params;
        const mutations = await StockMutation.findAll({
            where: { product_id },
            order: [['createdAt', 'DESC']],
            limit: 50
        });
        res.json(mutations);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching mutations', error });
    }
};
